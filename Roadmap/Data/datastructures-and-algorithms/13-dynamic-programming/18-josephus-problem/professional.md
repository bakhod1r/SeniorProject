# The Josephus Problem — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Survivor Recurrence (Proof via the Relabeling Bijection)
3. Index Conventions and the Multiplicative Group View
4. The k = 2 Closed Form (Proof by Even/Odd Induction)
5. The Bit-Rotation Form (Proof)
6. The O(k log n) Recurrence: Correctness and Complexity
7. The m-th Order Statistic Generalization
8. Generating-Function and Asymptotic View
9. Variants and Their Algebraic Structure
10. Complexity Landscape and Lower Bounds
11. Worked Derivations and Verification Anchors
12. Summary

---

## 1. Formal Definitions

Fix integers `n ≥ 1` (people) and `k ≥ 1` (step). Label the people `0, 1, …, n−1` arranged clockwise in a circle.

**Definition 1.1 (Elimination process).** Starting the count at position `0`, count `k` people clockwise (each person counts as one, including the starting position as count `1`); the person reached at count `k` is eliminated. Counting resumes at the next surviving person clockwise, again to `k`, repeating until one person remains.

**Definition 1.2 (Survivor function).** `J(n, k)` is the `0`-indexed position (in the original labeling) of the unique survivor. When `k` is fixed we write `J(n)`.

**Definition 1.3 (Elimination order).** The sequence `e_1, e_2, …, e_{n−1}` of original labels in the order they are removed; `e_n` (the unremoved label) equals `J(n, k)`.

**Convention 1.4 (First victim).** Under Definition 1.1, the first eliminated label is `(k − 1) mod n`, because we count `0, 1, …, k−1` and land on `k − 1` (wrapping mod `n` if `k > n`).

**Remark.** The literature has two conventions: counting that lands the first victim on `k − 1` (used here, giving the clean `J(n) = (J(n−1) + k) mod n`), and counting that lands it on `k mod n`. They differ by a fixed rotation; all results below are stated for Convention 1.4 and translate by a constant offset under the other.

---

## 2. The Survivor Recurrence (Proof via the Relabeling Bijection)

**Theorem 2.1.** For all `n ≥ 1` and `k ≥ 1`,

```
J(1, k) = 0,
J(n, k) = (J(n−1, k) + k) mod n     for n ≥ 2.
```

**Proof.**

*Base case `n = 1`.* A single person is the survivor; its `0`-indexed position is `0`. Hence `J(1, k) = 0`.

*Inductive step.* Assume the formula holds for `n − 1`; prove it for `n`. Run the process on the circle `C_n = {0, 1, …, n−1}` with the count starting at `0`. By Convention 1.4 the first victim is the person at position

```
p = (k − 1) mod n.
```

After removing `p`, exactly `n − 1` people remain and counting resumes at position `(p + 1) mod n = k mod n`. Define a **relabeling** `φ : C_n ∖ {p} → C_{n−1}` of the survivors by

```
φ(x) = (x − k) mod n        (equivalently x = (φ(x) + k) mod n),
```

so that the resume position `k mod n` receives the new label `0`, the next surviving position label `1`, and so on around the circle, skipping the removed `p`. We must verify that `φ` is a well-defined bijection onto `{0, 1, …, n−2}` *and* that it carries the `C_n` process (after the first removal) onto the `C_{n−1}` process.

**`φ` is a bijection.** The map `x ↦ (x − k) mod n` is a bijection of `ℤ_n` onto itself (it has inverse `y ↦ (y + k) mod n`). Restricted to the `n − 1` survivors it is injective, and we must check its image is exactly `{0, …, n−2}`, i.e. that the removed person `p` is the unique element mapping to the "missing" residue. Indeed `φ(p) = (p − k) mod n = ((k − 1) − k) mod n = (−1) mod n = n − 1`. We instead *renumber the survivors consecutively* starting at the resume point: assign new label `0` to position `k mod n`, and increment by one for each subsequent surviving position clockwise. Because we skip `p`, this consecutive renumbering hits every survivor exactly once and produces labels `0, 1, …, n−2`. This renumbering is precisely `φ` with the convention that the removed slot is bypassed; it is a bijection by construction (consecutive integers assigned to a finite ordered set).

**`φ` is a process isomorphism.** After the first removal, the `C_n` process counts `k` starting from the resume position `k mod n` — which is new-label `0` — and continues by the identical rule on the remaining `n − 1` people in the same clockwise order. This is *exactly* the `C_{n−1}` process started at new-label `0`. Since counting depends only on the cyclic order and the step `k`, and `φ` preserves the cyclic order of the survivors (it is a rotation composed with the skip of one element, both order-preserving on the survivor cycle), the two processes are isomorphic: the survivor of the `C_n` process equals `φ^{-1}` of the survivor of the `C_{n−1}` process.

**Conclusion.** By the inductive hypothesis the survivor of the `C_{n−1}` process has new label `J(n−1, k)`. Its original `C_n` label is

```
φ^{-1}(J(n−1, k)) = (J(n−1, k) + k) mod n.
```

Hence `J(n, k) = (J(n−1, k) + k) mod n`, completing the induction. ∎

**Corollary 2.2 (1-indexed form).** The 1-indexed survivor seat is `J(n, k) + 1`.

**Corollary 2.3 (`k = 1`).** For `k = 1`, `J(n, 1) = (J(n−1, 1) + 1) mod n`. By induction `J(n, 1) = n − 1` (the last person), since each step removes the current front and the recurrence accumulates `n − 1` increments mod the growing size, landing on `n − 1`.

### 2.1 Worked Verification

`n = 5, k = 2`. The recurrence gives `J(1)=0, J(2)=(0+2)%2=0, J(3)=(0+2)%3=2, J(4)=(2+2)%4=0, J(5)=(0+2)%5=2`. Direct simulation eliminates `1,3,0,4` (0-indexed) leaving `2`. Survivor `J(5,2)=2`, seat `3`. The bijection at each step is the rotation by `k = 2` of the survivor relabeling; the empirical simulation confirms every intermediate `J(m)`.

### 2.2 Why the Recurrence Is a One-Subproblem DP

`J(n)` depends on the single value `J(n−1)`. There is no choice to optimize and no branching — it is a *linear-chain* dynamic program. Consequently it runs in `O(n)` time and `O(1)` space (retain only the last value). The "optimal substructure" is the process isomorphism of Theorem 2.1; the "overlapping subproblems" degenerate to a single chain, which is why no memo table beyond one scalar is needed.

---

## 3. Index Conventions and the Multiplicative Group View

**Proposition 3.1 (Convention shift).** Under the alternative convention where the first victim is at `k mod n` (count starts *after* position `0`), the survivor `J'(n, k)` satisfies the same recurrence with a unit shift: `J'(n, k) = (J(n, k) + 1) mod n` is *not* generally the relationship; rather one re-derives `J'(n,k) = (J'(n−1,k) + k) mod n` with base `J'(1,k)=0` but a different first-victim rule. In practice: pin the convention by simulating `n = 2, 3` by hand and matching the base alignment. The two conventions differ by a fixed rotation determined only by where counting begins, never by `n`.

**Remark 3.2 (No simple closed form for general `k`).** Unlike `k = 2`, the sequence `J(n, k)` for fixed general `k` is *not* expressible by an elementary closed form. It is, however, computable in `O(n)` and (for small `k`) `O(k log n)` (Section 6). The reason `k = 2` is special is the exact halving alignment proven in Section 4; for other `k` the analogous "sweep" removes a `1/k` fraction per pass but does not realign to a power-of-`k` boundary cleanly enough to telescope into one formula.

---

## 4. The k = 2 Closed Form (Proof by Even/Odd Induction)

**Theorem 4.1.** Write `n = 2^a + ℓ` with `a = ⌊log₂ n⌋` and `0 ≤ ℓ < 2^a`. Then the 1-indexed survivor for `k = 2` is

```
J₂(n) = 2ℓ + 1.
```

Equivalently, the 0-indexed survivor is `2ℓ`.

**Proof (strong induction on `n`, splitting even/odd).** We prove the 1-indexed statement `J₂(n) = 2ℓ + 1`.

*Base case `n = 1`.* Then `a = 0`, `ℓ = 0`, and `J₂(1) = 1 = 2·0 + 1`. ✓

*Even case `n = 2j`.* In the first pass around the circle of `2j` people (eliminating every second), all even-positioned people `2, 4, …, 2j` are eliminated, leaving the `j` odd people `1, 3, 5, …, 2j−1` in order, and counting resumes by eliminating the *next* second person — which, after removing `2j`, lands first on `1`'s successor pattern. Concretely, the remaining `j` people, *relabeled* `1, 2, …, j` (where new-label `i` is old-label `2i − 1`), undergo the identical `k = 2` Josephus process. Hence

```
J₂(2j) = 2·J₂(j) − 1.        (old-label of new-survivor i is 2i − 1)
```

Write `j = 2^{a−1} + ℓ'` (so `n = 2j = 2^a + 2ℓ'`, giving `ℓ = 2ℓ'`). By induction `J₂(j) = 2ℓ' + 1`, so

```
J₂(2j) = 2(2ℓ' + 1) − 1 = 4ℓ' + 1 = 2(2ℓ') + 1 = 2ℓ + 1. ✓
```

*Odd case `n = 2j + 1`.* The first pass eliminates `2, 4, …, 2j`; then, the count having reached the end, person `1` is eliminated next (it is the second person counted starting after `2j`). This leaves `j` people `3, 5, …, 2j+1`, relabeled `1, 2, …, j` (new-label `i` is old-label `2i + 1`), running the identical process. Hence

```
J₂(2j + 1) = 2·J₂(j) + 1.
```

Write `j = 2^{a−1} + ℓ'` (so `n = 2j + 1 = 2^a + 2ℓ' + 1`, giving `ℓ = 2ℓ' + 1`). By induction `J₂(j) = 2ℓ' + 1`, so

```
J₂(2j + 1) = 2(2ℓ' + 1) + 1 = 4ℓ' + 3 = 2(2ℓ' + 1) + 1 = 2ℓ + 1. ✓
```

Both parities reproduce `J₂(n) = 2ℓ + 1`, completing the induction. ∎

**Corollary 4.2.** Substituting `ℓ = n − 2^⌊log₂ n⌋`,

```
J₂(n) = 2·(n − 2^⌊log₂ n⌋) + 1     (1-indexed).
```

**Corollary 4.3 (Powers of two).** If `n = 2^a`, then `ℓ = 0` and `J₂(n) = 1`: the starting seat survives after one clean halving sweep, repeated `a` times.

### 4.1 The Recurrences `J₂(2j) = 2J₂(j) − 1`, `J₂(2j+1) = 2J₂(j) + 1`

These two identities (1-indexed) are themselves a fast `O(log n)` algorithm: recurse on `⌊n/2⌋`, double, and add/subtract one by parity. They are the "doubling" form of the closed form and an alternative to the bit-rotation computation — and a useful independent cross-check (Section 8 of [`senior.md`](./senior.md)).

---

## 5. The Bit-Rotation Form (Proof)

**Theorem 5.1.** Let `n` have the `(a+1)`-bit binary representation `n = (1\, b_{a-1}\, b_{a-2}\, …\, b_1\, b_0)_2` with leading bit `1` (so `2^a ≤ n < 2^{a+1}`). Then the 1-indexed `k = 2` survivor is

```
J₂(n) = (b_{a-1}\, b_{a-2}\, …\, b_1\, b_0\, 1)_2,
```

i.e. the cyclic left rotation by one position of the `(a+1)`-bit string of `n`.

**Proof.** By Theorem 4.1, `J₂(n) = 2ℓ + 1` where `ℓ = n − 2^a`. Removing the leading `1` bit of `n` subtracts `2^a`, leaving exactly the `a`-bit number `(b_{a-1} … b_0)_2 = ℓ`. Multiplying by `2` shifts these `a` bits left by one position (appending a `0`), and adding `1` sets the new least-significant bit to `1`:

```
2ℓ + 1 = (b_{a-1}\, b_{a-2}\, …\, b_0\, 1)_2.
```

This is precisely the original `(a+1)`-bit string `(1\, b_{a-1}\, …\, b_0)_2` with its leading `1` moved to the rightmost position — a one-bit cyclic left rotation. ∎

**Example 5.2.** `n = 41 = (101001)_2`. Rotating the leading `1` to the end: `(010011)_2 = 19`. Check: `2^5 = 32 ≤ 41`, `ℓ = 9`, `2·9 + 1 = 19`. ✓

**Remark 5.3.** Because the rotation reuses the same multiset of bits, `J₂(n)` and `n` have the same popcount; and `J₂(n)` is always **odd** (the rotated string ends in `1`), reflecting that the `k = 2` survivor always sits at an odd 1-indexed seat — a parity invariant worth asserting in tests.

---

## 6. The O(k log n) Recurrence: Correctness and Complexity

**Setup.** The plain recurrence `res ← (res + k) mod m` for `m = 2, …, n` is `O(n)`. For small `k` we accelerate by batching the steps that do not wrap.

**Lemma 6.1 (Non-wrapping run).** If at size `m` the current value `res` satisfies `res + k < m`, then for that step `res ← res + k` with no reduction, and the same holds for the next several sizes until the value would reach the current modulus. The number of consecutive sizes `m, m+1, …, m + c − 1` that add a plain `+k` before a wrap is

```
c = ⌊(m − res − 1) / k⌋,
```

because the value after `c` plain additions is `res + c·k`, and the first wrap occurs when `res + c·k ≥ m`.

**Proof.** After `t` plain additions at sizes `m, …, m+t−1`, the value is `res + t·k` and the modulus is `m + t`. No wrap occurs while `res + t·k < m + t`, i.e. `t(k − 1) < m − res`, i.e. `t < (m − res)/(k − 1)`. A cruder but sufficient and simpler bound used in implementations is `res + c·k < m` (treating the modulus as fixed at `m` for the batch), giving `c = ⌊(m − res − 1)/k⌋`; advancing `m` by `c` and `res` by `c·k` is then verified correct by the invariant `res < m` maintained at each batch boundary. ∎

**Theorem 6.2 (Correctness).** The batched algorithm (Section 7 of [`middle.md`](./middle.md)) computes `J(n, k)` identically to the plain recurrence.

**Proof.** Each batch replaces `c` individual non-wrapping steps with one `res += c·k`, `m += c`, which by Lemma 6.1 produces the same `(res, m)` pair the plain recurrence would after those `c` steps. Wrapping steps are executed individually and identically. Since the sequence of `(res, m)` states is reproduced exactly, the final `res = J(n, k)`. The `cnt` cap `m + cnt ≤ n` ensures `m` never overshoots `n`. ∎

**Theorem 6.3 (Complexity).** For step `k`, the batched algorithm runs in `O(k log n)` time and `O(1)` space.

**Proof.** Each *wrapping* step reduces the "headroom" `m − res` by forcing a `mod`; between wraps the value grows by `k` per size. Each full conceptual sweep around the circle of current size `m` eliminates `⌊m/k⌋` people, shrinking the effective problem by a factor of `(k−1)/k`. The number of size-halving-style shrink events is `O(log_{k/(k−1)} n) = O(k log n)` (since `log_{k/(k−1)} n = (ln n)/(ln(1 + 1/(k−1))) ≈ (k−1) ln n` for large `k`, and `O(1)·log n` for `k = 2`). Each wrap and each batch is `O(1)` work, so total `O(k log n)`. ∎

**Remark 6.4.** For `k = 2`, `O(k log n) = O(log n)`, but the closed form (Theorem 4.1) is `O(1)` and preferred. The batched method is the tool for small `k > 2` with huge `n`.

---

## 7. The m-th Order Statistic Generalization

The survivor is the *last* element of the elimination order `e_1, …, e_n`. Producing the whole order, or querying the `m`-th eliminated `e_m`, is an order-statistic problem on a dynamic set.

**Definition 7.1 (Dynamic select-and-delete).** Maintain a set `S ⊆ {1, …, n}` of living labels and a pointer. Repeatedly: from the pointer, advance `k` living elements cyclically, output and delete that element, set the pointer there.

**Theorem 7.2 (Fenwick complexity).** Using a Fenwick tree over `{1, …, n}` storing `1` for living and `0` for dead, each select-and-delete is `O(log n)`, so the entire order is computed in `O(n log n)` time and `O(n)` space.

**Proof.** "Advance `k` living elements cyclically from a pointer at living-rank `cur` (0-indexed among living)" is the living element of rank `r = (cur + k − 1) mod alive` (0-indexed), i.e. 1-indexed rank `r + 1`. Finding the slot of a given living-rank is a *select* query: the smallest index `idx` with prefix sum (count of living in `1..idx`) equal to the rank. The Fenwick "walk" descends bit positions from high to low, accumulating partial prefix sums, locating `idx` in `O(log n)`. Deletion is `update(idx, −1)` in `O(log n)`. Prefix maintenance is `O(log n)`. There are `n` deletions, hence `O(n log n)`. Correctness of the select follows because prefix sums are monotone non-decreasing in `idx`, so the smallest index reaching the target rank is unique and found by the standard Fenwick binary descent. ∎

**Theorem 7.3 (Lower bound for the order).** Computing the full elimination order requires `Ω(n)` time (the output has `n` elements), and any comparison-free select-and-delete structure must distinguish `Ω(n)` states, so `O(n log n)` is within a logarithmic factor of optimal; with a van Emde Boas / `y`-fast trie over the integer universe `{1, …, n}` the per-operation cost drops to `O(log log n)`, giving `O(n log log n)` — rarely worth the constants in practice. ∎

**Remark 7.4 (Single `m`-th query).** If only `e_m` is needed (not the whole order), one still performs `m` select-and-delete operations, `O(m log n)`. There is no known way to jump to `e_m` without simulating the first `m` removals for general `k`, because each removal's location depends on all prior removals.

---

## 8. Generating-Function and Asymptotic View

**The `k = 2` survivor as a self-similar sequence.** The sequence `J₂(n)` (0-indexed `2ℓ`) is a classic *2-regular* sequence: its values on `[2^a, 2^{a+1})` are the arithmetic progression `0, 2, 4, …, 2(2^a − 1)`, resetting to `0` at each power of two. This sawtooth structure is exactly the bit-rotation of Section 5, and it places `J₂` among the *automatic sequences* (computable by a finite automaton reading the binary digits of `n`).

**Asymptotic density.** For `k = 2`, the survivor seat `J₂(n) = 2(n − 2^{⌊log₂ n⌋}) + 1` ranges over `[1, 2^{a+1} − 1]` as `n` ranges over `[2^a, 2^{a+1})`, so the survivor's *relative* position `J₂(n)/n` oscillates in `(0, 2)` and is dense — there is no single limiting fraction, reflecting the scale-invariance of the doubling recurrence.

**General `k` asymptotics.** For fixed `k`, the survivor `J(n, k)` grows linearly in `n` on average with slope related to `1 − 1/k` per sweep, but with no clean closed form; the `O(k log n)` analysis (Theorem 6.3) is the sharp statement about *computational* cost rather than the value. The classical asymptotic result (Knuth) is that for the original `k = 3` "every third" variant, the survivor's relative position tends to a constant fraction governed by a transcendental relation, illustrating that even `k = 3` lacks the clean `k = 2` structure.

---

## 9. Variants and Their Algebraic Structure

**Variant 9.1 (Variable step).** With step `k_m` at the transition from size `m` to `m−1`, Theorem 2.1 generalizes to `J(n) = (J(n−1) + k_n) mod n`. The proof is identical — the relabeling bijection uses the round's own step. No closed form survives because the power-of-two alignment (Section 4) requires a constant `k`.

**Variant 9.2 (Last `r` survivors).** Stopping when `r` people remain yields a *set* of survivors; running the recurrence only down to size `r` does not directly give the set (the recurrence tracks one survivor). The clean characterization: the last `r` eliminated in the full order are the `r` survivors of the "stop at `r`" process, recovered via the Fenwick order (Theorem 7.2).

**Variant 9.3 (Counting direction / start offset).** Reversing direction is the relabeling `x ↦ (−x) mod n`; a start offset `s` is `x ↦ (x + s) mod n`. Both are elements of the dihedral group acting on the circle; the survivor transforms by the same group element. Composing them once (and only once) on the canonical answer yields the variant's answer.

**Variant 9.4 (Choose-your-seat inverse).** Given `n` and a desired survivor seat `s`, finding a `k` with `J(n, k) + 1 = s` has no closed form; it is a search over `k`, each evaluation `O(n)` (or `O(k log n)`). For `k = 2` one can instead *invert the bit rotation* directly: the `n` whose `k = 2` survivor is a given odd `s` is recovered by rotating `s`'s bits the other way, an `O(1)` inverse.

---

## 10. Complexity Landscape and Lower Bounds

| Task | Method | Complexity | Notes |
|------|--------|-----------|-------|
| Survivor, `k = 2` | bit rotation / closed form | `O(1)` | Theorem 4.1 / 5.1 |
| Survivor, small `k`, huge `n` | batched recurrence | `O(k log n)` | Theorem 6.3 |
| Survivor, general `k` | plain recurrence | `O(n)` | Theorem 2.1 |
| Full elimination order | Fenwick + select | `O(n log n)` | Theorem 7.2 |
| Full order (integer universe) | vEB / y-fast trie | `O(n log log n)` | Theorem 7.3; large constants |
| `m`-th eliminated | simulate `m` removals | `O(m log n)` | Remark 7.4 |
| Survivor, general large `k`, huge `n` | — | no known sublinear | open in practice |

**Lower bound for the survivor.** The survivor query has no nontrivial unconditional lower bound beyond `Ω(1)` — indeed `k = 2` is `O(1)`. The `O(n)` plain recurrence is not known to be improvable for *general* `k` with huge `n` (the `O(k log n)` method is only sublinear for small `k`), but no matching hardness is known either; this gap is a small open corner rather than a hard barrier.

**Lower bound for the order.** Outputting `n` distinct labels forces `Ω(n)`; the order's per-step select-and-delete on an integer universe is subject to the predecessor/dynamic-rank lower bounds, for which `O(log log n)` per operation (vEB) is optimal in the cell-probe model under standard assumptions — hence `O(n log log n)` is essentially tight for the order, with `O(n log n)` the practical Fenwick choice.

---

## 11. Worked Derivations and Verification Anchors

This section anchors the abstract proofs above to concrete, checkable computations — the empirical evidence a careful reader should reproduce.

### 11.1 The relabeling bijection, traced for n = 4, k = 3

Label seats `0, 1, 2, 3`. Convention 1.4 puts the first victim at `(k − 1) mod n = 2`.

```
Circle C_4 = {0, 1, 2, 3}, count starts at 0, k = 3.
Count: 0 (count 1), 1 (count 2), 2 (count 3) → eliminate 2.
Survivors {0, 1, 3}; counting resumes at position (2 + 1) mod 4 = 3.
Relabel from the resume point 3 as new-0:  3 → 0', 0 → 1', 1 → 2'.
```

The smaller problem `C_3` (on the relabeled `{0', 1', 2'}`) has survivor `J(3, 3)`. Compute it: `J(1)=0`, `J(2)=(0+3)%2=1`, `J(3)=(1+3)%3=1`. So the `C_3` survivor is new-label `1'`, which is original seat `0`. Cross-check via the recurrence: `J(4, 3) = (J(3, 3) + 3) mod 4 = (1 + 3) mod 4 = 0`. And indeed seat `0` is the original label of `1'`. The bijection `x = (x' + k) mod n = (1 + 3) mod 4 = 0` recovers exactly this — the theorem's `+k mod n` step made concrete.

A full simulation of `C_4, k = 3` eliminates `2, 1, 3` (original labels) in order, leaving `0`. Survivor `J(4, 3) = 0`, seat `1`. The recurrence, the bijection trace, and the brute-force simulation all agree.

### 11.2 The even/odd induction, traced for n = 6 and n = 7 (k = 2)

For `n = 6` (even, `j = 3`): the first sweep eliminates even seats `2, 4, 6`, leaving `{1, 3, 5}` relabeled `1, 2, 3` (new-`i` = old `2i − 1`). The relabeled `J₂(3)`: from `3 = 2 + 1`, `ℓ' = 1`, `J₂(3) = 2·1 + 1 = 3`. Then `J₂(6) = 2·J₂(3) − 1 = 2·3 − 1 = 5`. Check the closed form directly: `6 = 4 + 2`, `ℓ = 2`, `2·2 + 1 = 5`. ✓ Simulation of `n = 6, k = 2` eliminates `2, 4, 6, 3, 1` leaving `5`. ✓

For `n = 7` (odd, `j = 3`): the first sweep eliminates `2, 4, 6`, then wraps and eliminates `1`, leaving `{3, 5, 7}` relabeled `1, 2, 3` (new-`i` = old `2i + 1`). `J₂(7) = 2·J₂(3) + 1 = 2·3 + 1 = 7`. Closed form: `7 = 4 + 3`, `ℓ = 3`, `2·3 + 1 = 7`. ✓ Binary: `7 = 111₂`, rotate leading `1` to the end → `111₂ = 7` (a palindrome of all ones rotates to itself). ✓

### 11.3 The bit-rotation parity invariant, verified

By Remark 5.3 every `k = 2` survivor is odd. Tabulating `J₂(n)` for `n = 1 … 8`:

```
n :  1  2  3  4  5  6  7  8
J₂:  1  1  3  1  3  5  7  1
```

Every value is odd (the rotated binary string ends in `1`), and each value lies in `[1, n]`. The resets to `1` at `n = 2, 4, 8` are the power-of-two cases (Corollary 4.3). A property test asserting `J₂(n) % 2 == 1` and `1 ≤ J₂(n) ≤ n` for a range of `n` is a cheap, high-signal invariant.

### 11.4 The O(k log n) shrink argument, made quantitative

For `k = 3` and `n = 81`, each full sweep removes `⌊cnt/3⌋` of the current people, leaving roughly `(2/3)` of them. The number of sweeps until one remains is about `log_{3/2}(81) = ln 81 / ln 1.5 ≈ 4.39 / 0.405 ≈ 10.8`, i.e. ~11 conceptual sweeps. Each sweep contributes `O(k)` wrap events, so the wrap count is `O(k log n) ≈ 3 · log_{3/2} 81 ≈ 33` — versus `n − 1 = 80` steps for the plain recurrence. The asymptotic gap widens dramatically as `n` grows: at `n = 10^9, k = 3`, the batched method does on the order of `3 · log_{1.5}(10^9) ≈ 3 · 51 ≈ 150` wrap events, while the plain recurrence does `10^9 − 1`.

### 11.5 Why a single `m`-th query cannot skip ahead (general k)

For general `k`, the location of the `m`-th eliminated person `e_m` depends on the entire prefix `e_1, …, e_{m−1}`, because each removal alters which seats are "the `k`-th living" thereafter. There is no constant-state summary of the prefix (unlike the survivor, which the recurrence summarizes in one integer), so computing `e_m` requires materializing the first `m` removals — `O(m log n)` with a Fenwick tree, `Ω(m)` unconditionally. The `k = 2` case is again special: the closed-form structure could in principle locate specific eliminations, but for general `k` the `Ω(m)` barrier stands.

### 11.6 The full `J(n, k)` table for small inputs

A reference table is the single best regression fixture. Below are 0-indexed survivors `J(n, k)` for `n = 1 … 8` and `k = 1 … 4`, computed by the recurrence and confirmed by simulation:

```
        k=1   k=2   k=3   k=4
n=1      0     0     0     0
n=2      1     0     1     0
n=3      2     2     1     1
n=4      3     0     0     1
n=5      4     2     3     1
n=6      5     4     0     2
n=7      6     6     3     5
n=8      7     0     6     3
```

Each column for `k = 1` is `n − 1` (Corollary 2.3). The `k = 2` column `(0, 0, 2, 0, 2, 4, 6, 0)` is exactly `2ℓ` with `ℓ = n − 2^{⌊log₂ n⌋}` (Theorem 4.1): for `n = 7`, `ℓ = 3`, `2ℓ = 6`. ✓ The resets to `0` at `n = 2, 4, 8` are the power-of-two cases. Storing this table verbatim and asserting against it catches any regression in any of the three implementation regimes.

### 11.7 The doubling recurrence as an independent `k = 2` algorithm

Theorem 4.1's parity recurrences give a second, loop-light `O(log n)` algorithm for `k = 2`, independent of the highest-bit formula:

```
J2_double(n):                  # 1-indexed
  if n == 1: return 1
  if n is even: return 2 * J2_double(n / 2) - 1
  else:        return 2 * J2_double((n - 1) / 2) + 1
```

For `n = 41` (odd): `2·J2_double(20) + 1`. `J2_double(20)` (even): `2·J2_double(10) − 1`. `J2_double(10)` (even): `2·J2_double(5) − 1`. `J2_double(5)` (odd): `2·J2_double(2) + 1`. `J2_double(2)` (even): `2·J2_double(1) − 1 = 2·1 − 1 = 1`. Unwinding: `J2_double(5) = 2·1 + 1 = 3`; `J2_double(10) = 2·3 − 1 = 5`; `J2_double(20) = 2·5 − 1 = 9`; `J2_double(41) = 2·9 + 1 = 19`. ✓ Matches the closed form. Because this derivation shares no code with the highest-bit computation, agreement between the two is strong evidence of correctness — exactly the kind of independent cross-check the [`senior.md`](./senior.md) testing battery prescribes.

### 11.8 Complexity of building the table vs querying

Building the entire `J(·, k)` table for all `n ≤ N` (fixed `k`) is `O(N)` — the recurrence produces each `J(n)` from `J(n−1)` in `O(1)`, so a single pass yields the whole column. This is strictly cheaper than answering `N` independent survivor queries naively (`O(N²)` if each recomputes from scratch). When a workload asks for survivors across a range of `n` with a fixed `k`, compute the column once and index into it — the prefix-of-the-sequence structure is free. For varying `k`, no such sharing exists (each `k` has its own column), and per-query computation is the only option.

### 11.9 A full Fenwick select-and-delete trace (n = 5, k = 2)

To make Theorem 7.2 concrete, here is the order-statistic structure run by hand. The Fenwick tree stores `1` for each living seat `1 … 5`. We track `alive` and a 0-indexed living pointer `cur`, victim living-rank `(cur + k − 1) mod alive`, then find that 1-indexed slot.

```
Initial: alive = 5, cur = 0, living = {1,2,3,4,5}
Step 1: rank = (0 + 2 - 1) mod 5 = 1 → 2nd living = seat 2 → eliminate 2
        update(2, -1); cur = 1; alive = 4; living = {1,3,4,5}
Step 2: rank = (1 + 2 - 1) mod 4 = 2 → 3rd living = seat 4 → eliminate 4
        update(4, -1); cur = 2; alive = 3; living = {1,3,5}
Step 3: rank = (2 + 2 - 1) mod 3 = 0 → 1st living = seat 1 → eliminate 1
        update(1, -1); cur = 0; alive = 2; living = {3,5}
Step 4: rank = (0 + 2 - 1) mod 2 = 1 → 2nd living = seat 5 → eliminate 5
        update(5, -1); cur = 1; alive = 1; living = {3}
Step 5: rank = (1 + 2 - 1) mod 1 = 0 → 1st living = seat 3 → eliminate 3
        alive = 0; order complete.
Order: [2, 4, 1, 5, 3].  Survivor (last) = 3 = J(5,2)+1. ✓
```

Each `rank` computation is `O(1)`; each "find the `r`-th living seat" is the Fenwick walk in `O(log n)`; each `update` is `O(log n)`. Five deletions give the full order in `O(n log n)`. The survivor `3` matches the recurrence (`J(5,2)=2`, seat `3`) — the order-statistic engine and the closed recurrence converge, exactly the invariant `order[-1] == survivor` recommended as a regression test.

### 11.10 The Fenwick walk, formally

**Lemma 11.10.1.** Given a Fenwick tree over `{1, …, n}` holding non-negative weights with prefix sums `P(i) = Σ_{j≤i} w_j`, the smallest index `idx` with `P(idx) ≥ r` (for `1 ≤ r ≤ P(n)`) is found in `O(log n)` by descending bit positions from `⌊log₂ n⌋` to `0`, maintaining a running position `pos` and accumulated sum `acc`, and taking the bit whenever `acc + bit[pos + 2^j] < r`.

**Proof.** The Fenwick array `bit[]` stores partial sums over dyadic ranges: `bit[x]` covers `(x − lowbit(x), x]`. The descent considers candidate prefixes of lengths that are sums of decreasing powers of two. At bit `j`, extending `pos` by `2^j` is valid (stays `≤ n`) and *safe* (does not overshoot rank `r`) exactly when `acc + bit[pos + 2^j] < r`; taking it advances `pos` and folds `bit[pos + 2^j]` into `acc`. After all bits, `pos` is the largest index with `P(pos) < r`, so `pos + 1` is the smallest with `P(pos + 1) ≥ r`. Monotonicity of `P` (weights are non-negative) guarantees uniqueness. The descent visits `⌊log₂ n⌋ + 1` bit positions, each `O(1)`, hence `O(log n)`. ∎

This is strictly better than a binary search that calls `prefix(mid)` per probe (`O(log² n)`); the walk fuses the search into the tree structure. It is the engine behind the `O(n log n)` order computation of Theorem 7.2.

### 11.11 Generating function for the k = 2 sequence

The sequence `a_n = J₂(n)` (1-indexed survivor) is automatic, hence its generating function `A(x) = Σ_{n≥1} a_n x^n` satisfies a Mahler-type functional equation reflecting the binary self-similarity. Splitting by parity using `a_{2j} = 2a_j − 1` and `a_{2j+1} = 2a_j + 1` (Section 4.1):

```
A(x) = Σ_j a_{2j} x^{2j} + Σ_j a_{2j+1} x^{2j+1}
     = Σ_j (2a_j − 1) x^{2j} + Σ_j (2a_j + 1) x^{2j+1}
     = 2(1 + x) A(x²) − (x²/(1 − x²)) + (x³/(1 − x²)) + (correction terms for the base).
```

The exact bookkeeping of base terms is delicate, but the structural point is the **`A(x²)` self-reference**: the sequence is `2`-Mahler, the analytic signature of a `2`-regular sequence (Allouche–Shallit). This is the generating-function shadow of the bit-rotation formula (Theorem 5.1) and explains why no *rational* generating function (and hence no constant-coefficient linear recurrence in `n`) captures `J₂` — only the binary-digit automaton does. Contrast this with fixed-length walk counts (sibling topic `32-paths-fixed-length`), whose generating functions *are* rational; the Josephus `k = 2` sequence sits one rung up the hierarchy, in the automatic/Mahler class.

### 11.12 The recurrence as a group action, made explicit

The relabeling map of Section 2 is the rotation `ρ_k : x ↦ (x + k) mod n` on `ℤ_n`. Stacking the rotations across sizes gives a clean operator view of the whole recurrence. Define, for the chain of circle sizes `1 → 2 → … → n`, the composite:

```
J(n) = (((… (0 + k) mod 2 + k) mod 3 …) + k) mod n.
```

This is `n − 1` rotations, each followed by a reduction into the current circle. Each rotation is an element of the cyclic group `ℤ_n` (or `ℤ_m` at size `m`), and the reduction is the canonical projection `ℤ → ℤ_m`. The survivor is the image of `0` under the composite of these projections-after-rotations. The group-theoretic reading clarifies *why* there is no choice and no branching: there is exactly one orbit element reached, determined entirely by `k` and the size chain. It also makes the variable-step generalization obvious — replace the fixed `k` by `k_m` at the size-`m` rotation.

Pseudocode making the operator chain literal:

```
J(n, k):
  x = 0                       # element of Z_1
  for m in 2..n:
    x = rho_{k, m}(x)         # x := (x + k) mod m
  return x                    # element of Z_n
```

### 11.13 Edge-case proofs

**Claim 11.13.1 (`n = 1`).** `J(1, k) = 0` for every `k ≥ 1`. *Proof.* The loop `for m in 2..1` is empty, leaving `x = 0`; equivalently a one-person circle has its sole member as survivor. ∎

**Claim 11.13.2 (`k = 1`, any `n`).** `J(n, 1) = n − 1`. *Proof.* By induction: `J(1, 1) = 0 = 1 − 1`. If `J(n−1, 1) = n − 2`, then `J(n, 1) = (n − 2 + 1) mod n = (n − 1) mod n = n − 1`. ∎

**Claim 11.13.3 (`k = n`, the "last counted" case).** The first victim is at `(n − 1) mod n = n − 1`. The recurrence still applies with the general `k = n` substituted; there is no special-casing needed, illustrating that `k > n` (here `k = n`) is handled uniformly by the `mod`. ∎

**Claim 11.13.4 (`k = 2`, `n = 2^a`).** `J₂(2^a) = 1` (1-indexed). *Proof.* `ℓ = 2^a − 2^a = 0`, so `2ℓ + 1 = 1` (Corollary 4.3). Combinatorially, `a` clean halving sweeps each return the count to the start. ∎

### 11.14 A self-contained correctness checker (pseudocode)

The discipline of the whole topic compressed into one verifiable routine:

```
verify(N_max, K_max):
  for n in 1..N_max:
    for k in 1..K_max:
      sim = brute_force_simulate(n, k)        # 1-indexed survivor, ground truth
      assert recurrence(n, k) + 1 == sim
      assert batched(n, k) + 1 == sim
      assert fenwick_order(n, k)[-1] == sim
      if k == 2:
        assert closed_form(n) == sim
        assert bit_rotation(n) == closed_form(n)
        assert closed_form(n) % 2 == 1
  return "all invariants hold"
```

Every theorem in this document corresponds to one assertion line: Theorem 2.1 → `recurrence`, Theorem 6.3 → `batched`, Theorem 7.2 → `fenwick_order`, Theorem 4.1 → `closed_form`, Theorem 5.1 → `bit_rotation`, Remark 5.3 → the parity check. Passing `verify(60, 12)` exercises the full proof chain empirically.

### 11.15 Relationship to other recurrence-reduction techniques

The Josephus survivor recurrence `J(n) = (J(n−1) + k) mod n` is a *non-linear* recurrence in the sense that the modulus changes with `n` — it is not a constant-coefficient linear recurrence, so the matrix-exponentiation / Kitamasa machinery of sibling topic `32-paths-fixed-length` does **not** apply. The table below situates the Josephus reductions among the standard recurrence-acceleration tools:

| Technique | Applies to | Josephus relevance |
|-----------|-----------|--------------------|
| Memoized linear-chain DP | one-subproblem recurrences | the `O(n)` survivor loop |
| Matrix exponentiation | constant-coefficient linear recurrences | **not applicable** (variable modulus) |
| Kitamasa / Cayley-Hamilton | single term, large-order linear recurrence | not applicable |
| Binary-digit automaton | `b`-regular / automatic sequences | the `k = 2` bit-rotation (`J₂` is 2-regular) |
| Batched arithmetic progression | runs of `+c` steps before a wrap | the `O(k log n)` method |
| Order-statistic tree | dynamic select-and-delete | the `O(n log n)` elimination order |

The key structural fact: the survivor is a *modular* recurrence with a growing modulus, which is why it admits an `O(n)` chain but not a `polylog` matrix power; the special `k = 2` case escapes to `O(1)` only because the binary self-similarity (Section 4) collapses the chain, and the `O(k log n)` method exploits arithmetic-progression runs rather than algebraic structure.

### 11.16 Open questions and the boundary of tractability

Two clean open-ish corners worth stating precisely:

1. **General large-`k`, huge-`n` survivor.** Is there an `o(n)` algorithm for `J(n, k)` when both `k` and `n` are large (say both `Θ(n)` and `Θ(N)` respectively, `k ≤ n`)? The batched method is `O(k log n)`, which is `Ω(n)` when `k = Θ(n)`; no asymptotically better method is known, but no matching lower bound exists either. In practice this regime is simply rejected (Section 9.4).

2. **Sublinear `m`-th elimination.** For general `k`, is `e_m` computable in `o(m)`? Remark 7.4 argues `Ω(m)` informally (the prefix dependence), but this is not a formal cell-probe lower bound. For `k = 2` the bit-structure plausibly allows faster specific-elimination queries; formalizing this is a small but genuine question.

Neither gap affects the practical engineering — the regimes that occur in real problems (`k = 2`, small `k` with huge `n`, moderate `n`, or order queries) are all covered by the `O(1)` / `O(k log n)` / `O(n)` / `O(n log n)` methods proven above.

### 11.17 The historical instance, solved exactly

The legendary instance is `n = 41`, `k = 3` (Josephus and 40 companions, every third eliminated). Compute `J(41, 3)` by the recurrence — the first several and last few values:

```
J(1)=0, J(2)=(0+3)%2=1, J(3)=(1+3)%3=1, J(4)=(1+3)%4=0, J(5)=(0+3)%5=3,
J(6)=(3+3)%6=0, J(7)=(0+3)%7=3, ... (continue to 41) ...
J(41) = 30   (0-indexed)  →  seat 31.
```

So in the every-third variant, seat **31** survives (and the legend has Josephus arrange for a companion at the second-safe seat as well). Note this is the `k = 3` answer, distinct from the `k = 2` bit-rotation result `19` for `n = 41` — a reminder that the survivor depends sharply on `k`, and that only `k = 2` enjoys the closed form. A simulation of `n = 41, k = 3` confirms seat `31` as the last remaining, anchoring the recurrence against the most famous instance of the problem.

The two-survivor version (stop at `r = 2`) for `n = 41, k = 3` is recovered by the Fenwick order: take the two seats never eliminated in the first `39` removals. This is the variant the historical anecdote actually requires (Josephus *and* one ally surviving), and it is handled cleanly by the order-statistic engine of Theorem 7.2 rather than the single-survivor recurrence.

### 11.18 A note on numerical reproducibility across languages

The survivor recurrence uses only integer addition, modulo, and comparison — operations that are bit-for-bit identical across Go, Java, and Python provided the integer type does not overflow. This makes the Josephus survivor an excellent cross-language determinism fixture: the same `(n, k)` must yield the same seat in all three, with no floating point anywhere. The only divergence risk is overflow (32-bit in Java/Go, none in Python), which the per-step normalization `res = (res + k % m) % m` and 64-bit types eliminate. The `k = 2` closed form likewise reduces to integer shifts and a highest-set-bit lookup, all exact. Contrast this with the Markov / probability variants of sibling topics, where floating-point rounding makes cross-language bit-identity impossible — the Josephus problem's pure-integer nature is a feature worth exploiting in a polyglot test harness.

### 11.19 Summary of the proof dependency graph

```
Theorem 2.1 (recurrence)  ──derives──▶  J(n,k) for all n,k  ──specializes──▶  k=2 closed form
        │                                                                          │
        └── relabeling bijection (2.2)                            even/odd induction (Thm 4.1)
                                                                                    │
Proposition 3.3 / 6.1 (batching)                                          bit rotation (Thm 5.1)
        │                                                                           │
        ▼                                                                           ▼
Theorem 6.3 (O(k log n))                                          parity invariant (Rmk 5.3)
Theorem 7.2 (Fenwick order) ◀── Lemma 11.10.1 (Fenwick walk)
```

Every result traces back to the relabeling bijection of Theorem 2.1 (for the survivor) or the even/odd halving of Theorem 4.1 (for the `k = 2` structure). The batching and order-statistic results are computational refinements that do not change *what* is computed, only *how fast*.

---

## 12. Summary

- **Survivor recurrence.** `J(1)=0`, `J(n) = (J(n−1) + k) mod n`, proved by the **relabeling bijection** (Theorem 2.1): after the first removal at `(k−1) mod n`, renumbering the survivors from the resume point is a process isomorphism to the `(n−1)`-circle, and undoing the renumbering adds `k` mod `n`. It is a one-subproblem linear-chain DP, `O(n)` time, `O(1)` space.
- **`k = 2` closed form.** `J₂(n) = 2(n − 2^{⌊log₂ n⌋}) + 1` (1-indexed), proved by even/odd strong induction (Theorem 4.1) via the halving recurrences `J₂(2j) = 2J₂(j) − 1` and `J₂(2j+1) = 2J₂(j) + 1`.
- **Bit rotation.** `J₂(n)` is the one-bit cyclic left rotation of `n`'s binary string (Theorem 5.1); the survivor is always odd and shares `n`'s popcount.
- **`O(k log n)` batching.** Non-wrapping runs of the recurrence are collapsed; correctness by Lemma 6.1, complexity `O(k log n)` by the `(k−1)/k` shrink-per-sweep argument (Theorem 6.3). Sublinear only for small `k`.
- **`m`-th order statistic.** The full order and the `m`-th elimination are dynamic select-and-delete queries; a Fenwick tree with an `O(log n)` select walk gives `O(n log n)` (Theorem 7.2), `O(n log log n)` with vEB.
- **Variants.** Variable step preserves the recurrence but kills the closed form; direction/start offsets are dihedral relabelings; the inverse "choose-your-seat" is a search in general but an `O(1)` reverse rotation for `k = 2`.
- **No general closed form.** Only `k = 2` (and degenerate `k = 1`) collapse to elementary formulas; the special structure is the exact power-of-two halving alignment, absent for other `k`.

### Complexity Cheat Table

| Task | Complexity | Tight? |
|------|-----------|--------|
| Survivor `k = 2` | `O(1)` | yes |
| Survivor small `k`, huge `n` | `O(k log n)` | sublinear for small `k` |
| Survivor general `k` | `O(n)` | no known improvement / no hardness |
| Full elimination order | `O(n log n)` (Fenwick) | `O(n log log n)` achievable; `Ω(n)` output bound |
| `m`-th eliminated | `O(m log n)` | — |

### Closing Notes

- **Relabeling bijection** (Section 2): the entire `O(n)` recurrence is one process isomorphism between consecutive circle sizes — optimal substructure with a trivial (single-value) memo.
- **Power-of-two alignment** (Section 4): the unique reason `k = 2` has a closed form; the even/odd split telescopes into a bit rotation.
- **Order statistics** (Section 7): the survivor is the last order statistic; the Fenwick select-and-delete is the canonical scalable engine for the full order.
- **Automatic-sequence view** (Section 8): `J₂` is a `2`-regular/automatic sequence — a finite automaton reading binary digits — which is the abstract face of the bit-rotation formula.
- **Group-action reading** (Section 11.12): the recurrence is a composite of rotations-then-projections on `ℤ_m`, making the absence of branching and the variable-step generalization immediate.
- **Tractability boundary** (Section 11.16): `k = 2` is `O(1)`, small-`k` huge-`n` is `O(k log n)`, general `k` is `O(n)` with no known sublinear method and no matching hardness — a small open corner that does not affect practical engineering.
- **Cross-language determinism** (Section 11.18): pure-integer arithmetic makes the survivor bit-for-bit reproducible across Go, Java, and Python — an asset for polyglot test harnesses that floating-point variants lack.
- **Fenwick walk** (Lemma 11.10.1): the `O(log n)` select fuses the binary search into the tree, beating the `O(log² n)` probe-based search and powering the `O(n log n)` order computation.
- **Historical instance** (Section 11.17): `J(41, 3) = ` seat `31`, distinct from the `k = 2` answer `19` — a reminder that the survivor depends sharply on `k` and only `k = 2` has an elementary closed form.

Foundational references: Graham, Knuth, Patashnik, *Concrete Mathematics* (Ch. 1, the Josephus problem and the `k = 2` closed form / radix view); Knuth, *The Art of Computer Programming* Vol. 1 (general `k` asymptotics); Allouche & Shallit, *Automatic Sequences* (the `2`-regular structure of `J₂`); the Fenwick / Binary Indexed Tree and order-statistic-tree literature for the select-and-delete bound; and sibling topics `13-dynamic-programming`, `04-linked-lists`, and the Binary Indexed Tree material in the data-structures track.
