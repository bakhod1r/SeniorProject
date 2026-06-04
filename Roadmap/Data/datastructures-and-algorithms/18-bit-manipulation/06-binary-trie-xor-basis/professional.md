# Binary Trie & XOR Linear Basis — Mathematical Foundations

> **One-line summary:** Rigorous foundations for both XOR structures — a correctness proof of the greedy max-XOR trie walk via the dominance of the most-significant differing bit; the linear basis as a basis of a vector space over the field GF(2), with proofs that the span has exactly `2^rank` elements, that XOR-Gaussian elimination computes a correct basis, and that the reduced row-echelon basis yields the k-th smallest XOR; plus the complexity accounting `O(n·B)`, `O(B)`, `O(B²)`.

---

## Table of Contents

1. [Formal Setup](#1-formal-setup)
2. [The Binary Trie as a Decision over Bit Positions](#2-the-binary-trie-as-a-decision-over-bit-positions)
3. [Correctness of the Greedy Max-XOR Walk](#3-correctness-of-the-greedy-max-xor-walk)
4. [GF(2) and the XOR Vector Space](#4-gf2-and-the-xor-vector-space)
5. [The Linear Basis: Span, Rank, and 2^rank](#5-the-linear-basis-span-rank-and-2rank)
6. [Gaussian Elimination over GF(2): Correctness](#6-gaussian-elimination-over-gf2-correctness)
7. [Maximum and Minimum Subset XOR](#7-maximum-and-minimum-subset-xor)
8. [k-th Smallest XOR via Reduced Row-Echelon Basis](#8-k-th-smallest-xor-via-reduced-row-echelon-basis)
9. [Representability and Merging](#9-representability-and-merging)
10. [Complexity Accounting](#10-complexity-accounting)
11. [Trie vs Basis: A Unified View](#11-trie-vs-basis-a-unified-view)
12. [Persistent Tries and Constrained Queries](#12-persistent-tries-and-constrained-queries)
13. [Connections to Coding Theory and Linear Algebra](#13-connections-to-coding-theory-and-linear-algebra)
14. [Summary](#14-summary)

---

## 1. Formal Setup

Fix a bit-width `B`. Identify each nonnegative integer `x < 2^B` with the vector `x = (x_{B-1}, ..., x_1, x_0) ∈ {0,1}^B`, where `x_i = (x >> i) & 1`. The XOR operation `^` is **coordinatewise addition modulo 2**:

```
(x ^ y)_i = x_i ⊕ y_i = (x_i + y_i) mod 2.
```

This makes `({0,1}^B, ^)` an abelian group with identity `0` and every element its own inverse (`x ^ x = 0`). When we also use scalar multiplication by elements of the field GF(2) = `{0,1}` (where `0·x = 0`, `1·x = x`), the structure becomes a **vector space of dimension `B` over GF(2)**, written `(GF(2))^B`. This algebraic fact is the entire theoretical engine of the linear basis.

The **order relation** on integers is the usual one; crucially, it is the *lexicographic* order on bit vectors read MSB-first: `x < y` iff at the highest index `i` where `x_i ≠ y_i`, we have `x_i = 0, y_i = 1`. This dominance of the most-significant differing bit is what justifies all the greedy arguments below.

We fix notation used throughout:

| Symbol | Meaning |
|--------|---------|
| `B` | bit-width; all values lie in `[0, 2^B)` |
| `V` | the vector space `(GF(2))^B` |
| `S` | the input multiset/set of integers |
| `W = ⟨S⟩` | the span: all subset XORs of `S` |
| `r = rank(S)` | dimension of `W`; number of nonzero basis vectors |
| `x_i` | bit `i` of `x`, i.e. `(x >> i) & 1` |
| `⊕`, `^` | XOR (addition in GF(2)) |
| `e_i` | the unit vector `2^i` (single set bit at position `i`) |
| `topbit(x)` | the highest index `i` with `x_i = 1` (undefined for `x = 0`) |

Two structural facts we will use repeatedly:

- **Self-inverse:** `x ⊕ x = 0`, so every element is its own additive inverse; "subtract" and "add" coincide.
- **Associativity/commutativity:** XOR is associative and commutative, so a subset XOR is independent of order and grouping — exactly the algebraic freedom a linear combination over a field enjoys.

---

## 2. The Binary Trie as a Decision over Bit Positions

A binary trie over a set `S ⊆ {0,1}^B` is a tree of depth `B`. The root is level `B-1`; a node at level `i` has children indexed by bit values `0` and `1`, and the edge to child `c` records "the value's bit `i` equals `c`." A value `s ∈ S` corresponds to the unique root-to-leaf path spelling `(s_{B-1}, ..., s_0)`.

**Invariant.** A node at level `i` reached by edges `c_{B-1}, ..., c_{i+1}` is present iff some `s ∈ S` has `s_j = c_j` for all `j > i`. Equivalently, the set of leaves below a node is exactly `{ s ∈ S : s agrees with the node's prefix }`. With subtree counts `cnt(node) = |{leaves below node}|`, a child is *nonempty* iff `cnt(child) > 0`.

*Proof of the invariant (induction on depth).* At the root (depth 0, prefix empty), every `s ∈ S` trivially agrees, and the root's count is `|S|`. Inductive step: assume a node `u` at level `i+1` has leaf set `L(u) = {s : s agrees with u's prefix}`. Its child along bit `c` collects exactly those `s ∈ L(u)` with `s_i = c`, which is `{s : s agrees with u's prefix and s_i = c}` = the leaf set for the extended prefix. Summing both children's counts reconstructs `cnt(u)`, so counts are consistent and a child is present iff its leaf set is nonempty. ∎

This invariant is what lets the trie act as a *bitwise decision diagram*: descending one level fixes one more high bit of the candidate, and the choice of child is exactly the choice of that bit's value among the surviving candidates.

---

## 3. Correctness of the Greedy Max-XOR Walk

**Claim.** Given a nonempty `S` and a query `x`, the greedy walk — at each level `i` go to child `1 - x_i` if it is nonempty, else to child `x_i` — ends at the leaf `y* ∈ S` maximizing `x ^ y` over all `y ∈ S`.

**Lemma (MSB dominance).** For `u, v ∈ {0,1}^B`, if at the highest index `i` where `u_i ≠ v_i` we have `u_i = 1`, then `u > v`.

*Proof.* Write the difference as a sum over bit positions:

```
u - v = Σ_{j > i} (u_j - v_j) 2^j   +   (u_i - v_i) 2^i   +   Σ_{j < i} (u_j - v_j) 2^j
```

- The first sum is `0` because `u_j = v_j` for all `j > i` (`i` is the highest differing index).
- The middle term is `(1 - 0) 2^i = +2^i`.
- The last sum is at least `Σ_{j<i} (0 - 1) 2^j = -(2^i - 1)` (each term is at worst `-2^j`).

Therefore `u - v ≥ 2^i - (2^i - 1) = 1 > 0`, so `u > v`. ∎

The pseudocode of the greedy walk, for reference in the proof:

```
maxXorWalk(x):
    node = root; res = 0
    for i = B-1 down to 0:
        b = bit i of x; want = 1 - b
        if child[node][want] exists (cnt > 0):
            res |= (1 << i); node = child[node][want]     # XOR bit i = 1
        else:
            node = child[node][b]                          # forced; XOR bit i = 0
    return res
```

**Proof of the claim (exchange/induction on levels).** Let `g` be the value `x ^ (greedy leaf)` and let `o = x ^ y*` for an optimal `y*`. We show `g_i = o_i` cannot first differ with `o_i = 1, g_i = 0`. Suppose the highest index where `g` and `o` differ is `i`. Consider the greedy decision at level `i`. By construction the greedy walk reached level `i` along a prefix that, for the XOR result, matches `o` on all bits above `i` (induction hypothesis: greedy is optimal on the prefix, and any value achieving the optimum must agree there because of MSB dominance — a differing higher bit would already settle the comparison). At level `i`:

- If child `1 - x_i` is nonempty, greedy takes it, making `g_i = (x_i ⊕ (1 - x_i)) = 1`. Then `g_i = 1 ≥ o_i`, contradicting `o_i = 1, g_i = 0`.
- If child `1 - x_i` is empty, then *no* surviving candidate (those agreeing with the fixed prefix) has bit `i` equal to `1 - x_i`; every candidate has bit `i = x_i`, forcing XOR bit `i = 0` for *all* of them — including the optimum. So `o_i = 0`, again no contradiction.

Either way the assumed difference is impossible. Hence `g = o` and the greedy leaf attains the maximum. ∎

The same argument with "take child `x_i` when nonempty" (same bit) proves the **minimum**-XOR walk correct: it greedily forces XOR bit `0` at the most significant position whenever possible, minimizing by MSB dominance.

### 3.1 Worked Verification of the Greedy Walk

Take `S = {25, 10, 8}` with `B = 5`, written MSB-first: `25 = 11001`, `10 = 01010`, `8 = 01000`. Query `x = 5 = 00101`. The greedy walk:

```
level bit4: x4=0, want 1. Is there a stored value with bit4=1? Yes (25). Take 1. XOR bit = 1.
level bit3: among survivors {25}, x3=0, want 1. 25 has bit3=1. Take 1. XOR bit = 1.
level bit2: survivors {25}, x2=1, want 0. 25 has bit2=0. Take 0. XOR bit = 1.
level bit1: survivors {25}, x1=0, want 1. 25 has bit1=0, no 1-child. Forced 0. XOR bit = 0.
level bit0: survivors {25}, x0=1, want 0. 25 has bit0=1, no 0-child. Forced 1. XOR bit = 0.
```

The partner is `25` and `x ^ 25 = 00101 ^ 11001 = 11100 = 28`. The banked XOR bits `1,1,1,0,0 = 11100 = 28` match. Compare against the alternatives: `5 ^ 10 = 15`, `5 ^ 8 = 13`. The greedy result `28` is indeed the maximum, and notice it was decided almost entirely at `bit4`: once we secured a `1` there (value ≥ 16), no candidate XORing to a `0` at `bit4` (≤ 15) could compete. That is MSB dominance in action.

### 3.2 The Forced-Branch Subtlety

The proof hinges on the "forced" case being *globally* forced. When the opposite child is empty at level `i`, it is not merely that *our chosen path* lacks it — it is that **every** value consistent with the already-fixed prefix lacks bit `1 - x_i`. The trie invariant (Section 2) guarantees this: the surviving candidates are exactly the leaves under the current node, and an absent child means none of them take that branch. This is why we may conclude `o_i = 0` for the optimum too, rather than merely for the greedy path. A common incorrect "proof" forgets this and only argues about the greedy path, which does not rule out a better candidate elsewhere — but elsewhere is impossible because the prefix above `i` was already pinned by induction.

---

## 4. GF(2) and the XOR Vector Space

GF(2) is the field with two elements `{0, 1}` under addition mod 2 (= XOR) and multiplication mod 2 (= AND). The integers `{0, ..., 2^B - 1}` under XOR and GF(2)-scalar multiplication form the vector space `V = (GF(2))^B`.

Key consequences of working over a field with exactly two scalars:

- A **linear combination** of vectors `v_1, ..., v_m` is `Σ ε_j v_j` with each `ε_j ∈ {0,1}` — i.e. **the XOR of some subset** of them. There is no other coefficient choice. So "subset XOR" and "linear combination over GF(2)" are literally the same operation.
- **Linear independence:** `v_1, ..., v_m` are independent iff no nonempty subset XORs to `0`.
- The **span** `⟨v_1, ..., v_m⟩` is the set of all subset XORs.

A **basis** of a subspace `W ⊆ V` is a linearly independent set whose span is `W`. Its size is the **dimension** (rank) of `W`, an invariant independent of the chosen basis (standard linear algebra, valid over any field including GF(2)).

### 4.1 Why GF(2) Simplifies Everything

Over a general field, Gaussian elimination must scale pivot rows to make leading coefficients `1` and subtract scaled multiples. Over GF(2) there are no scaling factors — the only nonzero scalar is `1` — so "subtract a multiple of the pivot row" collapses to "XOR the pivot row if the bit is set." Every row operation is a single XOR; there is no division, no fractions, no floating-point error. This is what makes the basis code a four-line loop and its arithmetic exact. The price is that the field has only two elements, so the only linear combinations available are subset XORs; there is no "scale by 3" operation, which is precisely why the structure answers *subset*-XOR questions and nothing more.

### 4.2 Coordinates Are Bit Positions

In `V = (GF(2))^B`, the standard basis is `{e_0, ..., e_{B-1}}` where `e_i` is the integer `2^i` (a single set bit). The pivots produced by elimination are *not* generally the standard basis vectors — they are linear combinations of the inputs — but each pivot is anchored to one coordinate (its highest set bit), which is what makes the echelon structure and the greedy arguments work. The "position" of a pivot is its leading coordinate index.

---

## 5. The Linear Basis: Span, Rank, and 2^rank

Let `S = {a_1, ..., a_n}` be the input integers and `W = ⟨a_1, ..., a_n⟩` their span (all subset XORs). Let `r = dim W = rank(S)`.

**Theorem (span size).** `|W| = 2^r`.

**Proof.** Pick a basis `{b_1, ..., b_r}` of `W`. Define the linear map `φ : (GF(2))^r → W` by `φ(ε_1, ..., ε_r) = ε_1 b_1 ⊕ ... ⊕ ε_r b_r`. It is **surjective** because the `b_j` span `W`. It is **injective**: if `φ(ε) = φ(δ)` then `Σ (ε_j ⊕ δ_j) b_j = 0`, and independence of the `b_j` forces `ε_j = δ_j` for all `j`. A bijection from a set of size `2^r` onto `W` gives `|W| = 2^r`. ∎

This is the precise statement behind "the number of distinct achievable XOR values is `2^rank`," and it includes the empty subset (value `0 ∈ W` always). The rank `r` is exactly the number of nonzero vectors the elimination procedure of the next section stores.

### 5.1 Worked Span-Size Example

Take `S = {3, 5, 6}` with `B = 3`: `3 = 011`, `5 = 101`, `6 = 110`. Note `3 ^ 5 = 6`, so `6` is dependent on `{3, 5}`. The rank is `2`, so the theorem predicts `2^2 = 4` distinct subset XORs. Enumerate all `2^3 = 8` subsets:

```
{}            -> 0
{3}           -> 3
{5}           -> 5
{6}           -> 6
{3,5}         -> 6
{3,6}         -> 5
{5,6}         -> 3
{3,5,6}       -> 0
```

The distinct values are `{0, 3, 5, 6}` — exactly four, matching `2^rank = 4`. Observe each distinct value is reached by exactly `2^{n-r} = 2^{3-2} = 2` subsets, a uniformity that follows from `φ` being a group homomorphism with kernel of size `2^{n-r}`.

### 5.2 Counting Multiplicity per Value

The map from subsets to XOR values, `Φ : (GF(2))^n → W`, `Φ(ε) = ⊕ ε_i a_i`, is a surjective linear map. Its kernel (subsets XORing to `0`) is a subspace of dimension `n - r`. By the first isomorphism theorem, every fiber `Φ^{-1}(w)` has size `2^{n-r}`. Hence each achievable XOR value is produced by exactly `2^{n-r}` subsets — a fact used when problems ask "how many subsets achieve XOR = `v`?": the answer is `2^{n-r}` if `v ∈ W`, else `0`.

---

## 6. Gaussian Elimination over GF(2): Correctness

The basis algorithm maintains an array `basis[0..B-1]` with the invariant:

> **(I)** If `basis[i] ≠ 0`, its highest set bit is exactly position `i`; and distinct nonzero entries occupy distinct positions `i`.

`add(x)` scans `i` from high to low; whenever `x` has bit `i` set, if `basis[i] = 0` it installs `basis[i] = x` and stops, otherwise it sets `x ← x ⊕ basis[i]` (clearing bit `i`) and continues. It returns whether a new pivot was installed.

**Lemma (span preservation).** At all times `⟨nonzero basis entries⟩ = ⟨inserted elements so far⟩`.

**Proof.** Each step replaces `x` by `x ⊕ basis[i]`, an elementary GF(2) row operation that does not change the span of the working set (adding one spanning vector to another is invertible: do it again to undo). When `x` is installed, it equals the original input plus a XOR-combination of stored basis vectors, so adding it keeps the span equal to the span of all elements seen. When `x` reduces to `0`, it was already in the current span, so the span is unchanged. ∎

**Lemma (independence).** The nonzero basis entries are linearly independent.

**Proof.** Order them by pivot position. Each `basis[i]` is the **only** stored vector with bit `i` as its highest set bit (invariant I). Suppose a nonempty subset XORs to `0`. Take the highest pivot position `i*` among the chosen vectors; bit `i*` is set in `basis[i*]` and in **no other** stored vector at a position `≥ i*` that could cancel it (each pivot is the unique top bit of its own vector). Hence bit `i*` survives the XOR, so the result is nonzero — contradiction. ∎

**Theorem (correctness).** After inserting all of `S`, the nonzero basis entries form a basis of `W`, and their count equals `rank(S)`.

**Proof.** By the span lemma they span `W`; by the independence lemma they are independent; an independent spanning set is a basis, and its size is the dimension `rank(S)` by the invariance of dimension. ∎

Termination is immediate: each iteration of `add` decreases `i` by at least one, so it runs at most `B` steps. The procedure is `O(B)` per insertion.

### 6.1 Worked Elimination Trace

Insert `S = {3, 5, 6}` (`B = 3`) into an empty basis `[0,0,0]` indexed by pivot position `0..2`.

```
add(3 = 011): highest set bit = 1. basis[1] empty -> install basis[1] = 3 = 011. rank 1.
add(5 = 101): highest set bit = 2. basis[2] empty -> install basis[2] = 5 = 101. rank 2.
add(6 = 110): highest set bit = 2. basis[2]=5 owns bit2 -> 6 ^= 5 = 110^101 = 011.
              now 011 highest set bit = 1. basis[1]=3 owns bit1 -> 011 ^= 011 = 000.
              reduced to 0 -> dependent, basis unchanged. rank stays 2.
```

Final basis: `basis[2] = 5`, `basis[1] = 3`, `basis[0] = 0`; rank `2`. This matches the span analysis of Section 5.1. The order of insertion can change *which* vectors land in which slots, but never the rank or the span.

### 6.2 Order Independence of the Span

Although `basis[]` contents depend on insertion order, the *span* and *rank* do not. Proof sketch: the span lemma shows the span equals `⟨all inserted⟩` regardless of order; rank is the dimension of that span, an order-independent invariant. Therefore `maxXor`, `count`, `representable`, and the *set* of achievable values are all order-independent, even though a test that compares raw `basis[]` arrays across two insertion orders may see different vectors. Tests must compare derived answers, not internal state.

### 6.3 The Reduction Algorithm in Pseudocode

The complete insertion with its invariant annotated:

```
add(x):                      # invariant (I): basis[i]!=0 => topbit(basis[i]) = i
    for i = B-1 down to 0:
        if bit i of x == 0:
            continue         # x has nothing to place at position i
        if basis[i] == 0:
            basis[i] = x     # install new pivot; rank grows by 1
            return INSTALLED
        x = x XOR basis[i]   # clear bit i using the pivot that owns it
    return DEPENDENT         # x collapsed to 0 -> already in the span
```

Three facts make this correct, each proved above:

- **Span preservation** — every `x = x XOR basis[i]` is an invertible GF(2) row operation.
- **Invariant maintenance** — `x` is installed at `i` only when bit `i` is its highest remaining set bit, so `topbit(basis[i]) = i`.
- **Termination** — `i` strictly decreases, so at most `B` iterations occur.

### 6.4 Echelon Form vs Reduced Echelon Form

The `add` loop produces an **echelon** basis: pivots occupy distinct positions, but a pivot vector may carry set bits at *other* pivots' positions. The extra `reduce()` pass produces **reduced** (RREF) form:

```
reduce():
    for i = 0 to B-1:
        if basis[i] == 0: continue
        for j = 0 to B-1:
            if j != i and basis[j] != 0 and bit i of basis[j] == 1:
                basis[j] = basis[j] XOR basis[i]   # remove pivot-i bit from basis[j]
```

After `reduce()`, each pivot bit appears in exactly one basis vector — the property the k-th query proof relies on (Section 8.2).

---

## 7. Maximum and Minimum Subset XOR

**Theorem (max subset XOR).** Starting from `res = 0` and scanning pivots `i = B-1` down to `0`, the rule "if `res ⊕ basis[i] > res` then `res ← res ⊕ basis[i]`" yields `max_{w ∈ W} w`.

**Proof.** Consider the highest pivot position `i` present. Because `basis[i]` is the unique vector with top bit `i`, bit `i` of the final answer can be made `1` iff we include `basis[i]`, and once decided it cannot be changed by any lower pivot (lower pivots have top bit `< i`). By MSB dominance, setting bit `i` to `1` is optimal regardless of lower bits, so the greedy choice (which sets it whenever it increases `res`) is correct at position `i`. The remaining pivots span a subspace affecting only lower bits; induction on the number of pivots completes the proof. The test `res ⊕ basis[i] > res` is `1` exactly when bit `i` of `res` is currently `0` (since `basis[i]` has top bit `i`), so it flips the highest undecided bit to `1`. ∎

**Minimum nonzero subset XOR.** After **full reduction** (Section 8), the smallest nonzero element of `W` equals the basis vector with the lowest pivot position — every other span element either is `0` or has a set bit at or above some higher pivot, making it larger. (The minimum over *all* subsets, including empty, is trivially `0`.)

*Proof of the minimum-nonzero claim.* Let `g` be the reduced pivot of lowest position `p`. Any nonzero `w ∈ W` is a XOR of pivots; let `q` be the highest pivot position appearing in `w`'s decomposition. If `q > p`, then `topbit(w) ≥ q > p ≥ topbit(g)`, so `w > g`. If `q = p` then `w = g` (only one pivot at position `p` after reduction, and including it alone gives `g`; including more pivots raises `topbit` above `p`). Hence `g` is the unique minimum nonzero element. ∎

### 7.3 Worked Minimum Example

With the reduced basis `{basis[2] = 5 = 101, basis[1] = 3 = 011}` from Section 6.1, the lowest pivot is `basis[1] = 3`. The nonzero span elements are `{3, 5, 6}`, and indeed `3` is the smallest. The empty subset gives `0`, which is the overall minimum if the empty subset is allowed.

If a starting value `c` is given (e.g. "max `c ⊕ w`"), run the same greedy from `res = c`; the proof is identical with `c` fixing the bits above the highest pivot.

### 7.1 Worked Maximum Example

Using the basis `{basis[2]=5=101, basis[1]=3=011}` from Section 6.1, run the greedy max from `res = 0`:

```
i=2: res ^ basis[2] = 000 ^ 101 = 101 = 5 > 0 -> take it. res = 5 = 101.
i=1: res ^ basis[1] = 101 ^ 011 = 110 = 6 > 5 -> take it. res = 6 = 110.
i=0: basis[0] = 0 -> skip.
```

Maximum subset XOR = `6`, matching the enumeration in Section 5.1 (distinct values `{0,3,5,6}`, max `6`). The greedy secured bit2 first (the only way to reach ≥ 4), then bit1.

### 7.2 Why "Increase" and "Set the Top Bit" Coincide

The test `res ⊕ basis[i] > res` deserves care. Because `basis[i]` has its highest set bit at position `i`, XORing it flips bit `i` of `res` and possibly some lower bits. If bit `i` of `res` is currently `0`, the XOR sets it to `1`, which *increases* the value by at least `2^i` minus the at-most `2^i - 1` that lower bits can subtract — a net increase, so the test passes. If bit `i` is already `1`, the XOR clears it, *decreasing* the value, so the test fails and we skip. Hence the test is equivalent to "set bit `i` to `1` if it is not already," which is exactly the MSB-greedy rule. This equivalence is what makes the one-line `if (res ^ basis[i] > res)` correct without an explicit bit test.

---

## 8. k-th Smallest XOR via Reduced Row-Echelon Basis

Reduce the basis to **reduced row-echelon form (RREF)** over GF(2): for each pivot `i`, XOR `basis[i]` into every other stored vector that has bit `i` set, so that **each pivot bit appears in exactly one basis vector**. List the nonzero pivots as `p_0 < p_1 < ... < p_{r-1}` by pivot position, with corresponding vectors `g_0, ..., g_{r-1}`.

**Theorem (k-th XOR).** Sort `W` ascending as `w_0 < w_1 < ... < w_{2^r - 1}`. Then for `0 ≤ k < 2^r`,

```
w_k = ⊕_{t : bit t of k is 1} g_t.
```

**Proof.** Define `ψ(k) = ⊕_{t: k_t = 1} g_t`. Because the `g_t` are independent (subset of a basis), `ψ` is a bijection from `{0, ..., 2^r - 1}` onto `W` (same argument as Section 5). It remains to show `ψ` is **order-preserving**. In RREF, vector `g_t` is the *only* basis vector whose value has bit `p_t` set (that bit is a pivot, unique to `g_t`); moreover `g_t` has no set bit at any pivot position `p_{t'} > p_t` (those were eliminated) — its other set bits are at non-pivot positions, all below `p_t`'s significance among pivots. Therefore among the pivot bits `p_0 < ... < p_{r-1}`, including `g_t` toggles exactly the pivot bit `p_t`, and pivot bits dominate the comparison by MSB dominance restricted to pivot positions. Thus comparing `ψ(k)` and `ψ(k')` reduces to comparing the integers formed by their pivot-bit patterns, which is exactly comparing `k` and `k'` (bit `t` of `k` controls pivot `p_t`, with higher `t` = higher pivot = more significant). Hence `ψ` is strictly increasing, so `w_k = ψ(k)`. ∎

The reduction is `O(B²)`; each k-th query is `O(B)`. (If the input set could XOR to `0` via a nontrivial subset — i.e. `r < n` — every span value is reachable by `2^{n-r}` subsets, but the *distinct* values are still exactly the `2^r` produced by `ψ`.)

### 8.1 Worked k-th Example

Take the RREF basis with pivots `g_0 = 011 = 3` (pivot position 1) and `g_1 = 101 = 5`... but wait — for RREF we must eliminate the pivot bit of the higher vector from the lower if shared, and vice versa. Start from `basis[2]=5=101, basis[1]=3=011`. Reduce: does `basis[1]=011` have bit2 set? No. Does `basis[2]=101` have bit1 set? No. So they are already in RREF (each pivot bit `2` and `1` appears in exactly one vector). List pivots by position low→high: `g_0 = basis[1] = 3`, `g_1 = basis[2] = 5`. Then:

```
k=0 (=00): res = 0                      -> 0
k=1 (=01): include g_0 -> 3             -> 3
k=2 (=10): include g_1 -> 5             -> 5
k=3 (=11): include g_0,g_1 -> 3^5 = 6   -> 6
```

The sorted distinct span is `[0, 3, 5, 6]`, so `w_0=0, w_1=3, w_2=5, w_3=6` — exactly the map output. The bijection is order-preserving because `g_1` (higher pivot, bit2) dominates `g_0` (bit1) in the comparison, mirroring how bit1 of `k` dominates bit0.

### 8.2 The Role of Reduction in Order-Preservation

Without RREF, the map `ψ` is still a bijection but is *not* order-preserving. Example: with non-reduced pivots where a higher pivot vector also carries a lower pivot bit, toggling the high pivot can change a low pivot bit, breaking the monotone correspondence between `k`'s bit pattern and the value's pivot-bit pattern. RREF removes exactly these cross-contaminations so that toggling pivot `t` changes *only* pivot bit `p_t` among the pivot positions, restoring monotonicity. This is the precise technical reason the reduction step is mandatory before k-th queries and optional for max/representable queries.

---

## 9. Representability and Merging

**Representability.** `v ∈ W` iff reducing `v` by the basis (XOR away each owned high bit) yields `0`. *Proof.* The reduction subtracts a XOR-combination of basis vectors; the remainder is `0` iff `v` equals that combination, i.e. `v ∈ ⟨basis⟩ = W`. If a leftover high bit has no pivot, that bit lies outside `W`'s column space at that position, so `v ∉ W`. ∎

**Merging two bases.** Given bases `A` (of `W_A`) and `B` (of `W_B`), inserting every nonzero vector of `B` into `A` via `add` produces a basis of `W_A + W_B = ⟨W_A ∪ W_B⟩` (span preservation, Section 6). The resulting rank is `dim(W_A + W_B) = rank(A) + rank(B) - dim(W_A ∩ W_B)`. Cost: `O(B²)` (up to `B` insertions, each `O(B)`). Merging is associative and commutative on spans, which is what makes a *segment tree of bases* valid (Section 5 of `senior.md`).

### 9.1 Worked Representability Check

With basis `{5=101, 3=011}`, test `v = 6 = 110`. Reduce high to low: bit2 set and `basis[2]=5` exists → `v ^= 5 = 110 ^ 101 = 011`. Now bit1 set and `basis[1]=3` exists → `v ^= 3 = 011 ^ 011 = 000`. Reached `0`, so `6` is representable — consistent with `6 = 3 ^ 5`. Now test `v = 4 = 100`: bit2 set, `basis[2]=5` → `4 ^ 5 = 100 ^ 101 = 001`. bit0 set, `basis[0]=0` (no pivot) → cannot clear bit0 → final `001 ≠ 0`, so `4` is **not** representable, consistent with `4 ∉ {0,3,5,6}`.

### 9.2 Merge and the Inclusion-Exclusion of Ranks

The rank formula `rank(W_A + W_B) = rank(A) + rank(B) - dim(W_A ∩ W_B)` is the GF(2) instance of the dimension formula for subspace sums. It implies a merge can *increase* the rank by anywhere from `0` (when `W_B ⊆ W_A`) up to `rank(B)` (when the spans are independent). In a segment tree of bases, the root basis has rank equal to the dimension of the span of the entire array — never more than `B` — which bounds total work and guarantees the structure stays compact regardless of `n`.

### 9.3 Worked Merge Example

Let basis `A = {3 = 011}` (rank 1, span `{0, 3}`) and basis `B = {5 = 101}` (rank 1, span `{0, 5}`). Merge by inserting `5` into `A`:

```
add(5=101) into A: bit2 set, A has no pivot at 2 -> install. A = {5=101, 3=011}.
```

Merged rank `2`, span `{0, 3, 5, 6}`. Check the formula: `rank(A)+rank(B) - dim(W_A∩W_B) = 1+1 - dim({0}) = 1+1-0 = 2`. The intersection of `{0,3}` and `{0,5}` is `{0}`, dimension `0`, so the merged rank is `2` — consistent.

---

## 10. Complexity Accounting

| Operation | Time | Space | Justification |
|-----------|------|-------|---------------|
| Trie insert | O(B) | O(B) nodes | one node per level worst case |
| Trie max/min-XOR walk | O(B) | O(1) | one decision per level |
| Max XOR pair over `n` | O(n·B) | O(n·B) | `n` inserts + `n` walks |
| Trie count `XOR < k` | O(B) | — | threshold routing, one level per step |
| Persistent trie build | O(n·B) | O(n·B) | each insert clones one path |
| Persistent range query | O(B) | — | two-version lockstep walk |
| Basis add | O(B) | O(B) total | ≤ `B` reduction steps; ≤ `B` pivots |
| Basis max/min/representable | O(B) | — | one pass over pivots |
| Basis reduce (RREF) | O(B²) | O(B) | eliminate each pivot from others |
| Basis k-th query | O(B) | — | bits of `k` select pivots |
| Basis merge | O(B²) | O(B) | `B` inserts |
| Segment tree of bases query | O(B² log n) | O(n·B) | merge `O(log n)` bases |

Detailed derivations for the headline rows:

- **Max XOR pair `O(n·B)`** — `n` inserts at `O(B)` each plus `n` walks at `O(B)` each: `2nB = O(n·B)`.
- **Basis build `O(n·B)`** — each of `n` values runs the `add` loop, bounded by `B` iterations.
- **Basis reduce `O(B²)`** — the outer loop runs over `B` pivots; the inner loop touches up to `B` vectors.
- **Segment tree of bases query `O(B² log n)`** — a range splits into `O(log n)` canonical nodes; merging each costs `O(B²)`.
- **Persistent trie space `O(n·B)`** — each insert clones exactly one length-`B` path; `n` inserts give `n·B` new nodes.

For word-size `B ≤ 64`, each XOR/shift is a single machine word operation, so the `B` factor is small and the constants are tiny — both structures are extremely fast in practice.

### 10.1 Amortized vs Worst-Case for the Trie

A single trie `insert` is `O(B)` worst case (a fully new path). Across `n` inserts the total node count is at most `n·B`, but in practice far fewer because of prefix sharing — the *amortized* node creation per insert is bounded by `B` but is typically much smaller for clustered data. The query walk, however, is always exactly `B` steps regardless of sharing, since it descends one level per bit. So query cost is tight at `Θ(B)` while space is `O(n·B)` worst case but data-dependent in practice.

### 10.2 Why the Basis Cannot Beat O(n·B) Build but Wins on Space

Building a basis reads each of the `n` inputs and reduces it in `O(B)`, so build is `Θ(n·B)` — the same as the trie. The asymmetry is *space*: the basis discards every dependent vector, retaining at most `B` words, whereas the trie must retain a path per distinct value. For a stream of `10^9` numbers with `B = 30`, the basis uses `30` words; the trie would need up to `3·10^{10}` nodes. This space gap, not a time gap, is the decisive reason to prefer the basis whenever the question is subset-shaped.

### 10.3 Lower Bounds Intuition

Any structure answering "max XOR pair" must, in the worst case, inspect `Ω(n)` inputs (an adversary can hide the optimal pair anywhere), and distinguishing values requires `Ω(B)` bits each, giving an `Ω(n + nB-information)` floor that the `O(n·B)` trie essentially meets. The basis's `O(B)` space is information-theoretically tight for representing a rank-`B` subspace, since a basis of a `B`-dimensional space over GF(2) needs `Θ(B²)` bits and the basis stores exactly that.

---

## 11. Trie vs Basis: A Unified View

Both structures are organized by **bit position from most significant to least**, and both rely on **MSB dominance** for their greedy correctness. The difference is *what they range over*:

- The **trie** ranges over the **actual stored values** `S`. Its greedy walk optimizes `x ^ y` for `y ∈ S` (a *pair* / membership query). It can represent a multiset and delete, because it stores each element's path.
- The **basis** ranges over the **span** `W = ⟨S⟩` (all subset XORs). Its greedy optimizes over `2^r` combinations, not over `S` itself. It cannot recover individual elements or delete, because reduction destroys identity.

They coincide only when the question happens to be expressible both ways. For example, "max XOR of any subset" is purely a basis question; "max XOR of a specific pair" is purely a trie question; there is no general reduction of one to the other. The shared mathematical core — lexicographic dominance of the top differing bit — is why both admit clean greedy algorithms and `O(B)` per-operation costs.

A useful mental model: the trie is a **prefix decision tree over a multiset of points**, while the basis is a **compressed representation of a linear subspace**. Points are not a subspace (they are not closed under XOR), and a subspace forgets its generating points — so neither can simulate the other in general. The few overlapping problems are exactly those where the answer depends only on the data through quantities both representations preserve.

---

## 12. Persistent Tries and Constrained Queries

### 12.1 Why Persistence Solves Index-Range Constraints

The plain trie loses positional information: once inserted, a value is indistinguishable from any other occupant. A **persistent** trie keeps a separate root `root[i]` for the prefix `a[0..i-1]`, where inserting `a[i]` allocates only the `O(B)` nodes on the changed root-to-leaf path and *shares* all untouched subtrees with `root[i]`. The total node count is `O(n·B)` because each insert clones one path of length `B`.

### 12.2 Range Queries via Version Differences

To query the multiset of `a[l..r]`, walk `root[r+1]` and `root[l]` in lockstep. The number of stored values in the index range that pass through a node is `cnt_{r+1}(node) − cnt_l(node)`, because version `r+1` includes the first `r+1` inserts and version `l` includes the first `l`. A child "exists in the range" precisely when this difference is positive. Feeding that existence test into the greedy max-XOR walk yields range max-XOR-pair in `O(B)` per query. The correctness is immediate: counts are monotone in the version index, so the difference is the exact count of in-range values down that branch — a standard persistent-prefix-sum argument.

### 12.3 Offline Value Constraints as a Monotone Sweep

For "max `x ^ a` over `a ≤ m`," there is no need for persistence: sort the array and the queries by their limit, then sweep with a monotone insertion pointer that only advances. Because the constraint `a ≤ m` is a prefix of the value-sorted order, the eligible set only grows as `m` increases, so each element is inserted exactly once across the whole query batch. This reduces a per-query subset selection to a single linear scan, giving `O((n + q)·B + (n + q)\log(n + q))` total. The mathematical content is that the family of constraint sets `{a ≤ m}` is a *chain* under inclusion, which is exactly the condition under which an offline monotone sweep applies.

---

## 13. Connections to Coding Theory and Linear Algebra

### 13.1 The Basis Is a Generator Matrix

Stack the basis vectors as rows of an `r × B` matrix `G` over GF(2). Then the span `W` is exactly the **row space** of `G`, and `W` is a linear code of length `B` and dimension `r` — the same object studied in coding theory. "Is `v` representable?" is "is `v` a codeword?"; "rank" is the code's dimension; "distinct XORs = `2^r`" is the codeword count. Reduction to RREF is putting `G` into standard form, and the pivot columns are the *information set* of the code.

### 13.2 Rank-Nullity in Action

The subset-to-XOR map `Φ : (GF(2))^n → (GF(2))^B` has `rank(Φ) = r` and `nullity(Φ) = n − r`. Rank-nullity (`rank + nullity = n`) is the precise statement that "number of independent inputs" plus "number of independent XOR-to-zero relations" equals the input count. The nullity counts the independent **linear dependencies** among the inputs — e.g. `3 ^ 5 ^ 6 = 0` in Section 5.1 is one such dependency, and there `n − r = 3 − 2 = 1`, matching exactly one independent relation.

### 13.3 Determinism of the Maximum, Nondeterminism of the Witness

The maximum subset XOR is a well-defined function of the span alone, hence deterministic. The *witnessing subset* that achieves it, however, is not unique when `n > r`: any of the `2^{n-r}` subsets in the achieving fiber works. Problems that ask only for the value are robust; problems that ask for a specific witnessing subset must fix a canonical choice (e.g. lexicographically smallest indices), which requires tracking which original inputs contributed to each pivot — a constant-factor bookkeeping overhead on top of the basis.

### 13.4 The Trie as a Binary Decision Diagram

The binary trie over `S` is an (uncompressed) **binary decision diagram (BDD)** for the indicator function of `S` with variable order MSB→LSB. Path compression turns it into a reduced BDD-like structure. This connection explains why variable ordering (MSB-first) is not a convenience but a correctness requirement for the greedy: the BDD's ordering must align with the significance order that the optimization respects.

### 13.5 Complexity Cheat Table

A compact summary of every result derived in this file:

| Quantity | Value | Source |
|----------|-------|--------|
| Greedy walk correctness | optimal | §3 (MSB dominance) |
| Distinct subset XORs | `2^r` | §5 (linear bijection) |
| Subsets achieving a given value | `2^{n-r}` | §5.2 (rank-nullity) |
| Basis correctness | independent + spanning | §6 |
| Max subset XOR | greedy high→low | §7 |
| k-th smallest XOR | bits of `k` over RREF | §8 |
| Representability | reduces to 0 | §9 |
| Merge rank | `r_A + r_B − dim∩` | §9.2 |
| Trie op | `O(B)` time | §10 |
| Basis op | `O(B)`; reduce/merge `O(B²)` | §10 |

### 13.6 Failure-of-Reduction Counterexamples

Two precise statements of *what breaks* when an invariant is violated:

- **Non-RREF k-th query.** Suppose pivots `basis[2] = 110` and `basis[1] = 010`. Here `basis[2]` carries pivot-1's bit. The map `ψ(01) = basis[1] = 010 = 2` and `ψ(10) = basis[2] = 110 = 6` and `ψ(11) = 100 = 4`. Sorted span is `{0, 2, 4, 6}`, but `ψ(10) = 6 > ψ(11) = 4` — *not* order-preserving. RREF (XOR `basis[1]` out of `basis[2]` to get `basis[2] = 100`) fixes it.
- **LSB-first trie.** If the trie were built LSB-first, the greedy "opposite bit" at the root would fix the *least* significant bit first, which does not dominate the comparison, so the walk could commit to a low-bit gain and miss a high-bit one — the maximization becomes incorrect.

### 13.7 End-to-End Worked Comparison: Trie vs Basis on One Array

Take `S = [3, 10, 5, 25, 2, 8]`, `B = 5`. We compute both the max XOR *pair* (trie) and the max XOR *subset* (basis), to make the distinction concrete.

Binary forms:

```
3  = 00011
10 = 01010
5  = 00101
25 = 11001
2  = 00010
8  = 01000
```

**Max XOR pair (trie).** Exhaustively, the best pair is `5 ^ 25 = 00101 ^ 11001 = 11100 = 28`. The greedy trie walk querying `5` recovers `25` as shown in Section 3.1. No other pair exceeds `28`:

```
3 ^ 25  = 11010 = 26
10 ^ 25 = 10011 = 19
8 ^ 25  = 10001 = 17
2 ^ 25  = 11011 = 27
5 ^ 25  = 11100 = 28   <-- max pair
```

**Max XOR subset (basis).** Build the basis over `S`:

```
add(25=11001): install basis[4] = 11001
add(10=01010): install basis[3] = 01010
add(3=00011):  install basis[1] = 00011
add(5=00101):  bit2 set, basis[2] empty -> install basis[2] = 00101
add(2=00010):  bit1 set, basis[1]=00011 -> 00010^00011=00001; install basis[0]=00001
add(8=01000):  bit3 set, basis[3]=01010 -> 01000^01010=00010; bit1 set, basis[1]=00011 -> 00010^00011=00001; bit0 set, basis[0]=00001 -> 0; dependent
```

Pivots installed at positions 4,3,2,1,0 → rank 5. Greedy max from `0`:

```
i=4: 0^11001=11001=25 > 0    -> res=25
i=3: 25^01010=10011=19 < 25  -> skip
i=2: 25^00101=11100=28 > 25  -> res=28
i=1: 28^00011=11111=31 > 28  -> res=31
i=0: 31^00001=11110=30 < 31  -> skip
```

Max subset XOR = `31` = `11111`. Note `31 > 28`: the subset answer strictly exceeds the pair answer here, which is the whole point of having two tools. The subset achieving `31` is, e.g., `25 ^ 5 ^ 3 = 11001 ^ 00101 ^ 00011 = 11111 = 31`. The trie can never report `31` because no single pair of stored values XORs to it; the basis can never report a "pair" constraint because it has forgotten which values were stored.

---

## 14. Summary

The proofs assembled here rest on a single recurring principle and a handful of consequences:

- **MSB dominance** orders integers by their highest differing bit, justifying every greedy choice.
- **The trie invariant** ties node presence to surviving candidates, making the forced-branch case globally (not just locally) forced.
- **GF(2) linear algebra** identifies subset XOR with linear combination, so the basis is literally a basis of a vector space.
- **The linear bijection** `φ : (GF(2))^r → W` gives `|W| = 2^r` and the `2^{n-r}` fiber size.
- **Echelon vs reduced echelon** distinguishes which queries need the extra `O(B²)` reduction (k-th does; max/representable do not).

The greedy max-XOR trie walk is correct because integer comparison is dominated by the most-significant differing bit: at each level the walk secures a `1` in the highest still-free position of the XOR whenever any stored candidate allows it, and an exchange argument shows no alternative can do better. The linear basis is a basis of the vector space `(GF(2))^B`, where subset XOR *is* linear combination; XOR-Gaussian elimination provably preserves span and yields independent pivot vectors, so the nonzero pivots form a basis of rank `r` and the span has exactly `2^r` elements (a bijection from `(GF(2))^r`). The same MSB-dominance argument proves the greedy maximum/minimum subset-XOR correct, and reducing to row-echelon form makes the pivot-bit map order-preserving, yielding the k-th smallest XOR by reading the bits of `k`. Complexity is `O(n·B)` for the trie pass and `O(B)`/`O(B²)` for basis operations, with `B ≤ 64` reducing the bit factor to single machine-word operations.
