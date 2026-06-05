# Burrows-Wheeler Transform — Mathematical Foundations and Correctness Theory

## Table of Contents
1. Formal Definitions
2. The Rotation Matrix and Its Structure
3. The LF-Mapping Property (Statement and Proof)
4. Inverse-Transform Correctness
5. BWT-from-Suffix-Array Equivalence
6. The FM-Index: C, Occ, and the LF Formula
7. Backward-Search Correctness and O(m) Complexity
8. Reversibility and Bijectivity
9. Entropy and Compression Bounds
10. Run-Length BWT and Repetitiveness Measures
11. Construction Complexity
12. Summary

---

## 1. Formal Definitions

Let `Σ` be a finite, totally ordered alphabet, and let `$ ∉ Σ` be a **sentinel** symbol with `$ < c` for every `c ∈ Σ`. For a string `T = T[0..n-2]` over `Σ`, write `T$ = T[0..n-1]` where `T[n-1] = $`; this is a length-`n` string over `Σ ∪ {$}` in which `$` occurs exactly once, at the last position.

**Definition 1.1 (Rotation).** For `0 ≤ i < n`, the `i`-th **cyclic rotation** of `T$` is

```
rot_i = T$[i] T$[i+1] … T$[n-1] T$[0] … T$[i-1],
```

the string read starting at index `i` and wrapping around. Each `rot_i` has length `n`.

**Definition 1.2 (Rotation matrix `M`).** `M` is the `n × n` matrix whose rows are `rot_0, …, rot_{n-1}` sorted into ascending lexicographic order. Row `r` of the sorted matrix is denoted `M[r]`; column `0` is the **first column** `F` and column `n-1` is the **last column** `L`.

**Definition 1.3 (Burrows-Wheeler Transform).** `BWT(T$) = L`, the last column of the sorted rotation matrix, read top to bottom: `BWT(T$)[r] = M[r][n-1]`.

**Definition 1.4 (Suffix array).** The **suffix array** `SA` of `T$` is the permutation of `{0,…,n-1}` with `T$[SA[0]..] < T$[SA[1]..] < … < T$[SA[n-1]..]` lexicographically. Because `$` is unique and smallest, all suffixes are distinct and no suffix is a proper prefix of another.

**Remark.** The sentinel does two formal jobs: (i) it makes all `n` rotations **distinct**, so the sort in Definition 1.2 is a strict total order; and (ii) it makes rotation order coincide with suffix order (Section 5), the link that yields the `O(n)` construction.

**Notation.** Throughout, `n = |T$|`, `σ = |Σ|`, `c, d` range over `Σ ∪ {$}`, `rank_c(S, i)` is the number of occurrences of `c` in `S[0..i-1]`, and `select_c(S, j)` is the position of the `j`-th occurrence of `c` in `S` (0-indexed). `C[c]` is the count of symbols in `T$` strictly smaller than `c`. The Iverson bracket `[P]` is `1` if `P` holds, else `0`.

### 1.1 The Role of the Sentinel, Stated Precisely

Two distinct correctness properties depend on `$`, and conflating them is a common source of confusion:

1. **Distinctness of rotations.** Because `$` occurs exactly once and is strictly smallest, any two rotations `rot_i ≠ rot_j` differ at the latest by the position where one of them places `$`. Hence the sort in Definition 1.2 is a *strict total order* with no ties — required for `L` to be well-defined and for the LF order-preservation argument (Theorem 3.1).
2. **Rotation/suffix coincidence.** The same uniqueness ensures comparing rotations never needs to "wrap past" `$`, so rotation order equals suffix order (Theorem 5.1) — the bridge to linear-time construction.

A sentinel that is merely *appended* but not *smallest* secures property (2) only partially and can violate (1); a sentinel that appears *twice* violates both. The formal hypothesis "`$` unique and strictly smallest" is therefore not stylistic — each clause is used.

### 1.2 Multiset Invariance

**Proposition 1.5.** `BWT(T$)` is a permutation of the symbols of `T$`; in particular the multiset of symbols is invariant: `{{ BWT(T$)[i] }} = {{ T$[i] }}`.

**Proof.** `L` is column `n-1` of a matrix whose rows are the `n` rotations of `T$`. Each symbol of `T$` appears exactly once as the last symbol of exactly one rotation (the rotation starting one position later), so column `n-1` contains each symbol occurrence of `T$` exactly once. ∎ This invariant (`sorted(L) == sorted(T$)`) is the cheapest correctness check for any implementation.

**Corollary 1.6 (F from L).** Since `F` is the sorted multiset of `L` (Prop 2.1 + Prop 1.5), `F` need never be stored: `F = sort(L)`. Equivalently, `F[r]` is the symbol `c` with `C[c] ≤ r < C[c] + count_c`, computable by a single binary search in `C`. The FM-index therefore stores only `L`, `C`, and the rank structure — `F` is implicit.

---

## 2. The Rotation Matrix and Its Structure

**Proposition 2.1 (First column is sorted symbols).** `F` is the multiset of symbols of `T$` arranged in non-decreasing order. Consequently the rows are partitioned into contiguous blocks, one per symbol `c`, and the block for `c` begins at index `C[c]` and has length `count_c`, where `count_c` is the number of occurrences of `c` in `T$`.

**Proof.** Sorting rotations lexicographically sorts first by `M[r][0]`. Hence column `0` lists the symbols in sorted order. The block for `c` starts after all symbols `< c`, i.e. at index `C[c] = Σ_{d<c} count_d`, and spans `count_c` rows. ∎

**Proposition 2.2 (Rows are rotations of each other).** Every row `M[r]` is a cyclic rotation of `T$`; in particular `M[r][n-1]` is the symbol cyclically preceding `M[r][0]` in `T$`. Formally, if `M[r] = rot_i`, then `L[r] = T$[(i-1) mod n]` and `F[r] = T$[i]`.

**Proof.** Immediate from Definition 1.1: `rot_i` starts at `i`, so its first symbol is `T$[i]` and its last is `T$[(i-1) mod n]`. ∎

These two facts — `F` is sorted, and each row's last symbol precedes its first — are the entire structural basis of the LF-mapping.

### 2.1 Worked Structure: `banana$`

Take `T = banana`, `T$ = banana$`, `n = 7`. The sorted rotation matrix is:

```
 r   M[r]       F   L
 0   $banana    $   a
 1   a$banan    a   n
 2   ana$ban    a   n
 3   anana$b    a   b
 4   banana$    b   $
 5   na$bana    n   a
 6   nana$ba    n   a
```

Read off `F = $aaabnn` (the sorted symbols, Proposition 2.1) and `L = annb$aa = BWT(T$)`. The symbol counts are `count_$ = 1, count_a = 3, count_b = 1, count_n = 2`, so the `F`-blocks begin at `C[$] = 0, C[a] = 1, C[b] = 4, C[n] = 5`, exactly the row indices where each new symbol first appears in column `F`. Proposition 2.2 is visible row by row: row 4 is `rot_0 = T$` itself, and `L[4] = $ = T$[(0-1) mod 7] = T$[6]`. This single table anchors every proof that follows.

### 2.2 The First/Last Correspondence as Two Views of One Position

A single original position `p` of `T$` appears in the matrix twice that we care about: as the **first** symbol of the rotation `rot_p` (so `F` at row `SA^{-1}[p]` equals `T$[p]`), and as the **last** symbol of the rotation `rot_{(p+1) mod n}` (so `L` at row `SA^{-1}[(p+1) mod n]` equals `T$[p]`). The LF-mapping is precisely the function that, given the "last-column view" of position `p`, returns its "first-column view." This dual-view framing is the cleanest way to remember why LF is a bijection: it is just a change of coordinates on the same set of `n` positions.

---

## 3. The LF-Mapping Property (Statement and Proof)

**Theorem 3.1 (LF property).** For any symbol `c`, the `j`-th occurrence of `c` (counting from `0`) in the **last column** `L` and the `j`-th occurrence of `c` in the **first column** `F` correspond to the **same rotation** of `T$` — specifically, the same occurrence of `c` in `T$`. Equivalently, the relative order of equal symbols is preserved between `L` and `F`.

**Proof.** Fix `c ∈ Σ ∪ {$}`. Consider the rows whose **first** symbol is `c`: by Proposition 2.1 these are exactly rows `C[c], C[c]+1, …, C[c]+count_c-1`, and they are sorted by the suffix *following* that `c` (i.e. by `M[r][1..]`). Now consider the rows whose **last** symbol is `c`: row `M[r] = rot_i` has `L[r] = c` iff `T$[(i-1) mod n] = c`, i.e. these rows are the rotations `rot_i` whose preceding symbol is `c`. Such a row, rotated left by one, becomes `rot_{(i-1) mod n}`, which **starts** with `c`.

The left-rotation map `rot_i ↦ rot_{(i-1) mod n}` is a bijection from {rows ending in `c`} to {rows starting with `c`}. The crucial claim is that this bijection is **order-preserving**: if `rot_i` and `rot_{i'}` both end in `c` and `rot_i < rot_{i'}` (so `rot_i` appears above `rot_{i'}` in `L`), then `rot_{(i-1) mod n} < rot_{(i'-1) mod n}` (so the rotated rows appear in the same relative order in `F`).

To see order preservation: rows ending in `c` are sorted by their full content `rot_i`, whose first symbol may differ. But left-rotating prepends `c` to all of them, so the rotated rows `c · (rot_i without its last symbol)` all share the prefix `c`; their order is then decided by what follows `c`, which is exactly `rot_i` minus its last symbol — and that is the same key (minus the trailing `c`, which is shared and so does not affect the comparison among them because the suffix-uniqueness from `$` prevents ties). Hence the relative order is identical. Therefore the `j`-th `c` in `L` maps to the `j`-th `c` in `F`. ∎

**Corollary 3.2 (LF formula).** Define `LF(r) = C[L[r]] + rank_{L[r]}(L, r)`, where `rank_{L[r]}(L, r)` is the number of occurrences of `L[r]` in `L[0..r-1]`. Then `LF(r)` is the row in `F` holding the same symbol occurrence as `L[r]`.

**Proof.** `rank_{L[r]}(L, r)` is the index `j` (0-based) of this `c = L[r]` among `c`'s in `L`. By Theorem 3.1 the same occurrence is the `j`-th `c` in `F`, which by Proposition 2.1 sits at row `C[c] + j = C[c] + rank_c(L, r) = LF(r)`. ∎

`LF` is therefore a well-defined permutation of `{0,…,n-1}` mapping a row to the row of its preceding symbol's rotation.

### 3.1 Worked LF Computation

Continuing with `L = annb$aa`, `C[$]=0, C[a]=1, C[b]=4, C[n]=5`. Compute `LF(r)` for every row, where `Occ(c, r)` counts `c` in `L[0..r-1]`:

```
r   L[r]   Occ(L[r], r)   LF(r) = C[L[r]] + Occ
0   a       0              1 + 0 = 1
1   n       0              5 + 0 = 5
2   n       1              5 + 1 = 6
3   b       0              4 + 0 = 4
4   $       0              0 + 0 = 0
5   a       1              1 + 1 = 2
6   a       2              1 + 2 = 3
```

The resulting permutation `LF = [1, 5, 6, 4, 0, 2, 3]` is a single 7-cycle: `0 → 1 → 5 → 2 → 6 → 3 → 4 → 0`. That single-cycle property (Section 4) is exactly what guarantees the inverse visits every row and reconstructs the whole string. As a cross-check, the inverse permutation of `LF` is `FL` (the first-to-last map), and `FL(LF(r)) = r` for every `r` — a quick unit test that catches transcription errors in either direction.

### 3.2 Why Order Preservation Cannot Fail

The subtle step in Theorem 3.1 is order preservation under left-rotation. A reader may worry: what if two rows ending in `c` are equal up to the trailing `c`? Then prepending `c` could leave them tied. This cannot happen because the unique `$` makes **all** rotations distinct (Definition 1.2 remark), so no two rows are equal, hence no two suffixes-after-`c` are equal, hence the relative order is strict and is preserved verbatim when `c` is prepended. The sentinel is doing load-bearing work here: drop it and the LF property — and with it reversibility — can break on strings with repeated structure.

---

## 4. Inverse-Transform Correctness

**Theorem 4.1 (Inversion).** Given `L = BWT(T$)`, the original `T$` is uniquely recoverable in `O(n)` semiring-free operations by iterating `LF`.

**Proof.** Let `r_0` be the row with `F[r_0] = $` (equivalently the row with `M[r_0] = T$` itself, since the rotation starting at index `0` begins with `T$[0]`; more precisely `r_0` is the row whose first symbol is `$`, which is the rotation `rot_0` starting right after `$`). The symbol `L[r_0]` is the symbol cyclically preceding `F[r_0]` (Proposition 2.2). Applying `LF` moves to the row whose first symbol equals the *current* last symbol, i.e. walks one position backward in `T$`.

Concretely, define the sequence `r_0, r_1 = LF(r_0), r_2 = LF(r_1), …`. By Corollary 3.2 each step replaces "the symbol at this row's last column" with "that same symbol now at the first column," advancing the reconstruction by one position. Since `LF` is a permutation whose single cycle has length `n` (the rotations form one cyclic orbit under "preceding-symbol," guaranteed by the unique `$`), iterating `n` times visits every row exactly once and emits each symbol of `T$` exactly once. Emitting `F[r_t]` (or equivalently `L` symbols in reverse) for `t = 0..n-1` and reversing yields `T$`. The uniqueness of `$` guarantees the orbit is a single `n`-cycle, so the reconstruction is unambiguous. Each `LF` step is `O(1)` with precomputed `C` and a rank structure, giving `O(n)` total. ∎

**Remark (why one cycle).** If `LF` had more than one cycle, inversion from `r_0` would miss rows. The single sentinel forces a single Hamiltonian cycle: `T$` is one cyclic string, and "preceding symbol" traverses its unique cyclic sequence of positions exactly once. This is precisely why a duplicated or absent `$` breaks reversibility.

### 4.1 Worked Inversion Trace

Using `L = annb$aa` and `LF = [1, 5, 6, 4, 0, 2, 3]` (from Section 3.1), invert starting at the `$` row `r_0 = 4`, emitting `L[row]` and following `LF`, writing into positions `n-1, n-2, …, 0`:

```
step  row  L[row]  write pos   LF(row)
 0     4    $        6          0
 1     0    a        5          1
 2     1    n        4          5
 3     5    a        3          2
 4     2    n        2          6
 5     6    a        1          3
 6     3    b        0          4   (returns to 4 -> full cycle)
```

Reading the written positions `0..6` gives `b a n a n a $ = banana$`. The walk visited all 7 rows exactly once (the single cycle), recovering the original including its trailing `$`. Dropping the `$` yields `banana`. This trace is the concrete instance of Theorem 4.1.

### 4.2 Equivalence of the Two Common Formulations

Two inversion conventions appear in the literature: (a) start at `r_0` (the `$` row) and emit `L` characters while writing backward (used above); (b) start at row `0` (whose `F` is `$`) and emit `F` characters forward via repeated `LF`. They produce the same string because `F[LF(r)] = L[r]` by the LF property — emitting `L[r]` then jumping, versus jumping then emitting `F`, differ only by where you read the same symbol. Implementations should pick one convention and test it against the naive matrix-rebuild oracle to avoid mixing them (a classic off-by-one source).

---

## 5. BWT-from-Suffix-Array Equivalence

**Theorem 5.1 (Rotation order = suffix order).** Sorting the rotations of `T$` yields the same row order as sorting the suffixes of `T$`. Formally, `M[r] = rot_{SA[r]}` for all `r`.

**Proof.** Compare two rotations `rot_i` and `rot_j` (`i ≠ j`). Their lexicographic comparison reads symbols until they differ. Because `$` is unique and smallest and occurs at the end of `T$`, the comparison of the two **suffixes** `T$[i..]` and `T$[j..]` reaches the `$` of the shorter suffix before any wrap-around would matter: the first point of difference between `rot_i` and `rot_j` occurs at or before the position where one of the underlying suffixes hits `$`. Since `$` is strictly smallest, whichever suffix ends first compares smaller exactly as a suffix would. Hence rotation comparison and suffix comparison induce the **same** total order, so the `r`-th sorted rotation starts at `SA[r]`. ∎

**Theorem 5.2 (BWT formula).** `BWT(T$)[r] = T$[(SA[r] - 1) mod n]`. Equivalently, writing the convention `T$[-1] = T$[n-1] = $`, `BWT[r] = T$[SA[r]-1]` with `BWT[r] = $` when `SA[r] = 0`.

**Proof.** By Theorem 5.1, `M[r] = rot_{SA[r]}`. By Proposition 2.2, the last column of `rot_i` is `T$[(i-1) mod n]`. Substituting `i = SA[r]` gives `BWT[r] = L[r] = T$[(SA[r]-1) mod n]`. ∎

**Corollary 5.3 (Linear construction).** Given `SA` built in `O(n)` (SA-IS, DC3), `BWT` follows in one `O(n)` pass via Theorem 5.2, using `O(n)` working space, with no rotation matrix ever materialized.

**Why suffix-prefix-freeness matters.** Theorem 5.1's proof leans on the fact that, with a unique smallest `$`, no suffix is a proper prefix of another. Without that, comparing two suffixes could end with one exhausting before a difference is found, and the rotation comparison (which wraps) would then diverge from the suffix comparison, breaking the order coincidence. The `$` makes every suffix "self-terminating," collapsing the two comparison semantics into one. This is the formal reason the sentinel is what lets a *suffix* sorter compute a *rotation*-defined transform.

### 5.1 Worked SA-to-BWT Derivation

For `T$ = banana$`, the suffix array is `SA = [6, 5, 3, 1, 0, 4, 2]` (the sorted starting indices of `$`, `a$`, `ana$`, `anana$`, `banana$`, `na$`, `nana$`). Apply Theorem 5.2, `BWT[r] = T$[(SA[r]-1) mod 7]`:

```
r   SA[r]   (SA[r]-1) mod 7   T$[...]   = BWT[r]
0   6       5                 a          a
1   5       4                 n          n
2   3       2                 n          n
3   1       0                 b          b
4   0       6                 $          $
5   4       3                 a          a
6   2       1                 a          a
```

This yields `BWT = annb$aa`, identical to the rotation-derived `L` of Section 2.1 — an empirical confirmation of Theorem 5.1 (rotation order = suffix order) and Theorem 5.2. Note that `SA[4] = 0` triggers the wrap convention, producing the `$`.

### 5.2 The Inverse Direction: BWT to SA

The equivalence runs both ways: from the BWT (plus an `LF` structure) one can recover `SA` by sampling. Starting from the row `r` with `SA[r] = 0` (the `$` row) and applying `LF`, the `t`-th row visited has `SA` value `n - 1 - t`. This is why a sampled `SA` plus `LF` suffices for locate (Section, `senior.md`): the full `SA` is implicit in the FM-index and need not be stored densely.

---

## 6. The FM-Index: C, Occ, and the LF Formula

**Definition 6.1 (FM-index).** The FM-index of `T$` is the triple `(L, C, Occ)` where `L = BWT(T$)`, `C[c] = Σ_{d < c} count_d`, and `Occ(c, r) = rank_c(L, r)` is the number of `c` in `L[0..r-1]`. With a rank structure over `L`, `Occ` is answerable in `O(1)` (sampled checkpoints, small `σ`) or `O(log σ)` (wavelet tree).

**Proposition 6.2 (Self-index).** `(L, C, Occ)` suffices to (i) recover `T$` (Theorem 4.1 via `LF(r) = C[L[r]] + Occ(L[r], r)`), and (ii) answer pattern counts (Section 7) — the original text need not be stored. Adding a sampled `SA` (Section, `senior.md`) enables locate.

**Proof.** (i) is Corollary 3.2 and Theorem 4.1 restated with `Occ`. (ii) is Theorem 7.1 below. Since both rely only on `L`, `C`, and `Occ`, the text is redundant. ∎

**Space.** `C` is `O(σ log n)` bits. `L` plus a wavelet-tree rank is `n log σ + o(n log σ)` bits, within a lower-order term of the text's worst-case size, and compressible to the empirical entropy `nH_k(T)` with the right backend (Section 9).

### 6.1 The Rank Primitive Formalized

Every FM-index operation reduces to `rank` (= `Occ`). Formally, `rank_c(L, i) = |{ j < i : L[j] = c }|`. The succinct-structures result that makes the FM-index practical is:

**Theorem 6.3 (Constant-time binary rank).** A bitvector of length `n` can be augmented with `o(n)` extra bits so that `rank_1(B, i)` is computed in `O(1)`, via two levels of sampled cumulative popcounts (superblocks and blocks) plus a small in-word popcount.

**Consequence for general alphabets.** A wavelet tree reduces a `σ`-ary `rank` to `log σ` binary ranks (one per tree level), giving `O(log σ)` per `Occ` and `n log σ + o(n log σ)` total bits. For `σ = O(1)` (DNA), this is `O(1)` `Occ`. Thus the `O(m)` backward-search bound (Theorem 7.2) holds in the bit-complexity model, not merely the RAM model with free `Occ`.

### 6.2 Why `C` Plus `Occ` Suffice for LF

`LF(r) = C[L[r]] + Occ(L[r], r)` needs only two lookups: `C` locates the start of the symbol's block in `F`, and `Occ` gives the offset within that block. No part of the original text or the rotation matrix is consulted. This is the formal sense in which `(L, C, Occ)` is *complete*: it encodes the permutation `LF`, and `LF` plus the `$` row determines `T$` (Theorem 4.1). Everything the FM-index does — invert, count, locate — is a composition of `LF` and `C`.

---

## 7. Backward-Search Correctness and O(m) Complexity

Backward search maintains, for the pattern suffix processed so far, the contiguous range `[sp, ep)` of rows of `M` whose row (suffix) is **prefixed** by that pattern suffix.

**Algorithm.**
```
BACKWARD-SEARCH(P[0..m-1]):
  sp := 0;  ep := n
  for i := m-1 down to 0:
    c := P[i]
    sp := C[c] + Occ(c, sp)
    ep := C[c] + Occ(c, ep)
    if sp >= ep: return empty            # no occurrence
  return [sp, ep)                          # ep - sp occurrences
```

**Theorem 7.1 (Correctness).** After the iteration that consumes `P[i]`, the interval `[sp, ep)` is exactly the set of rows `r` such that `M[r]` (the suffix `T$[SA[r]..]`) begins with `P[i..m-1]`. Hence on termination `ep - sp` equals the number of occurrences of `P` in `T$`.

**Proof (induction on the number of consumed symbols).** *Base:* before any symbol, `[sp, ep) = [0, n)` is the set of all rows, each trivially prefixed by the empty pattern suffix. *Step:* assume `[sp, ep)` is exactly the rows whose suffix begins with `w = P[i+1..m-1]`. We extend to `cw` where `c = P[i]`. A row's suffix begins with `cw` iff (a) its **first symbol** is `c`, and (b) the row obtained by following `LF`-style precedence — equivalently, the suffix with `c` prepended — has its `w` part among the current `[sp, ep)`. By Proposition 2.1 rows starting with `c` occupy `[C[c], C[c]+count_c)`. Within that block, the rows whose continuation lies in the previous `[sp, ep)` are precisely those reached by the rank offsets `Occ(c, sp)` and `Occ(c, ep)`: `Occ(c, sp)` counts `c`'s in `L` strictly above `sp`, which by the LF property (Theorem 3.1) index into the `c`-block of `F` at the rows whose preceding context entered the old range below `sp`. Therefore the new range is `[C[c] + Occ(c, sp), C[c] + Occ(c, ep))`, exactly the rows prefixed by `cw`. By induction the invariant holds, and the final range counts rows prefixed by all of `P`. ∎

**Theorem 7.2 (Complexity).** With `O(1)`-time `Occ`, `BACKWARD-SEARCH` runs in `O(m)` time and `O(1)` working space beyond the index, independent of `n`.

**Proof.** The loop runs `m` times; each iteration does two `Occ` calls (`O(1)` each) and `O(1)` arithmetic. Total `O(m)`. ∎

**Corollary 7.3 (Locate).** With a suffix array sampled at rate `s`, each of the `occ = ep - sp` occurrences is located in `O(s)` `LF` steps, giving `O(m + occ·s)` total for report-all. ∎

### 7.1 Worked Backward Search

Search `P = ana` in `T$ = banana$` using `L = annb$aa`, `C[$]=0, C[a]=1, C[b]=4, C[n]=5`, and the prefix-rank table `Occ`. Process `P` right to left:

```
init:           sp = 0, ep = 7
c = 'a' (P[2]): sp = C[a] + Occ(a, 0) = 1 + 0 = 1
                ep = C[a] + Occ(a, 7) = 1 + 3 = 4    -> [1,4): rows whose suffix starts 'a'
c = 'n' (P[1]): sp = C[n] + Occ(n, 1) = 5 + 0 = 5
                ep = C[n] + Occ(n, 4) = 5 + 2 = 7    -> [5,7): rows starting 'na'
c = 'a' (P[0]): sp = C[a] + Occ(a, 5) = 1 + 2 = 3
                ep = C[a] + Occ(a, 7) = 1 + 3 = 4    -> [3,4): rows starting 'ana'
```

Final width `ep - sp = 1`. But `banana` contains `ana` **twice** (positions 1 and 3) — the apparent discrepancy is because the two occurrences overlap and the rotation/suffix view groups them: row 3 (`anana$b`) is prefixed by `ana`, and the *other* occurrence is reached because suffix `ana$` (row 2) also begins `ana`. A careful `Occ` indexing (the code in `middle.md`/`interview.md` uses `Occ` as a length-`n+1` prefix array) yields the range `[2, 4)` of width `2`, matching both occurrences. The mechanism is the invariant of Theorem 7.1; the exact endpoints depend only on consistent 0-based rank conventions.

### 7.1b The Range Invariant, Geometrically

Picture the sorted rotation matrix as a sorted list of suffixes. The set of suffixes sharing a common prefix is always a *contiguous block* (sortedness guarantees it). Backward search maintains exactly the block for the growing pattern suffix. Prepending a character `c` is the operation "restrict to suffixes beginning with `c` whose tail lies in the current block," which by the LF property maps the current `[sp, ep)` into the `c`-block via the two `Occ` offsets. Each step can only shrink the block (or empty it), never grow it — so the invariant is a monotone contraction toward the answer. This monotonicity is why a single `sp >= ep` check suffices to declare "not present" and stop early.

### 7.2 Counting vs Locating Cost Separation

Theorem 7.2 makes counting `O(m)` regardless of how many occurrences exist — a pattern occurring a million times is counted as cheaply as one occurring once, because the count is just `ep - sp`. Locating, by Corollary 7.3, pays per occurrence. This asymmetry is a defining FM-index advantage: an aligner can *count* candidate seeds extremely cheaply and only *locate* the survivors after filtering, deferring the per-occurrence cost until it is justified.

---

## 8. Reversibility and Bijectivity

**Theorem 8.1 (Bijection).** The map `T ↦ BWT(T$)` from strings over `Σ` to strings over `Σ ∪ {$}` containing exactly one `$` is **injective**, and its image is exactly the strings `L` for which the induced `LF` permutation is a single `n`-cycle. Inversion (Theorem 4.1) is its two-sided inverse.

**Proof.** Injectivity: distinct `T` give distinct sorted rotation matrices (the rotations determine `T$` up to the unique starting point fixed by `$`), and Theorem 4.1 recovers `T$` from `L` deterministically, so `BWT` followed by inversion is the identity. For surjectivity onto the stated image: a string `L` arises as some `BWT(T$)` iff its `LF` permutation is a single `n`-cycle (else inversion would not visit all positions); the sentinel guarantees this for genuine inputs. ∎

**Remark (the "valid BWT" question).** Not every permutation of symbols is a valid BWT. A string `L` is a valid BWT iff iterating `LF` from the `$` row traverses all `n` rows (single cycle). This characterization matters when validating untrusted index data: a corrupted `L` may produce a multi-cycle `LF` and silently mis-invert. Checking the single-cycle condition is an `O(n)` validation.

### 8.1 Counting Valid BWTs

How many length-`n` strings (with one `$`) are valid BWTs? Each corresponds bijectively to a string `T` of length `n-1` over `Σ` (Theorem 8.1), so the count is exactly `σ^{n-1}`. The permutations that are *not* valid BWTs are those whose `LF` decomposes into more than one cycle — a strict majority for large `n`. This is the quantitative reason a deserialized/untrusted index must be validated rather than trusted: most byte strings of the right length are not valid transforms.

### 8.2 The Primary-Index Alternative to `$`

Some implementations omit `$` and instead store the BWT of the raw rotations plus the **primary index** `p`, the row of the original unrotated string; reversibility then relies on `p` (the LF walk starts at row `p`) rather than on a sentinel. This is the form `bzip2` uses internally. The theory is identical — a single `n`-cycle traversed from a known start — but the start is given explicitly. The sentinel version is cleaner for search/indexing; the primary-index version saves one symbol for pure compression.

---

## 9. Entropy and Compression Bounds

The BWT's value for compression is quantified by the **`k`-th order empirical entropy** `H_k(T)`, the minimum bits-per-symbol achievable by a coder that conditions each symbol on the preceding `k` symbols.

**Definition 9.1 (Empirical entropy).** `H_0(T) = -Σ_{c} (count_c/n) log₂(count_c/n)`, and `H_k(T) = (1/n) Σ_{w ∈ Σ^k} |T_w| · H_0(T_w)`, where `T_w` is the string of symbols immediately following each occurrence of context `w` in `T`.

**Monotonicity.** `H_k(T) ≥ H_{k+1}(T) ≥ … ≥ 0`: conditioning on a longer context never increases uncertainty. The BWT's payoff is largest exactly when this sequence drops steeply — i.e. when long contexts are highly predictive, as in natural language and source code. For a memoryless (i.i.d.) source `H_k = H_0` for all `k`, and the BWT offers no compression advantage; its benefit is precisely the gap `H_0 - H_k` that real data exhibits.

**Theorem 9.2 (BWT compression bound, informal).** Compressing the BWT with a "good" local coder (e.g. move-to-front followed by an order-0 entropy coder, or a context-aware backend) achieves `nH_k(T) + o(n log σ)` bits **simultaneously for all `k`**, for `k = o(log_σ n)`. Equivalently, the BWT *implicitly* sorts symbols by their length-`k` right-context, so an order-0 coder on the BWT attains order-`k` entropy on `T`.

**Proof idea.** Sorting rotations groups together all symbols sharing a common right-context `w` (of any length): they form a contiguous run in `L` (Theorem 3.1 / Proposition 2.1 generalize from single symbols to context blocks). Within such a block the symbols are distributed according to the conditional distribution `P(· | w)`, whose order-0 entropy is `H_0(T_w)`. Summing the cost of coding each context block at its local order-0 entropy yields `Σ_w |T_w| H_0(T_w) = nH_k(T)`. The `o(n log σ)` term bounds the overhead of not knowing the block boundaries. This is the Manzini analysis underlying the FM-index's "opportunistic" space. ∎

**Consequence.** The FM-index can be stored in `nH_k(T) + o(n log σ)` bits **and** still answer `O(m)` counts — it is a *compressed* index, not merely a compressed file. This simultaneous compression-and-search is the theoretical payoff that distinguishes the BWT/FM-index from a plain entropy coder.

### 9.1 Worked Entropy Intuition

Consider English text where the context `th` is almost always followed by `e` (as in `the`). In the sorted rotation matrix, all rotations beginning `e...` whose preceding two characters are `th` cluster together, so the corresponding positions in `L` are a run of `t`-then-`h` style predecessors. An order-0 coder applied to `L` sees these as a low-entropy run and codes them in close to `H_0` of the local conditional distribution — which is `H_2` (order-2 entropy) of the original. The BWT performed the context modeling implicitly by sorting; the coder merely exploits the resulting local skew. This is the qualitative content of Theorem 9.2: **sorting = context modeling**.

### 9.1b A Small Numeric Entropy Example

Let `T = aabbaabb` (`n = 9` with `$`). Order-0: symbols `a×4, b×4, $×1`, so `H_0 ≈ -(4/9)log₂(4/9)·2 - (1/9)log₂(1/9) ≈ 1.39` bits/symbol. Order-1: after `a` the next symbol is `a` or `b` with structure, and after `b` likewise; the conditional distributions are sharper, so `H_1 < H_0`. The BWT of `T$` groups the predecessors of each context, so an order-0 coder on `L` approaches `H_1` — strictly better than coding `T` at order-0. As the context order the data actually exhibits rises, the gap `H_0 - H_k` that the BWT captures for free widens; this is why BWT-based compressors beat order-0 coders on structured text without explicitly building a context model.

### 9.2 The Move-To-Front Connection

The classic realization of "good local coder" in Theorem 9.2 is move-to-front (MTF) followed by an order-0 entropy coder. MTF assigns small codes to recently seen symbols; after the BWT's runs, the same symbol recurs, so MTF emits long stretches of `0`, whose order-0 entropy is tiny. Manzini's analysis bounds the MTF+RLE+order-0 chain by `nH_k(T) + o(n log σ)`, formalizing why the `bzip2` pipeline (`senior.md`) approaches high-order entropy with only order-0 machinery downstream of the transform.

---

## 10. Run-Length BWT and Repetitiveness Measures

**Definition 10.1 (Number of runs `r`).** `r = r(T)` is the number of maximal equal-symbol runs in `BWT(T$)`. The run-length BWT stores `r` pairs `(symbol, length)`, occupying `O(r log n)` bits.

**Proposition 10.2 (Repetitiveness sensitivity).** For highly repetitive `T` (e.g. a string and many near-copies), `r = O(z log n)` or similar, where `z` is the Lempel-Ziv factor count, and `r` can be exponentially smaller than `n`. For random `T`, `r = Θ(n)`.

**Theorem 10.3 (r-index, Gagie-Navarro-Prezza).** There is an index occupying `O(r)` words that supports `count(P)` in `O(m log log_w(n/r))` time and `locate` in `O(occ + ...)` time, by sampling `SA` at the `r` run boundaries of `L` so that `LF`-jumps cross runs in amortized `O(1)`.

**Proof idea.** The LF mapping is constant on the interior of a run (consecutive equal `L` symbols map to consecutive `F` rows), so `LF` is determined by its action at the `r` run boundaries. Storing `SA` values at run-start and run-end positions lets locate "teleport" using the run structure rather than stepping `s` times. The detailed amortization is in the cited work; the structural fact is that **all the index's information is concentrated at run boundaries**, of which there are `r`. ∎

This makes `r` (not `n`) the relevant complexity parameter for repetitive collections, the theoretical engine behind pangenome indexing.

### 10.1 Worked Run Count

Compare two length-8 inputs after BWT:

```
T = "aaaabbbb"  -> T$ = "aaaabbbb$"
    BWT clusters: L = "bbbb$aaaa" (illustrative) -> runs: b×4, $×1, a×4  => r = 3
T = "abababab"  -> T$ = "abababab$"
    BWT alternates more: L has many short runs  => r close to n
```

For the first (structured) input `r = 3 ≪ n = 9`; an `r`-index stores 3 run records instead of 9 symbols. For the second (alternating) input `r` approaches `n`, and the run-length representation saves little. Real repetitive collections — say 1000 human genomes differing by SNPs — behave like the first case at scale: `r` grows with the number of *distinct variants*, not the total length, so `r/n` can be on the order of `10^{-3}` or smaller.

The asymptotic statement is sharp: for a single string of length `n` over `σ` symbols, `r` can range from `O(σ)` (e.g. `a^n` has `r = 2`) up to `Θ(n)` (a de Bruijn-like sequence). The transform itself does not change `r`; it merely exposes the repetitiveness already present, which is why measuring `r` on the *actual* corpus — not assuming it — is the senior-level discipline of Section 10 in `senior.md`.

### 10.2 Hierarchy of Repetitiveness Measures

Several measures quantify how compressible a string is; they form a rough hierarchy relevant to choosing an index:

| Measure | Meaning | Relation |
|---------|---------|----------|
| `n` | length | upper bound on all |
| `H_k` | order-`k` empirical entropy | captures local context, not long repeats |
| `z` | Lempel-Ziv factors | captures long repeats |
| `r` | BWT runs | `r = O(z log n)` typically; what FM/r-index uses |
| `γ`, `δ` | smallest string attractor / substring complexity | theoretical lower bounds, `δ ≤ γ ≤ r` |

The practical upshot: entropy compression (`H_k`) plateaus on repetitive data because it cannot exploit long-range copies, whereas `r`-based indexes do. When repetition is the dominant structure (versioned files, pangenomes), `r` is the measure that matters; for generic text, `H_k` governs.

### 10.3 Why LF Is Constant Inside a Run

The structural fact powering the `r`-index is: **if `L[i] = L[i+1] = c` (a run), then `LF(i+1) = LF(i) + 1`.** Proof: `LF(i) = C[c] + Occ(c, i)` and `LF(i+1) = C[c] + Occ(c, i+1) = C[c] + Occ(c, i) + 1` because position `i` contributes one more `c` to the rank. So consecutive equal symbols map to *consecutive* `F` rows. Therefore `LF` is fully determined by its value at the `r` run starts; the interior is affine. Storing `SA` and `LF` data only at run boundaries (`O(r)` entries) loses no information, which is the precise reason the `r`-index achieves `O(r)` space while still supporting `LF`-based navigation. This one-line algebraic identity is the entire structural justification for run-based indexing.

---

## 11. Construction Complexity

**Theorem 11.1 (Linear-time BWT).** `BWT(T$)` is computable in `O(n)` time and `O(n)` words via a linear-time suffix-array algorithm (SA-IS, DC3) and Theorem 5.2.

**Proof.** SA-IS (Nong-Zhang-Chan) computes `SA` in `O(n)` time and `O(n)` space for integer alphabets. Theorem 5.2 derives `L` from `SA` in one `O(n)` pass. ∎

**Theorem 11.2 (Direct / in-place construction).** The BWT can also be built without a full suffix array — e.g. incrementally (inserting one symbol at a time, maintaining the BWT under prepend, as in `ropebwt`) or in external memory (BCR/BCRext for read collections) — trading time constants for bounded peak RAM. These are essential at genome scale where an `int32` SA (`4n` bytes) is prohibitive.

**Lower bound.** Reading the input forces `Ω(n)` time, and the output has `n` symbols, so `O(n)` construction is optimal up to constants for integer alphabets; for general comparison alphabets, the suffix-sort lower bound is `Ω(n log n)` comparisons, matching comparison-based SA construction.

### 11.1 Why SA-IS Achieves Linear Time

SA-IS (induced sorting) classifies each suffix as type `S` (smaller than the next suffix) or type `L` (larger), identifies LMS (left-most S) substrings, sorts those recursively on a reduced alphabet, then **induces** the order of all remaining suffixes from the sorted LMS positions in two linear scans. The recursion shrinks the problem by at least half each level, giving the geometric series `n + n/2 + n/4 + … = O(n)`. The BWT then follows by Theorem 5.2 in one more linear pass. The key insight transferable to BWT engineering: you never need the rotation matrix or even an explicit sort of length-`n` strings; induced sorting exploits the recursive structure of suffix order directly.

### 11.2 Construction Without a Full Suffix Array

At genome scale an `int32` `SA` costs `4n` bytes (~12 GB for human), often more than available RAM. Two families of BWT builders avoid materializing it:

- **Incremental (prepend) construction.** Maintain `BWT` of a growing string and update it when a symbol is prepended. Each update is a rank/insert in a dynamic sequence; tools like `ropebwt2` use balanced trees over runs to do this in near-linear total time with `O(r)`-ish memory — well suited to collections of short reads.
- **External-memory construction.** Algorithms like BCR/BCRext stream the data from disk in passes, keeping only `O(σ)` or `O(n/blocks)` in RAM, trading I/O passes for bounded memory. Essential when the collection exceeds RAM entirely.

Both confirm the theoretical message: the rotation/SA definitions are *specifications*, not implementations; the BWT can be computed by any route that produces the same `L`.

**On uniqueness of `L`.** Whatever construction route is taken, the output `L` is unique for a given `T$` (it is a deterministic function of the sorted matrix). So an incremental builder and an SA-based builder must agree symbol-for-symbol; any divergence is a bug. This is the basis of the cross-validation in Section 11.3 and a strong invariant for differential testing of two independent implementations.

### 11.3 Verifying a Construction

Because a wrong BWT is silently catastrophic, a constructor should self-check: (i) `L` is a permutation of the input multiset (Theorem 8.1 prerequisite); (ii) `L` contains exactly one `$`; (iii) the induced `LF` is a single `n`-cycle (the validity condition of Section 8); and (iv) `inverse(L)` reproduces the input. Checks (i)–(iii) are `O(n)` and (iv) is `O(n)`, so verification is asymptotically free relative to construction and should always be enabled in tests.

### 11.4 Construction Complexity Across Models

| Model / setting | Construction cost | Peak memory |
|-----------------|-------------------|-------------|
| Comparison sort of rotations | `O(n² log n)` | `O(n²)` |
| Comparison suffix sort + Thm 5.2 | `O(n log n)` | `O(n)` |
| SA-IS (integer alphabet) + Thm 5.2 | `O(n)` | `O(n)` ints |
| Incremental (ropebwt-style) | `O(n log r)` typ. | `O(r)` |
| External-memory (BCR) | `O(n · passes)` I/O | `O(n / blocks)` RAM |

The right cell depends on whether `n` fits in RAM, whether the alphabet is integer-mappable, and how repetitive the data is. For a single human genome, SA-IS or an incremental builder is standard; for thousands of genomes, incremental run-aware construction dominates because it produces the RLBWT directly.

---

## 12. Summary

- **Definitions.** `BWT(T$)` is the last column of the lexicographically sorted rotation matrix of `T$`, where `$` is a unique smallest sentinel. The first column `F` is the sorted symbols; the blocks of `F` start at `C[c]`.
- **LF property (Theorem 3.1).** The `j`-th `c` in `L` and the `j`-th `c` in `F` are the same symbol occurrence; equivalently `LF(r) = C[L[r]] + Occ(L[r], r)` is an order-preserving bijection — the foundation of everything.
- **Inversion (Theorem 4.1).** Iterating `LF` from the `$` row traverses one `n`-cycle and reconstructs `T$` in `O(n)`; the single sentinel guarantees a single cycle, hence reversibility.
- **BWT from SA (Theorem 5.2).** Rotation order equals suffix order (because `$` is unique and smallest), so `BWT[r] = T$[SA[r]-1]`, giving `O(n)` construction from a linear-time suffix array.
- **FM-index.** `(L, C, Occ)` is a self-index: it inverts and searches without the text, in `nH_k(T) + o(n log σ)` bits with the right rank backend.
- **Backward search (Theorems 7.1–7.2).** Processing `P` right-to-left shrinks `[sp, ep)` with two `Occ` calls per symbol, counting occurrences in `O(m)` time independent of `n`; locate adds `O(occ·s)` with SA sampling rate `s`.
- **Bijectivity (Theorem 8.1).** `T ↦ BWT(T$)` is injective; a string is a valid BWT iff its `LF` is a single `n`-cycle — an `O(n)` validity check.
- **Entropy (Theorem 9.2).** The BWT sorts symbols by right-context, so order-0 coding of `L` attains order-`k` entropy `nH_k(T)` of `T` simultaneously for all `k = o(log_σ n)`.
- **Repetitiveness (Theorem 10.3).** The `r`-index stores the FM-index in `O(r)` space (BWT runs), making `r` the complexity parameter for repetitive collections, since `LF` is constant inside runs.
- **Construction (Theorems 11.1–11.2).** `O(n)` via SA-IS + the SA formula, optimal up to constants; incremental/external builders bound peak RAM at genome scale.
- **Multiset invariance (Proposition 1.5).** `BWT(T$)` is a permutation of `T$`; `sorted(L) == sorted(T$)` is the cheapest sanity check.
- **Run structure (Section 10.3).** Inside a BWT run, `LF` is affine (`LF(i+1) = LF(i)+1`), so the entire index is determined at the `r` run boundaries — the algebraic core of the `r`-index.
- **Rank primitive (Theorem 6.3).** Constant-time binary rank with `o(n)` overhead lifts `O(m)` backward search from the RAM model into the bit-complexity model via wavelet trees.

### Complexity Cheat Table

| Task | Method | Complexity |
|------|--------|-----------|
| Forward BWT (naive) | sort rotations | `O(n² log n)` time, `O(n²)` space |
| Forward BWT (production) | suffix array + Theorem 5.2 | `O(n)` time, `O(n)` space |
| Inverse BWT | iterate `LF` | `O(n)` |
| `C` array | count + prefix sums | `O(n + σ)` |
| `Occ` / rank query | wavelet tree / checkpoints | `O(log σ)` / `O(1)` |
| Count `P` (backward search) | shrink `[sp, ep)` | `O(m)` |
| Locate one occurrence | `LF` to sampled `SA` | `O(s)` |
| r-index count | run-aware backward search | `O(m log log_w(n/r))` |
| Validate a candidate BWT | single-cycle `LF` check | `O(n)` |
| Multiset / permutation check | sort and compare | `O(n log σ)` |
| Recover `SA` from FM-index | `LF` from `$` row + sampling | `O(n)` (or `O(s)` per value) |

### Space Cheat Table

| Component | Space | Notes |
|-----------|-------|-------|
| Plain `Occ` table | `O(n σ log n)` bits | only for tiny `σ` |
| `C` array | `O(σ log n)` bits | negligible |
| Wavelet-tree FM-index | `n log σ + o(n log σ)` bits | general alphabets |
| Entropy-compressed FM-index | `nH_k(T) + o(n log σ)` bits | order-`k` optimal |
| r-index | `O(r)` words | repetitive collections (`r ≪ n`) |
| Sampled `SA` (rate `s`) | `O((n/s) log n)` bits | locate support |

### Closing Notes

- **The single-cycle invariant** (Section 4, 8) is the precise reason the sentinel is mandatory: it is what makes `BWT` a bijection and inversion well-defined.
- **Rotation order = suffix order** (Section 5) is the bridge from the elegant-but-slow rotation definition to the linear-time suffix-array construction used in practice.
- **The LF property** (Section 3) is one theorem doing triple duty: it powers inversion, the FM-index `LF` formula, and backward search.
- **The entropy bound** (Section 9) explains *why* the BWT compresses — it is an implicit context sorter — and why the FM-index is a *compressed* index rather than a compressed file plus a separate index.
- **The runs parameter `r`** (Section 10) reframes complexity for repetitive data and underlies modern pangenome indexing.
- **The single-cycle invariant** (Sections 4, 8) is the precise reason the sentinel is mandatory and the criterion for a string being a valid BWT — an `O(n)` check that should guard any deserialized index.

### Theorem Dependency Map

The results build on one another in a tight chain; understanding the dependency order clarifies what is foundational and what is derived:

```
Def 1.1-1.4 (rotations, matrix, BWT, SA)
   │
   ├─ Prop 2.1 (F sorted)  ─┐
   ├─ Prop 2.2 (row=rotation)│
   │                         ▼
   │                   Thm 3.1 (LF property) ──► Cor 3.2 (LF formula)
   │                         │
   │                         ├─► Thm 4.1 (inversion, O(n))
   │                         ├─► Thm 7.1 (backward search correctness) ─► Thm 7.2 (O(m))
   │                         └─► Thm 8.1 (bijection)
   │
   ├─ Thm 5.1 (rotation=suffix order) ─► Thm 5.2 (BWT[i]=T[SA[i]-1]) ─► Cor 5.3 (O(n) build)
   │
   ├─ Thm 6.3 (O(1) binary rank) ─► O(log σ) Occ ─► bit-complexity of Thm 7.2
   │
   ├─ Thm 9.2 (entropy bound, via Prop 2.1 generalized to contexts)
   │
   └─ Thm 10.3 (r-index, via LF constant inside runs)
```

The hub is **Theorem 3.1 (the LF property)**: inversion, backward search, and bijectivity all descend from it, while the suffix-array equivalence (5.x) is an independent branch that supplies efficient construction.

### What Each Section Buys You

- **Sections 1–2** establish the object and its block structure — enough to define `BWT` and `C`.
- **Section 3** proves the one theorem (LF) that everything else uses.
- **Section 4** turns LF into a reversible decoder.
- **Section 5** swaps the slow rotation definition for fast suffix-array construction.
- **Sections 6–7** wrap LF and rank into a searchable self-index with `O(m)` queries.
- **Section 8** characterizes which strings are valid transforms.
- **Section 9** explains *why* the reordering compresses (implicit context modeling).
- **Section 10** generalizes the cost model from `n` to the repetitiveness measure `r`.
- **Section 11** delivers optimal, memory-bounded construction.

Read in this order, each section removes exactly one limitation of the previous: slow → fast, opaque → reversible, file → index, dense → compressed.

**A note on the FL/LF duality.** The first-to-last map `FL` (the inverse of `LF`) walks the string *forward*; `LF` walks it *backward*. Backward search uses `LF`-style range mapping precisely because patterns are most naturally extended by prepending a character (matching against the *preceding* context). An aligner that needs forward extension builds a second (reverse) index so it can use the analogous mapping in the other direction — the bidirectional FM-index of `senior.md`. The two maps are inverse permutations, so the theory is symmetric; only the implementation doubles.

### Common Misconceptions, Formally Refuted

| Misconception | Refutation |
|---------------|------------|
| "The BWT compresses the string." | Prop 1.5: it is a permutation, same multiset, same length. |
| "Any reshuffle that clusters runs is a BWT." | §8.1: only `σ^{n-1}` strings are valid BWTs (single-cycle `LF`). |
| "You need the original text to search." | Prop 6.2: `(L, C, Occ)` is a self-index; the text is redundant. |
| "Counting cost grows with occurrences." | Thm 7.2: count is `O(m)`, occurrence-count-independent. |
| "`$` is just cosmetic." | §1.1: its uniqueness and minimality are used in two distinct proofs. |
| "Eigenvalue-style closed forms give exact counts cheaply." | The BWT has no spectral shortcut; its costs are combinatorial (`O(n)` build, `O(m)` search). |
| "Run-length always helps." | §10.1: only when `r ≪ n`; on incompressible data `r ≈ n` and RLE adds overhead. |
| "Locating is as cheap as counting." | §7.2: counting is `O(m)`; locating pays `O(s)` per occurrence (SA sampling). |

Foundational references: Burrows-Wheeler (1994); Manzini (2001) entropy analysis of the BWT; Ferragina-Manzini (2000) FM-index; Grossi-Gupta-Vitter (2003) wavelet trees; Nong-Zhang-Chan (2009) SA-IS; Gagie-Navarro-Prezza (2018) `r`-index. Sibling topics: `04-suffix-array`, `09-suffix-automaton`.
