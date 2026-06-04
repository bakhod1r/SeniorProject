# Gosper's Hack & Gray Code — Mathematical Foundations

## Table of Contents
1. Formal Definitions
2. Gosper's Hack: The Next-Combination Theorem (Carry/Lowest-Block Proof)
3. The Iteration Count: Why Exactly C(n, k)
4. Reflected Gray Code: Recursive Construction
5. The One-Bit-Change Theorem (Proof)
6. The Conversion Formula g = x ^ (x >> 1) and Its Inverse (Correctness)
7. Gray Code as a Hamiltonian Path/Cycle on the Hypercube
8. The Link Between Gray Order and Subset Enumeration
9. Connections: Towers of Hanoi, Karnaugh Maps, Combinatorial Number System
9b. Worked Gray-Code Verification and Edge Bits
10. Complexity and Lower Bounds
10b. Reflected Construction of Other Combinatorial Objects
10c. Generating Functions and the Algebra of Popcount Classes
11. Summary

---

## 1. Formal Definitions

Let `n ≥ 1` and identify a subset `S ⊆ {0, 1, …, n−1}` with its **characteristic bitmask** `x = Σ_{i∈S} 2^i`. Thus integers in `[0, 2^n)` are in bijection with subsets.

**Definition 1.1 (Popcount / Hamming weight).** `popcount(x) = Σ_i bit_i(x)`, the number of `1` bits, equivalently `|S|`.

**Definition 1.2 (Hamming distance).** For `x, y`, `d_H(x, y) = popcount(x ⊕ y)` is the number of bit positions where they differ.

**Definition 1.3 (`k`-combination as mask).** A **`k`-combination** of an `n`-set is a mask `x ∈ [0, 2^n)` with `popcount(x) = k`. There are `C(n, k)` of them. We order them by integer value; this coincides with the lexicographic order of the corresponding sorted element tuples read from the most significant bit.

**Definition 1.4 (Lowest set bit).** `lsb(x) = x & (−x) = 2^{ν(x)}`, where `ν(x)` is the index of the least significant `1` bit (the 2-adic valuation). For `x = 0`, `lsb(0) = 0`.

**Definition 1.5 (Lowest block).** The **lowest block** of `x ≠ 0` is the maximal run of consecutive `1` bits containing bit `ν(x)`. If it occupies positions `p, p+1, …, p+b−1` (so `p = ν(x)`) with bit `p+b` equal to `0`, then `b ≥ 1` is the **block length**.

**Definition 1.6 (Reflected binary Gray code).** The `n`-bit reflected Gray code is the sequence `G_n = (g_0, g_1, …, g_{2^n − 1})` defined by the recursion in Section 4; equivalently (Theorem 6.1) `g_x = x ⊕ (x ≫ 1)`.

**Notation.** `⊕` is XOR, `&` AND, `|` OR, `≫`/`≪` logical shifts, `¬` bitwise NOT. `Q_n` denotes the `n`-dimensional hypercube graph (vertices = bitmasks in `[0, 2^n)`, edges between masks at Hamming distance 1). All arithmetic is over non-negative integers wide enough that no operation overflows (the engineering caveats are in [`senior.md`](./senior.md)).

**Worked definitions on a concrete mask.** Take `x = 0b0110100 = 52`.
- `popcount(x) = 3` (bits 2, 4, 5 are set), so `x` is a `3`-combination.
- `ν(x) = 2` (least significant set bit is position 2), so `lsb(x) = x & (−x) = 0b0000100 = 4`.
- The **lowest block** is just bit `2` alone (bit `3` is `0`), so `p = 2`, `b = 1`.
- The element subset is `S = {2, 4, 5}`.
- `d_H(x, 0b0110000) = popcount(0b0000100) = 1` — they differ only in bit 2.

These five readings — popcount, lowest set bit, lowest block, the subset, and Hamming distance — are the exact quantities the proofs below manipulate; fixing them on one mask makes the symbolic arguments concrete.

We index bit positions from `0` (least significant). The empty subset is mask `0` (popcount `0`); the full subset of `{0,…,n−1}` is mask `2^n − 1` (popcount `n`). A larger ambient machine word simply leaves the high bits zero and does not change any result.

---

## 2. Gosper's Hack: The Next-Combination Theorem (Carry/Lowest-Block Proof)

**Algorithm (Gosper).** Given `x` with `popcount(x) = k ≥ 1` that is not the largest such mask in the working width:

```
c = x & (−x)                  // c = lsb(x) = 2^p
r = x + c                     // ripple-carry the lowest block
y = (((r ⊕ x) ≫ 2) / c) | r  // exact integer division by c
```

**Theorem 2.1.** `y` is the **smallest integer strictly greater than `x` with `popcount(y) = k`**.

We prove it by analyzing the carry and re-expressing every term in closed form. Let the lowest block of `x` occupy positions `p, …, p+b−1` (Definition 1.5), so `p = ν(x)` and `c = 2^p`.

**Lemma 2.2 (Closed form of `r`).** `r = x + 2^p = x − (2^{p+b} − 2^p) + 2^{p+b} = (x \text{ with bits } p..p+b−1 \text{ cleared and bit } p+b \text{ set})`.

*Proof.* Bits `p..p+b−1` of `x` are all `1` and bit `p+b` is `0` (block maximality). The block's value is `2^p + 2^{p+1} + … + 2^{p+b−1} = 2^{p+b} − 2^p`. Adding `c = 2^p` to this block: `(2^{p+b} − 2^p) + 2^p = 2^{p+b}`. The carry propagates exactly through the `b` ones and sets bit `p+b`, clearing bits `p..p+b−1`; bits above `p+b` and below `p` are untouched (the carry stops at the first `0`, which is bit `p+b`). ∎

So `popcount(r) = k − b + 1`, and `r > x` because we increased a higher bit while clearing lower ones — but `r` has too few set bits. The remaining `b − 1` ones must be reinstated **at the smallest possible positions** to (a) restore popcount `k` and (b) keep the result minimal.

**Lemma 2.3 (Closed form of `r ⊕ x`).** `r ⊕ x = 2^{p+b+1} − 2^p`, i.e. a run of `b + 1` ones in positions `p, …, p+b`.

*Proof.* `x` and `r` agree on all bits except positions `p..p+b` (Lemma 2.2 cleared `p..p+b−1` and set `p+b`; `x` had `p..p+b−1` set and `p+b` clear). So exactly those `b + 1` positions differ; their XOR is the contiguous run `2^p + 2^{p+1} + … + 2^{p+b} = 2^p(2^{b+1} − 1) = 2^{p+b+1} − 2^p`. ∎

**Lemma 2.4 (The repack term equals `2^{b−1} − 1`).**
```
((r ⊕ x) ≫ 2) / c = (2^p (2^{b+1} − 1) ≫ 2) / 2^p = (2^{p−2}(2^{b+1} − 1)) / 2^p = (2^{b+1} − 1) / 4
```
and since `2^{b+1} − 1` divided by `4` in integer arithmetic, combined with the `/2^p`, yields exactly `2^{b−1} − 1`, a run of `b − 1` ones in positions `0, …, b−2`.

*Proof.* From Lemma 2.3, `r ⊕ x = 2^p(2^{b+1} − 1)`. Shifting right by 2 gives `2^p(2^{b+1} − 1) / 4` (exact because the low bits are within the factor `2^p` when `p ≥ 2`; the algebra below handles all `p ≥ 0` because the *division by `c = 2^p` makes the result independent of `p`*). Dividing by `c = 2^p`:
```
((r ⊕ x) ≫ 2) / 2^p = (2^p(2^{b+1} − 1) ≫ 2) / 2^p.
```
The right-shift by 2 and division by `2^p` together divide `2^p(2^{b+1}−1)` by `2^{p+2}`, giving `(2^{b+1} − 1) / 4 = (2^{b+1} − 1) ≫ 2 = 2^{b−1} − 1` (integer division drops the two low ones of the `(b+1)`-run). The result is `2^{b−1} − 1`, exactly `b − 1` ones at positions `0..b−2`, **independent of `p`** — the division by `c` cancels the block's offset. The division is exact (no remainder) because `r ⊕ x` is a multiple of `2^{p+2}` once we also account for... precisely, `((r⊕x) ≫ 2)` is a multiple of `c = 2^p` exactly when `p ≥ 0`, which holds; the integer quotient is well-defined. ∎

**Proof of Theorem 2.1.** Combine the pieces. `y = (2^{b−1} − 1) | r`. By Lemma 2.2, `r` has bits `0..p+b−1` either cleared (the old block) or unchanged (below `p`, but below `p` there are no set bits since `p = ν(x)`), so positions `0..p+b−1` of `r` are all `0` except none — i.e. `r`'s lowest set bit is `p+b`. Therefore OR-ing `2^{b−1} − 1` (bits `0..b−2`) into `r` does not collide with any set bit of `r`, and:
```
popcount(y) = popcount(r) + (b − 1) = (k − b + 1) + (b − 1) = k.
```
Popcount is preserved. **Minimality:** any `z > x` with `popcount(z) = k` must agree with `x` on all bits above the lowest position where an increase can occur. The smallest increase that preserves popcount is to take the lowest block, advance its top bit by one (forced: you cannot increase a lower bit without exceeding popcount or decreasing the value), and place the freed `b − 1` ones at the rightmost positions `0..b−2` (rightmost keeps the value smallest). That is precisely `y`. Hence `y` is the unique smallest such integer. ∎

**Worked verification.** `x = 0b0101100` (`p = 2`, `b = 2`, `k = 3`). `c = 4`, `r = 0b0110000`, `r ⊕ x = 0b0011100 = 2^2(2^3 − 1)`, `((r⊕x)≫2)/c = (0b0000111)/4·... = 2^{1} − 1 = 1`, `y = 0b0110000 | 0b0000001 = 0b0110001 = 49`. Check popcount `= 3`, and `49 > 44` with no popcount-3 integer strictly between (`45=0b101101` pc4, `46` pc3? `46=0b101110` pc4, `48=0b110000` pc2). Correct.

**Why the freed ones must go to the bottom (minimality, restated).** Suppose for contradiction that some valid `z` with `popcount(z) = k` satisfies `x < z < y`. Since `y` and `x` agree on all bits above position `p+b` (the carry stopped at `p+b`, and nothing above changed), any `z < y` that exceeds `x` must also agree with `x`/`y` above `p+b` or have a *smaller* high part — but a smaller high part would make `z < x`, contradiction. So `z` agrees with `y` above position `p+b`, hence on the bit at `p+b` (which `y` sets and `x` clears). For `z > x`, that bit at `p+b` must be set in `z` too (it is the unique increase point). With bit `p+b` fixed at `1` and `k − (k−b+1) = b − 1` remaining ones to place in positions `0 … p+b−1`, the smallest resulting integer places all `b − 1` ones in the lowest positions `0 … b−2` — which is exactly `y`. Any other placement yields `z ≥ y`. Hence no such `z` exists, and `y` is minimal. ∎ (This complements the constructive argument of Theorem 2.1 with an explicit no-gap proof.)

**Alternative derivation via the "compress" view.** Some references write the repack term as `c2 = r ^ x; y = r | ((c2 >> 2) / c)`. An equivalent and sometimes-cited form replaces `(c2 >> 2)/c` with `c2 >> (ν(x) + 2)` — a pure shift instead of a divide — because dividing by `c = 2^{ν(x)}` is exactly a right shift by `ν(x)`. The shift form avoids the (exact) integer division entirely:

```
ones  = x & (-x)
next  = x + ones
ripple = x ^ next
moved  = (ripple >> 2) >> trailingZeros(x)     // equivalently / ones
result = next | moved
```

This is identical mathematically (Lemma 2.4 shows the quotient is `2^{b−1} − 1` independent of `p`), but it sidesteps any worry about non-power-of-two division and is marginally faster on hardware without a fast integer divider. Both forms appear in production codebases; they compute the same `y`.

---

## 3. The Iteration Count: Why Exactly C(n, k)

**Theorem 3.1.** Starting from `x₀ = 2^k − 1` (the `k` lowest bits) and applying Gosper's hack while `x < 2^n`, the loop emits exactly the `C(n, k)` masks with popcount `k` in `[0, 2^n)`, in strictly increasing order, each exactly once.

**Proof.** By Theorem 2.1 each step maps a popcount-`k` mask to the *next-larger* popcount-`k` mask, so the emitted sequence is strictly increasing and hits popcount-`k` integers consecutively with no gaps and no repeats. The start `x₀ = 2^k − 1` is the minimum popcount-`k` integer (all ones packed at the bottom; any other popcount-`k` integer has a `1` in a higher position, hence is larger). The largest popcount-`k` mask in `[0, 2^n)` is `M = (2^k − 1)·2^{n−k} = ((1≪k)−1) ≪ (n−k)` (the `k` ones packed at the top). For any popcount-`k` `x ≤ M`, Theorem 2.1's `y` is the next one; for `x = M`, the next popcount-`k` integer is `≥ 2^n` (a bit must move past position `n−1`), so the loop's guard `x < 2^n` halts after emitting `M`. Since the increasing sequence covers every popcount-`k` integer from `x₀` to `M` inclusive, and there are exactly `C(n, k)` such integers (each corresponds to a unique choice of `k` of the `n` positions), the count is `C(n, k)`. ∎

**Corollary 3.2 (Total enumeration cost).** Each step is `O(1)` machine operations, so enumerating all `k`-subsets is `Θ(C(n, k))` time and `O(1)` extra space. Summing over `k`, enumerating all subsets by popcount layer is `Σ_k C(n, k) = 2^n`.

### 3.1 Full Numeric Trace of an Entire Enumeration

To make Theorem 3.1 concrete, here is the *complete* Gosper enumeration for `n = 5, k = 3`, showing every intermediate quantity at each of the `C(5,3) = 10` steps. We use 5-bit binary and the form `c = x&-x`, `r = x+c`, `y = (((r^x)>>2)/c)|r`.

```
step  x      c     r      r^x    (r^x)>>2  /c    y=next   subset
 0    00111  00001 01000  01111  00011     00011 01011    {0,1,2}
 1    01011  00001 01100  00111  00001     00001 01101    {0,1,3}
 2    01101  00001 01110  00011  00000     00000 01110    {0,2,3}
 3    01110  00010 10000  11110  00111     00011 10011    {1,2,3}
 4    10011  00001 10100  00111  00001     00001 10101    {0,1,4}
 5    10101  00001 10110  00011  00000     00000 10110    {0,2,4}
 6    10110  00010 11000  01110  00011     00001 11001    {1,2,4}
 7    11001  00001 11010  00011  00000     00000 11010    {0,3,4}
 8    11010  00010 11100  00110  00001     00000 11100    {1,3,4}
 9    11100  00100 (stop: next would set a bit at position 5 ≥ n)    {2,3,4}
```

Observations confirming the theory:
- The `x` column is strictly increasing: `7, 11, 13, 14, 19, 21, 22, 25, 26, 28`.
- Every `x` has popcount exactly `3` (Theorem 2.1 preserves popcount).
- The block length `b` varies (`b = 3` at step 0 where `x = 00111`; `b = 1` at step 1), and `c = x&-x` correctly tracks the lowest set bit each time.
- The final mask `11100 = 28 = ((1<<3)-1)<<(5-3)` is the maximal `3`-mask; one more Gosper step would push a bit to position `5`, exceeding `1<<5 = 32`, so the loop halts (Theorem 3.1's stop argument), having emitted exactly `10` masks.

**Corollary 3.3 (Order coincides with colex).** The increasing-integer order Gosper produces is the **colexicographic** (colex) order of the corresponding sorted element tuples. Two `k`-subsets `S, T` with sorted elements `s_1 > s_2 > … > s_k` and `t_1 > t_2 > … > t_k` satisfy `mask(S) < mask(T)` iff `S` precedes `T` in colex order (compare the largest differing element). This is why the combinatorial number system (Section 9) — which is defined relative to colex — unranks exactly into Gosper's order.

*Proof.* The integer value of a mask is `Σ_i 2^{s_i}`, dominated by its highest set bit `2^{s_1}`. Comparing two masks, the first (highest) position where they differ determines the order, and that position is the largest element present in one but not the other — precisely the colex comparison rule. ∎

**Remark (no wasted candidates).** Unlike a naive "increment and test popcount" scan — which would examine `Θ(2^n)` integers to find `C(n,k)` valid ones — Gosper jumps *directly* from each valid mask to the next, touching exactly `C(n,k)` integers. The ratio of work saved over the naive scan is `2^n / C(n,k)`, which for the central binomial coefficient is `Θ(√n)` and for extreme `k` (near `0` or `n`) is exponential. This is the quantitative payoff of the closed-form step.

---

## 4. Reflected Gray Code: Recursive Construction

**Definition 4.1 (Reflected construction).** Define the `n`-bit Gray list `G_n` recursively:

```
G_1 = (0, 1)
G_n = ( 0·G_{n-1} )  followed by  ( 1·reverse(G_{n-1}) )
```

where `0·L` prepends a `0` bit (as the new most-significant bit) to every element of list `L`, `1·L` prepends `1`, and `reverse(L)` reverses the order. So the first half is the `(n−1)`-bit code with a leading `0`; the second half is the *reflected* (reversed) `(n−1)`-bit code with a leading `1`.

**Example (`n = 1 → 2 → 3 → 4`).**
```
G_1 = 0, 1
G_2 = 00, 01,  (then reflect 1,0 with leading 1:) 11, 10
G_3 = 000,001,011,010,  (reflect with leading 1:) 110,111,101,100
G_4 = 0000,0001,0011,0010,0110,0111,0101,0100,
      (reflect G_3 with leading 1:) 1100,1101,1111,1110,1010,1011,1001,1000
```

Reading the construction of `G_4` aloud clarifies the mechanism:
- The **first half** is `G_3` with a `0` prepended — it stays inside the "top bit = 0" subcube, and by induction is a valid one-bit-change code.
- The **second half** is `G_3` *reversed* with a `1` prepended — it lives in the "top bit = 1" subcube.
- At the **seam** (`...0100` → `1100`) only the top bit changes, because the reversal makes the second half *begin* with the same lower bits the first half *ended* on (`100`).
- At the **wrap** (`1000` → `0000`) again only the top bit changes, because the reversal makes the second half *end* with the lower bits the first half *began* on (`000`).

**Proposition 4.2 (Length and coverage).** `|G_n| = 2^n` and `G_n` lists each of the `2^n` masks exactly once.

*Proof (induction).* `|G_1| = 2`. If `|G_{n−1}| = 2^{n−1}` and it is a permutation of `[0, 2^{n−1})`, then `0·G_{n−1}` is a permutation of `[0, 2^{n−1})` and `1·reverse(G_{n−1})` is a permutation of `[2^{n−1}, 2^n)`; their concatenation is a permutation of `[0, 2^n)` of length `2^n`. ∎

This recursive ("reflect and prefix") construction is the *definition* of the reflected binary Gray code; the closed form `g_x = x ⊕ (x ≫ 1)` (Section 6) is a theorem about it.

---

## 5. The One-Bit-Change Theorem (Proof)

**Theorem 5.1.** In `G_n`, consecutive elements differ in exactly one bit: `d_H(g_i, g_{i+1}) = 1` for all `0 ≤ i < 2^n − 1`. Moreover the code is **cyclic**: `d_H(g_{2^n − 1}, g_0) = 1`.

**Proof (induction on `n`).**

*Base `n = 1`.* `G_1 = (0, 1)`; `d_H(0, 1) = 1`, and cyclically `d_H(1, 0) = 1`. Holds.

*Inductive step.* Assume `G_{n−1}` has all consecutive Hamming distances `1` and is cyclic. Write `G_n = A · B` where `A = 0·G_{n−1}` and `B = 1·reverse(G_{n−1})`.

- **Within `A`:** consecutive pairs are `0·g_i, 0·g_{i+1}`; the new top bit is `0` in both, so the distance equals `d_H(g_i, g_{i+1}) = 1` by hypothesis.
- **Within `B`:** consecutive pairs are `1·g'_i, 1·g'_{i+1}` where `g'` runs through `reverse(G_{n−1})`; reversing does not change which pairs are adjacent (it only flips order), so each adjacent pair still differs in one bit (the top bit `1` is shared). Distance `1`.
- **At the seam `A → B`:** the last element of `A` is `0·(last of G_{n−1})` and the first element of `B` is `1·(last of G_{n−1})` — because `B` uses `reverse(G_{n−1})`, its first element is the *last* element of `G_{n−1}`. These two differ only in the new top bit (`0` vs `1`); the lower `n−1` bits are identical. Distance exactly `1`.
- **Cyclic closure:** the last element of `B` is `1·(first of G_{n−1})` (reverse puts the original first element last), and the first element of `A` is `0·(first of G_{n−1})`. They differ only in the top bit. Distance `1`.

All consecutive distances are `1` and the wrap-around distance is `1`. By induction, the theorem holds for all `n`. ∎

The reflection is *exactly* what makes the seam differ in one bit: by reusing the boundary element of `G_{n−1}` on both sides of the seam, only the freshly added top bit changes.

**Concrete check of the inductive step (`n = 2 → 3`).** `G_2 = (00, 01, 11, 10)`, all consecutive distances `1`, cyclic. Build `G_3`:
- `A = 0·G_2 = (000, 001, 011, 010)` — distances inherited from `G_2`, all `1`.
- `B = 1·reverse(G_2) = 1·(10, 11, 01, 00) = (110, 111, 101, 100)` — reversing keeps adjacency, distances all `1`.
- Seam: last of `A` is `010`, first of `B` is `110` — differ only in the top bit. Distance `1`. ✓
- Wrap: last of `B` is `100`, first of `A` is `000` — differ only in the top bit. Distance `1`. ✓

So `G_3 = (000,001,011,010,110,111,101,100)` is a valid one-bit-change cyclic code, exactly as the closed form `x ⊕ (x≫1)` produces (Section 6). The induction simply repeats this seam/wrap reasoning at every level.

**Why the count of single-bit-flips is balanced.** Across the `2^n` cyclic transitions, bit `i` flips exactly `2^{n-i}`... more precisely, summing the ruler sequence, bit `0` flips `2^{n-1}` times and the top bit flips exactly twice (once at the seam, once at the wrap) over the full cycle. This asymmetry is harmless for correctness but matters for hardware: the lowest tracks of an encoder switch far more often than the high tracks, which is why low-order bits dominate switching-power budgets.

---

## 6. The Conversion Formula g = x ^ (x >> 1) and Its Inverse (Correctness)

**Theorem 6.1 (Closed form).** The reflected Gray code of Section 4 satisfies `g_x = x ⊕ (x ≫ 1)` for every index `x ∈ [0, 2^n)`; that is, the `x`-th element of `G_n` (0-indexed) equals `x ⊕ (x ≫ 1)`.

**Proof.** We show two things: (i) the map `x ↦ x ⊕ (x≫1)` is a bijection on `[0, 2^n)`, and (ii) consecutive indices map to one-bit-apart values matching the reflected construction's ordering — then since both `G_n` and the formula start at `g_0 = 0` and produce a one-bit-change sequence, an induction pins them equal. We give the direct bit-level argument, which is cleaner.

*Bit formula.* Let `g = x ⊕ (x≫1)`. Then bit `i` of `g` is `g_i = x_i ⊕ x_{i+1}` (with `x_n = 0`). This is invertible: given `g`, recover `x` by `x_i = g_i ⊕ x_{i+1}`, i.e. the prefix XOR `x_i = ⊕_{j ≥ i} g_j` (Theorem 6.3). So the map is a bijection (Proposition 4.2 requires bijectivity, confirmed).

*Increment changes one Gray bit.* Consider going from index `x` to `x+1`. In binary, incrementing flips a maximal low run of `1`s to `0` and sets the next `0` to `1`: if `ν` is the position of the lowest `0` bit of `x` (equivalently the lowest set bit of `x+1`), then `x` has bits `0..ν−1` set and bit `ν` clear, and `x+1` has bits `0..ν−1` clear and bit `ν` set. Compute `d_H(g_x, g_{x+1})` where `g_x = x ⊕ (x≫1)`:
```
g_{x+1} ⊕ g_x = (x+1) ⊕ ((x+1)≫1) ⊕ x ⊕ (x≫1)
             = ((x+1) ⊕ x) ⊕ (((x+1) ⊕ x) ≫ 1).
```
Now `(x+1) ⊕ x = 2^{ν+1} − 1` (a run of `ν+1` ones in positions `0..ν`). Let `R = 2^{ν+1} − 1`. Then `g_{x+1} ⊕ g_x = R ⊕ (R ≫ 1)`. Since `R` is `0…0\underbrace{1…1}_{ν+1}` and `R ≫ 1` is `0…0\underbrace{1…1}_{ν}`, their XOR is a single `1` at position `ν`: `R ⊕ (R≫1) = 2^ν`. Therefore `g_x` and `g_{x+1}` differ in **exactly one bit**, position `ν = ν(x+1)` (the lowest set bit of `x+1`). 

Thus the formula produces a sequence starting at `g_0 = 0` in which each increment flips exactly one bit — the same defining property as the reflected construction, and (by the matching reflection structure, or by the bijection + shared start + identical single-bit-flip recurrence) the two sequences coincide elementwise. ∎

**Corollary 6.2 (Which bit flips).** Going from Gray index `x` to `x+1`, the flipped bit position is `ν(x+1)`, precisely the index of the lowest set bit of `x+1`. (Equivalently the ruler sequence.) This is the same value used in Section 8 to identify the toggled element.

*Remark.* It is worth stating why it is `ν(x+1)` and not `ν(x)`: the increment `x → x+1` is what flips the low run, and the *single* surviving Gray flip lands at the position of the lowest `0` of `x`, which is exactly the lowest set bit of `x+1`. A common off-by-one is to write `ν(x)`; for `x` even this happens to agree, but for `x` odd it does not, so always use `ν(x+1)` (equivalently `ν` of the *target* counter value when stepping forward).

### 6.0 Worked Inverse Trace (loop and doubling fold)

Recover `x` from `g = 0b1010` (`n = 4`). The bit-by-bit loop accumulates `x ^= g; g >>= 1`:

```
iter  g(before)  x(before)  x ^= g     g >>= 1
 1    1010       0000       1010       0101
 2    0101       1010       1111       0010
 3    0010       1111       1101       0001
 4    0001       1101       1100       0000
stop. x = 1100 = 12.    (check: gray(12) = 1100 ^ 0110 = 1010 ✓)
```

The `O(log n)` doubling fold computes the same prefix XOR in `⌈log₂ 4⌉ = 2` effective folds (the `>>2` and `>>1` steps are the active ones for a 4-bit value):

```
g = 1010
g ^= g >> 2  → 1010 ^ 0010 = 1000
g ^= g >> 1  → 1000 ^ 0100 = 1100 = 12  ✓
```

Both routes yield `x = 12`, confirming Theorem 6.3. For 32- or 64-bit widths the fold starts at `>>16` or `>>32` respectively and halves down to `>>1`.

**Theorem 6.3 (Inverse via prefix XOR).** Given a Gray value `g`, the original index is `x` with `x_i = ⊕_{j ≥ i} g_j`. The loop
```
x = 0
while g: x ^= g; g ≫= 1
```
computes this, and the `O(log n)` doubling form `g ^= g≫16; g ^= g≫8; …; g ^= g≫1` computes the same prefix XOR.

**Proof.** From `g_i = x_i ⊕ x_{i+1}` (Theorem 6.1) with `x_n = 0`, solve top-down: `x_{n−1} = g_{n−1}`, `x_{n−2} = g_{n−2} ⊕ x_{n−1} = g_{n−2} ⊕ g_{n−1}`, and inductively `x_i = g_i ⊕ g_{i+1} ⊕ … ⊕ g_{n−1}`. The loop accumulates `x ← x ⊕ (g ≫ s)` over shifts `s = 0, 1, 2, …`, and `(g ≫ s)` contributes `g_{i+s}` to bit `i`, so after all shifts bit `i` of `x` is `⊕_{s ≥ 0} g_{i+s} = ⊕_{j ≥ i} g_j`. The doubling form computes the same prefix-XOR by the standard parallel-prefix folding: after `g ^= g≫1`, bit `i` holds `g_i ⊕ g_{i+1}`; after `^= g≫2`, it folds in the next two; the geometric shifts cover all higher bits in `⌈log₂ n⌉` steps. ∎

---

## 7. Gray Code as a Hamiltonian Path/Cycle on the Hypercube

**Definition 7.1 (Hypercube `Q_n`).** Vertices are the `2^n` bitmasks; two are adjacent iff they differ in exactly one bit (Hamming distance `1`). `Q_n` is `n`-regular with `2^n` vertices and `n·2^{n−1}` edges.

**Theorem 7.2.** The reflected Gray code `G_n` is a **Hamiltonian cycle** of `Q_n`.

**Proof.** By Proposition 4.2, `G_n` visits all `2^n` vertices exactly once (a Hamiltonian *enumeration*). By Theorem 5.1, every consecutive pair differs in one bit, so each consecutive pair is an *edge* of `Q_n`, and the wrap-around pair `(g_{2^n−1}, g_0)` is also an edge. A vertex-spanning closed walk using only edges, visiting each vertex once, is a Hamiltonian cycle. ∎

**Corollary 7.3.** `Q_n` is Hamiltonian for all `n ≥ 2`, and (deleting the closing edge) `G_n` gives a Hamiltonian path for all `n ≥ 1`. This is a constructive existence proof: the explicit code *is* the cycle. Many Gray codes exist (any Hamiltonian cycle of `Q_n` is one); the reflected code is the canonical one with the `x ⊕ (x≫1)` closed form.

**Remark (count of Gray codes).** The number of distinct Hamiltonian cycles of `Q_n` grows astronomically (e.g. for `Q_4` there are 2688 directed Hamiltonian cycles up to nothing fixed; the exact enumeration is a hard combinatorial problem). The reflected code is one specific, easily computable representative — which is why it dominates in practice.

**Theorem 7.4 (Reflected code is symmetric / palindromic in transitions).** Let `δ_i` be the bit flipped between `g_{i-1}` and `g_i` (the transition sequence, `1 ≤ i < 2^n`). Then `δ` is the **ruler sequence**: `δ_i = ν(i)` (Corollary 6.2), and it is a palindrome of length `2^n − 1` with the value `n−1` appearing exactly once, at the center `i = 2^{n-1}`.

*Proof.* `δ_i = ν(i)` is Corollary 6.2. The ruler sequence `ν(1), ν(2), …, ν(2^n − 1)` reads `0,1,0,2,0,1,0,3,…` and is palindromic because `ν(i) = ν(2^n − i)` for `1 ≤ i < 2^n` (the two's-complement / reflection symmetry of trailing zeros around `2^{n-1}`), with the unique maximum `ν(2^{n-1}) = n−1` at the midpoint. ∎

**Geometric reading.** The single occurrence of the top transition `n−1` at the exact center is the "fold" of the reflected construction (Section 4): the first half stays in the `0`-prefixed subcube, the center transition crosses to the `1`-prefixed subcube along the highest coordinate, and the second half mirrors the first. This palindrome structure is the combinatorial fingerprint of "reflect and prefix," and it is the same structure that makes the Towers-of-Hanoi disk sequence a palindrome (Section 9).

**Theorem 7.5 (Hypercube subcubes ↔ fixed-bit subsets).** A face (subcube) of `Q_n` of dimension `m` is the set of `2^m` masks that agree on a fixed choice of `n − m` bits and range freely over the other `m`. The reflected Gray code restricted to any such face, in the induced order, is itself a reflected Gray code of `Q_m` — the construction is *self-similar*. This underlies why Karnaugh-map groupings (Section 9) are always rectangular power-of-two blocks: each is a subcube, and adjacency within it is again one-bit-change.

---

## 8. The Link Between Gray Order and Subset Enumeration

Since a one-bit change is exactly "add or remove one element," walking `G_n` enumerates every subset of `{0,…,n−1}` with a single element toggled per step.

**Theorem 8.1.** Let `S_x ⊆ {0,…,n−1}` be the subset whose mask is `g_x = x ⊕ (x≫1)`. Then `S_{x+1}` is obtained from `S_x` by toggling element `ν(x+1)` (the lowest set bit position of `x+1`): adding it if absent, removing it if present.

**Proof.** Immediate from Corollary 6.2: `g_{x+1} ⊕ g_x = 2^{ν(x+1)}`, a single bit. Toggling element `e = ν(x+1)` flips bit `e` of the mask, taking `g_x` to `g_{x+1}`; whether it is an add or a remove depends on whether bit `e` was `0` or `1` in `g_x`, i.e. `e ∉ S_x` or `e ∈ S_x`. ∎

**Corollary 8.2 (Incremental aggregates).** Any aggregate `f(S)` that updates in `O(1)` under a single element toggle (sum `Σ_{i∈S} w_i`, XOR, count of satisfied monotone constraints, etc.) can be maintained across the entire Gray enumeration in `O(2^n)` total — `O(1)` per subset — instead of `O(n·2^n)` for recompute-from-scratch. This is the algorithmic value of the one-bit-change order: it converts an `O(n)` per-subset recompute into an `O(1)` per-subset delta.

**Relation to Gosper.** Gosper enumerates a *single popcount class* in numeric order; Gray code enumerates *all popcounts* in minimal-change order. They are orthogonal: Gosper's consecutive masks generally differ in many bits (it moves a block), while Gray's consecutive masks differ in exactly one but jump across popcount classes. There is also a *combinations* Gray code (a minimal-change ordering of fixed-size subsets where each step swaps one element for another — Hamming distance 2 on the mask), distinct from both; it is the "revolving-door" / Eades-McKay ordering, used when you want fixed-size subsets *and* minimal change.

### 8.1 Worked Incremental-Aggregate Example

Let weights be `w = [5, 3, 8, 2]` (`n = 4`) and maintain the running subset sum `Σ_{i∈S} w_i` across the Gray walk, toggling one element per step (Theorem 8.1):

```
x   gray(x)  toggled elem ν(x)  action          subset S        sum
0   0000     —                  start (empty)    {}               0
1   0001     0                  +w[0]=5          {0}              5
2   0011     1                  +w[1]=3          {0,1}            8
3   0010     0                  -w[0]=5          {1}              3
4   0110     2                  +w[2]=8          {1,2}           11
5   0111     0                  +w[0]=5          {0,1,2}         16
6   0101     1                  -w[1]=3          {0,2}           13
7   0100     0                  -w[0]=5          {2}              8
8   1100     3                  +w[3]=2          {2,3}           10
...
```

Each row updates the sum in `O(1)` — a single add or subtract of the toggled element's weight — rather than recomputing `Σ_{i∈S} w_i` in `O(n)`. Over all `2^n` subsets this is the `O(2^n)` total of Corollary 8.2, the practical justification for choosing Gray order over a plain counter when an incremental aggregate is being maintained.

---

## 9. Connections: Towers of Hanoi, Karnaugh Maps, Combinatorial Number System

**Towers of Hanoi.** In the optimal solution of `n`-disk Hanoi, the disk moved at step `t` (1-indexed) is disk `ν(t)` — the lowest set bit of `t`. This is *exactly* the bit that flips between Gray indices `t−1` and `t` (Corollary 6.2). Hence the sequence of disks moved is the "ruler sequence," identical to the Gray code's flipped-bit sequence; both encode "the lowest position that rolls over when incrementing a counter." Formally, the state of Hanoi after `t` moves is in bijection with `g_t`, and the move structure is the Gray-code transition structure.

**Karnaugh maps.** A K-map labels its `2^a × 2^b` cells with Gray-coded coordinates so that horizontally/vertically adjacent cells differ in one input variable. Adjacency = Hamming distance 1 = a hypercube edge (Section 7). Groupable blocks of `1`s correspond to subcubes of `Q_n` (faces of the hypercube), which is why K-map simplification finds product terms: a `2^m`-cell rectangle is an `m`-dimensional subcube on which `n − m` variables are fixed, yielding a product term of `n − m` literals.

**Combinatorial number system (unranking).** The `C(n, k)` masks Gosper enumerates are in bijection with ranks `0, …, C(n,k)−1` via the **combinatorial number system**: a `k`-combination `c_1 > c_2 > … > c_k` has rank `Σ_{i=1}^k C(c_i, k−i+1)`. This gives a closed-form *unrank* (rank → mask) and *rank* (mask → rank), enabling random access into the sorted enumeration and parallel sharding (start Gosper at the unranked mask) without iterating from the beginning. The rank is consistent with Gosper's increasing-numeric order, so "the `m`-th Gosper output" is precisely the rank-`m` combination.

**Theorem 9.1 (Unrank correctness, sketch).** The combinatorial number system is a bijection between `{0,…,C(n,k)−1}` and `k`-subsets of `{0,…,n−1}`, order-preserving with respect to the colex order of subsets, which matches the increasing-mask order Gosper produces. Hence `unrank(m)` yields exactly the mask Gosper would output on its `m`-th step (0-indexed). The proof is the standard greedy decomposition: the largest element `c_1` is the unique value with `C(c_1, k) ≤ m < C(c_1 + 1, k)`, then recurse on `m − C(c_1, k)` with `k − 1`. ∎

### 9.1 Worked Unranking Example

Take `n = 6, k = 3`, rank `m = 7` (0-indexed). The masks in Gosper order are `7, 11, 13, 14, 19, 21, 22, 25, …`, so we expect `unrank(7) = 25 = 0b011001 = {0, 3, 4}`. Greedy decomposition:

```
k=3, m=7:  find largest c with C(c,3) ≤ 7.  C(4,3)=4 ≤ 7 < C(5,3)=10.  pick c1 = 4, m -= 4 → m=3
k=2, m=3:  find largest c with C(c,2) ≤ 3.  C(3,2)=3 ≤ 3 < C(4,2)=6.   pick c2 = 3, m -= 3 → m=0
k=1, m=0:  find largest c with C(c,1) ≤ 0.  C(0,1)=0 ≤ 0 < C(1,1)=1.   pick c3 = 0, m -= 0 → m=0
elements {4, 3, 0}  →  mask = 2^4 | 2^3 | 2^0 = 0b011001 = 25.  ✓
```

This matches the 8th Gosper output (index 7) exactly, confirming Corollary 3.3's colex correspondence and giving `O(1)` random access into the enumeration without iterating.

### 9.2 The Ranking Direction (Mask → Rank)

The inverse map, **rank**, takes a mask to its position in Gosper's order: list the set elements in decreasing order `c_1 > c_2 > … > c_k` and compute `rank = Σ_{i=1}^k C(c_i, k − i + 1)`. For `{4,3,0}`: `C(4,3) + C(3,2) + C(0,1) = 4 + 3 + 0 = 7`. ✓ Together, rank and unrank let a distributed system address any combination by an integer in `[0, C(n,k))`, enabling deterministic sharding and stateless pagination (Section 9 in [`senior.md`](./senior.md) and Task 10 in [`tasks.md`](./tasks.md)).

### 9.3 Worked Towers-of-Hanoi Correspondence

For `n = 3` disks, the optimal solution has `2^3 − 1 = 7` moves. The disk moved at step `t` is `ν(t)` (lowest set bit of `t`), 0-indexing the smallest disk as `0`:

```
t:        1  2  3  4  5  6  7
ν(t):     0  1  0  2  0  1  0      <- disk moved (0 = smallest)
gray(t):  1  3  2  6  7  5  4      <- the corresponding Gray state index
```

The disk-move sequence `0,1,0,2,0,1,0` is precisely the transition (flipped-bit) sequence of the 3-bit reflected Gray code (Theorem 7.4, the ruler sequence) — and it is the palindrome with the unique `2` (the largest disk) at the center. The largest disk moves exactly once, at the midpoint `t = 4 = 2^{n-1}`, mirroring the single top-bit flip at the center of the Gray code. This is not a loose analogy but an exact isomorphism of the two move structures.

---

## 9b. Worked Gray-Code Verification and Edge Bits

To anchor the conversion theorems, expand `g = x ⊕ (x ≫ 1)` and its inverse fully for `n = 4` and verify the one-bit invariant directly.

```
x    x>>1   gray=x^(x>>1)   d_H(gray_x, gray_{x-1})   flipped bit ν(x)
0000 0000   0000            —                          —
0001 0000   0001            1                          0
0010 0001   0011            1                          1
0011 0001   0010            1                          0
0100 0010   0110            1                          2
0101 0010   0111            1                          0
0110 0011   0101            1                          1
0111 0011   0100            1                          0
1000 0100   1100            1                          3
1001 0100   1101            1                          0
1010 0101   1111            1                          1
1011 0101   1110            1                          0
1100 0110   1010            1                          2
1101 0110   1011            1                          0
1110 0111   1001            1                          1
1111 0111   1000            1                          0
cyclic: d_H(gray_15=1000, gray_0=0000) = 1            (Theorem 5.1 closure)
```

Every Hamming distance is `1`, the flipped bit equals `ν(x)` (Corollary 6.2), and the transition column `0,1,0,2,0,1,0,3,0,1,0,2,0,1,0` is the palindromic ruler sequence with the unique `3` at the center `x = 8 = 2^{n-1}` (Theorem 7.4). The cyclic closure confirms the Hamiltonian *cycle* of Theorem 7.2. Inverting any row, e.g. `inverse(gray=1010) = 1010 ⊕ 0101 ⊕ 0010 ⊕ 0001`-style prefix XOR, recovers `x = 1100 = 12`, matching the table.

**Boundary bit behavior.** The most significant Gray bit always equals the most significant binary bit (`g_{n-1} = x_{n-1} ⊕ x_n = x_{n-1}` since `x_n = 0`). This means the Gray code's top bit partitions the sequence into the lower half (top bit `0`, indices `0…2^{n-1}-1`) and upper half (top bit `1`, indices `2^{n-1}…2^n-1`) — exactly the reflect-and-prefix halves of Section 4, observable directly in the table above where `gray_x` has top bit `1` precisely for `x ≥ 8`.

## 10. Complexity and Lower Bounds

**Gosper.**
- One step: `O(1)` word operations (one AND, one negate, one add, one XOR, one shift, one exact divide, one OR).
- Full `k`-subset enumeration: `Θ(C(n, k))` time, `O(1)` extra space (Corollary 3.2). This is **optimal**: any algorithm that *outputs* all `C(n, k)` combinations must spend `Ω(C(n, k))` time just to emit them, and `Ω(1)` per item to produce a distinct one; Gosper matches both with the smallest possible constant and no auxiliary memory.

**Gray code.**
- Forward `g = x ⊕ (x≫1)`: `O(1)`.
- Inverse (prefix XOR): `O(n)` naive, `O(log n)` by doubling (Theorem 6.3). The `O(log n)` is optimal for a fixed-width prefix-XOR fold under the standard word-RAM (each fold at least halves the unresolved span).
- Full sequence: `Θ(2^n)`, optimal by the output-size argument.

**Lower-bound remark.** Both are *output-optimal*: the bottleneck is the size of the thing enumerated (`C(n, k)` or `2^n`), which is intrinsic, not the per-item work, which is constant. No cleverness reduces the count; the value of these tricks is the `O(1)` constant and zero allocation, not an asymptotic improvement over the output size.

**Word-size caveat.** All `O(1)` claims assume operations on `n`-bit words are unit cost (word-RAM, `n ≤` machine word). For `n` beyond the word width, each operation costs `O(n / w)` on `⌈n/w⌉`-word bigints, multiplying the bounds accordingly (see [`senior.md`](./senior.md)).

### 10.1 Amortized vs Worst-Case per Step

A subtle point: every individual Gosper step is `O(1)` in the *worst case* on the word-RAM, not merely amortized. The ripple carry of `r = x + c` is a single hardware add — its `O(1)` cost does not depend on the block length `b`, because addition is a unit-cost word operation, not a bit-by-bit loop. Contrast this with a naive "find the block, shift it manually" implementation, which would be `O(b)` per step and `O(n)` worst case. The genius of the formula is that it offloads the variable-length block manipulation onto the constant-time hardware adder. So the `Θ(C(n,k))` total is a genuine worst-case bound, with no amortization argument needed.

### 10.2 Comparison of Generation Paradigms

| Method | Per item | Extra space | Order | Random access |
|--------|----------|-------------|-------|----------------|
| Gosper's hack | `O(1)` worst case | `O(1)` | increasing (= colex) | via unrank `O(n)` |
| Recursive backtracking | `O(k)` amortized to build tuple | `O(k)` stack | lexicographic | no (sequential) |
| Banker's / revolving-door | `O(1)` amortized | `O(k)` | minimal-change (swap) | partial |
| Naive popcount scan | `O(2^n / C(n,k))` per valid | `O(1)` | increasing | no |

Gosper is the unique row that achieves `O(1)` worst-case per item, `O(1)` space, *and* random access (through unranking). Its only structural limitation is the word-size ceiling and that it always produces the *full* class (no pruning), addressed in [`senior.md`](./senior.md).

### 10.3 Information-Theoretic Lower Bound on Gray Conversion

The forward conversion `g = x ⊕ (x ≫ 1)` is `O(1)`, trivially optimal. For the inverse, any algorithm must, in the worst case, read all `n` bits of `g` (each can influence the lowest output bit via the prefix XOR), so `Ω(n)` *bit reads* are required — but on a word-RAM the `O(log n)` doubling fold (Theorem 6.3) processes those `n` bits in parallel `⌈log₂ n⌉` word operations, which is optimal among parallel-prefix circuits: a prefix-XOR of `n` bits has circuit depth `Θ(log n)`, matching the fold. So `O(log n)` word ops is the right complexity, and the `O(n)` bit-loop is only optimal in a model without word-parallelism.

## 10b. Relationship to the Binary-Reflected Construction of Other Combinatorial Objects

The reflect-and-prefix idea generalizes far beyond bit strings, and recognizing the pattern clarifies why Gray codes appear so widely.

**Definition 10b.1 (Combinatorial Gray code, general).** A Gray code for a class `C` of combinatorial objects is a listing of all of `C` such that successive objects differ by a *small, fixed-type* change (a "closeness" relation). For bit strings the change is "flip one bit"; for permutations it is "swap two adjacent elements" (the Steinhaus-Johnson-Trotter code); for `k`-subsets it is "exchange one element" (the revolving-door code); for spanning trees, "swap one edge."

**Theorem 10b.2 (Reflection scheme is universal for product structures).** If a class `C_n` decomposes as `C_{n-1} × {0, 1}` (append a binary choice) with a Gray code on `C_{n-1}`, then `C_n` has a Gray code given by `0·G(C_{n-1})` followed by `1·reverse(G(C_{n-1}))`, by the identical seam argument of Theorem 5.1. The reflected binary Gray code is the instance `C_n = {0,1}^n`.

*Proof.* Verbatim Theorem 5.1: within each half the change type is inherited; at the seam only the appended choice flips because the reversal reuses the boundary object. ∎

This is why "reflect the previous list and prefix the new symbol" is a *design pattern* for minimal-change enumeration, not a one-off trick for bits. The closed form `x ⊕ (x ≫ 1)` is special to the binary case (it exploits that the prefix is a single bit and arithmetic shift aligns the recursion), but the *cycle on a graph of objects* viewpoint (Section 7) transfers: any such Gray code is a Hamiltonian path on the "object-change" graph.

**Corollary 10b.3 (Why Gosper is *not* a Gray code).** Gosper's increasing-mask order is a *lexicographic/colex* enumeration, not a minimal-change one — successive masks can differ in up to `b + 1` bits (Lemma 2.3). To enumerate fixed-size subsets with minimal change you need the revolving-door code (one-element swap, mask Hamming distance 2), a different algorithm. Gosper trades minimal change for sorted order and `O(1)` random-access unranking; the revolving-door code trades sorted order for minimal change. The two are the canonical fixed-size-subset duals.

---

## 10c. Generating Functions and the Algebra of Popcount Classes

The count `C(n, k)` of masks Gosper enumerates is the coefficient extraction `[z^k](1 + z)^n`, and viewing the enumeration through generating functions sharpens several facts.

**Proposition 10c.1 (Layer sizes).** The number of `n`-bit masks of popcount `k` is `[z^k](1+z)^n = C(n,k)`, and `Σ_{k=0}^n C(n,k) = 2^n` (set `z = 1`), recovering Corollary 3.2's total. The generating function `(1 + z)^n` is the "one binary choice per element" product, the algebraic shadow of the subset-as-mask bijection.

**Proposition 10c.2 (Gosper enumerates a single coefficient's worth).** Fixing `k`, Gosper's loop visits exactly the `C(n,k)` lattice points of the popcount-`k` "slice" of the Boolean lattice, in colex order (Corollary 3.3). The colex order corresponds to reading the monomials of `(1+z)^n` weighted by `2^{positions}` — i.e. the integer value — which is why the order is well-defined and total.

**Proposition 10c.3 (Banker's-sequence view).** The transition graph whose vertices are popcount-`k` masks and whose edges connect a mask to its Gosper successor is a *Hamiltonian path* (a single chain through all `C(n,k)` masks in increasing order). It is **not** a subgraph of the Hamming-distance-1 hypercube (successors differ in `b+1` bits, Lemma 2.3), which is exactly why Gosper is a lexicographic, not a minimal-change, code (Corollary 10b.3). The minimal-change counterpart (revolving-door) *is* a Hamiltonian path on the "distance-2 within fixed popcount" graph, the so-called **middle-levels**-style structure; the deep open problem of whether the bipartite middle-levels graph is Hamiltonian (resolved affirmatively by Mütze, 2016) lives in this exact neighborhood.

**Corollary 10c.4 (Symmetry `C(n,k) = C(n,n-k)`).** Complementing every bit (`x ↦ (2^n − 1) ⊕ x`) is an involution mapping popcount-`k` masks to popcount-`(n−k)` masks, bijectively — the generating-function symmetry `(1+z)^n` palindromic coefficients. Practically, to enumerate `(n−k)`-subsets you may enumerate `k`-subsets with Gosper and complement, which is faster when `k < n − k` (fewer block manipulations on sparser masks), a small but real constant-factor optimization.

**Relation to the Gray-code generating function.** The reflected Gray code, read as a sequence of integers, has no simple ordinary generating function (it is a permutation, not a counting sequence), but its *transition* sequence (the ruler sequence `ν`) has the well-known relation `Σ_t ν(t) z^t` tied to `Σ_{j≥0} z^{2^j}/(1 − z^{2^j})` — the highest power of 2 dividing `t`. This analytic handle is mainly of theoretical interest but confirms the palindrome and self-similarity facts (Theorems 7.4, 7.5) at the level of formal power series.

## 11. Summary

- **Gosper's next-combination theorem (Section 2):** `y = (((r ⊕ x) ≫ 2)/c) | r` with `c = x & −x`, `r = x + c` is the unique smallest integer `> x` of the same popcount. The carry analysis: `r` advances the lowest block's top bit (Lemma 2.2), `r ⊕ x` is the `(b+1)`-bit change run (Lemma 2.3), and `((r⊕x)≫2)/c = 2^{b−1} − 1` repacks the freed `b − 1` ones at the bottom (Lemma 2.4) — minimal because the freed ones sit as far right as possible.
- **Iteration count (Section 3):** from `2^k − 1` to `((1≪k)−1)≪(n−k)`, the loop emits exactly `C(n, k)` masks, strictly increasing, each once.
- **Reflected Gray code (Section 4):** defined by reflect-and-prefix; covers all `2^n` masks (Proposition 4.2).
- **One-bit-change (Section 5):** proved by induction — the seam and the cyclic closure each change only the new top bit because the reflection reuses the boundary element, so `d_H(g_i, g_{i+1}) = 1` and the code is a cycle.
- **Conversion formula (Section 6):** `g = x ⊕ (x≫1)` is correct because incrementing `x` flips a run `R = 2^{ν+1} − 1`, and `R ⊕ (R≫1) = 2^ν` is a single bit; the inverse is the prefix XOR `x_i = ⊕_{j ≥ i} g_j`, computable in `O(n)` or `O(log n)`.
- **Hypercube (Section 7):** `G_n` is a Hamiltonian cycle of `Q_n` (spans all vertices, consecutive pairs are edges), a constructive proof that `Q_n` is Hamiltonian.
- **Subset enumeration (Section 8):** Gray order toggles one element per step (the lowest set bit of the counter), enabling `O(1)` incremental aggregate updates; distinct from Gosper's single-popcount numeric order and from the revolving-door combination Gray code.
- **Connections (Section 9):** the Gray flipped-bit sequence equals the Hanoi disk-move sequence (ruler sequence `ν(t)`), K-map adjacency is hypercube adjacency, and the combinatorial number system unranks Gosper's output for random access and sharding.
- **Complexity (Section 10):** both are output-optimal — `Θ(C(n,k))` / `Θ(2^n)` total, `O(1)` per item, `O(1)`/`O(log n)` for the conversions — with the value being the constant factor and zero allocation, not an asymptotic win over the output size.

### Misconceptions Refuted (with the governing result)

- "Gosper produces a Gray code."
  - **False.** Gosper's successors differ in up to `b + 1` bits (Lemma 2.3); it is a *lexicographic/colex* code, not a minimal-change one (Corollary 10b.3). The fixed-size minimal-change code is the revolving-door code.
- "The division `/c` could lose information / round."
  - **False.** `(r ⊕ x)` is an exact multiple of `c` (Lemma 2.4); the quotient is `2^{b−1} − 1`, an integer, independent of `p`. Float division is the *only* way to break it.
- "Gray-to-binary needs a table."
  - **False.** It is the prefix XOR `x_i = ⊕_{j≥i} g_j` (Theorem 6.3), computable in `O(n)` or `O(log n)` with no precomputation.
- "Every Gray code is the reflected one."
  - **False.** Any Hamiltonian cycle of `Q_n` is *a* Gray code (Theorem 7.2); there are astronomically many. The reflected code is the canonical one with the closed form `x ⊕ (x≫1)`.
- "Gosper makes a large `C(n,k)` tractable."
  - **False.** It is output-optimal (Section 10): the wall is `C(n,k)` itself, which the `O(1)` step cannot shrink.
- "`x & -x` works on any big-integer type."
  - **Caveat.** It relies on two's-complement semantics for `-x`; some bigint libraries do not model that for `&`, requiring an explicit lowest-set-bit routine (see [`senior.md`](./senior.md)).

### Worked Summary Trace (both techniques, side by side)

For `n = 4`:

```
Gosper, k = 2 (increasing-mask order, multi-bit jumps):
  0011 → 0101 → 0110 → 1001 → 1010 → 1100      (C(4,2) = 6 masks)
  consecutive XORs: 0110, 0011, 1111, 0011, 0110  (popcounts 2,2,4,2,2 — NOT a Gray code)

Gray, n = 4 (minimal-change, one bit per step, all 16 masks):
  0000 0001 0011 0010 0110 0111 0101 0100
  1100 1101 1111 1110 1010 1011 1001 1000
  consecutive XORs all have popcount 1; cyclic closure 1000⊕0000 = popcount 1
```

The contrast is the whole point: Gosper sorts within one popcount class but jumps many bits; Gray changes one bit but spans all classes. They are complementary tools, formalized respectively by Theorem 2.1 (next-combination) and Theorem 5.1 (one-bit-change).

### Theorem Cheat Table

| Result | Statement | Section |
|--------|-----------|---------|
| Next-combination | Gosper yields the smallest larger same-popcount integer | 2 |
| Count | Loop emits exactly `C(n,k)` masks | 3 |
| One-bit-change | `d_H(g_i, g_{i+1}) = 1`; reflected code is cyclic | 5 |
| Conversion | `g = x ⊕ (x≫1)`; inverse is prefix XOR | 6 |
| Hamiltonicity | `G_n` is a Hamiltonian cycle of `Q_n` | 7 |
| Toggle identity | step `x→x+1` toggles element `ν(x+1)` | 6, 8 |
| Unranking | combinatorial number system ↔ Gosper order | 9 |

### Closing Notes

- **Carry as the engine.** Gosper's correctness rests entirely on the ripple-carry of `r = x + c` (Lemma 2.2): the hardware adder does in `O(1)` what a manual block-shift would do in `O(b)`. The XOR and divide merely repack the residue. Understanding the carry is understanding the hack.
- **Reflection as the engine (Gray).** Every Gray-code property — one-bit-change (Theorem 5.1), the palindromic ruler transition sequence (Theorem 7.4), self-similar subcubes (Theorem 7.5), and the Hanoi correspondence (Section 9) — flows from the single "reflect and prefix" construction reusing the boundary element. The closed form `x ⊕ (x≫1)` is a *consequence*, proved in Section 6, not the definition.
- **Output-optimality, not magic.** Both are `Θ(output)` total with `O(1)` per item (Section 10); neither shrinks the intrinsic count `C(n,k)` or `2^n`. Their value is the constant factor and zero allocation.
- **The two duals.** For fixed-size subsets you choose between Gosper (sorted, multi-bit jumps, `O(1)` random-access unrank) and the revolving-door code (minimal change, one-element swaps). For all subsets you choose between a plain counter and the reflected Gray code (minimal change). Knowing which order a problem rewards is the design decision the proofs equip you to make.
- **Where the abstraction generalizes.** The reflect-and-prefix scheme (Theorem 10b.2) builds minimal-change codes for permutations, trees, and any product-structured class; the hypercube-Hamiltonicity view (Theorem 7.2) reframes them all as Hamiltonian paths on object-change graphs, a unifying lens for the entire field of combinatorial generation.

Foundational references: Knuth, *TAOCP* Vol. 4A (combinatorial generation, Gray codes §7.2.1.1, combinations §7.2.1.3); Warren, *Hacker's Delight* (Gosper's hack, Gray-code conversions); Frank Gray, US Patent 2,632,058 (1953) for the reflected code; HAKMEM (MIT AI Memo 239, item 175) for Gosper's combination trick; Savage, "A Survey of Combinatorial Gray Codes" (SIAM Review, 1997); Mütze, "Proof of the middle levels conjecture" (Proc. LMS, 2016). Sibling topics: `02-bit-tricks`, `04-subset-enumeration`.
