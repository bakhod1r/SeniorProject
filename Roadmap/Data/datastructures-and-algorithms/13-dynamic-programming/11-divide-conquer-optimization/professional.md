# Divide and Conquer DP Optimization — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Monge / Quadrangle Inequality
3. Monge Implies Monotone Argmin (Main Theorem)
4. Correctness of the Divide-and-Conquer Recursion
5. Complexity: O(n log n) per Layer
6. Total-Monotonicity and the SMAWK Connection
7. Relationship to Knuth Optimization
8. Relationship to the Convex Hull Trick
9. The 1-D k-Means / Clustering Instance
10. Verifying the Quadrangle Inequality
11. Lower Bounds and When O(n) Is Possible
12. Summary

---

## 1. Formal Definitions

Fix a layer `i ≥ 1`. We are given the previous-layer values `g(k) := dp[i-1][k]` for `k ∈ {0, 1, …, n}` (some possibly `+∞`), and a cost function `C : {(k, j) : 0 ≤ k ≤ j ≤ n} → ℝ ∪ {+∞}`.

**Definition 1.1 (Layered partition DP).** For `0 ≤ j ≤ n`,

```
f(j) := dp[i][j] = min over k ∈ [0, j) of ( g(k) + C(k, j) ),
```

with the convention `f(0) = g(0)` (the empty prefix) and `min over the empty set = +∞`.

**Definition 1.2 (Optimal split / argmin).** Let

```
A(j) := { k ∈ [0, j) : g(k) + C(k, j) = f(j) }
opt(j) := min A(j)        (the smallest minimizer; ties broken downward).
```

We call `opt(j)` the **optimal split point** for column `j` in layer `i`.

**Definition 1.3 (Cost matrix).** Define the `(n+1) × (n+1)` matrix

```
M[k][j] := g(k) + C(k, j)   for k < j,   and   M[k][j] := +∞ otherwise.
```

Then `f(j)` is the minimum of column `j` of `M`, and `opt(j)` is the (smallest) row index achieving it. Finding all `f(j)` is exactly the problem of finding all column minima of `M`.

**Notation conventions.** Throughout:

- `n` — the number of columns / items (columns indexed `0..n`).
- `K` — the number of layers (segments to use).
- `g(k) = dp[i-1][k]` — the previous-layer value at split `k`.
- `C(k, j)` — the segment cost over the half-open interval `[k, j)`.
- `opt(j)` — the smallest minimizer of column `j` (ties broken downward).
- `[a, b]` — an inclusive integer interval; `[k, j)` a half-open one.
- `QI` — the quadrangle (Monge) inequality.
- "Monotone non-decreasing" — means `opt(j) ≤ opt(j+1)`.
- `[P]` — the Iverson bracket, `1` if predicate `P` holds, else `0`.

**Remark.** The crux of the topic is that, under a structural condition on `C` (the Monge / quadrangle inequality, Section 2), the sequence `opt(0), opt(1), …, opt(n)` is **non-decreasing** (Section 3). That single fact is what makes the `O(n log n)` divide-and-conquer fill correct (Section 4) and efficient (Section 5). Without it, the argmins can jump arbitrarily, no window-narrowing is valid, and the honest bound reverts to the naive `O(n²)` per layer — there is no speedup to be had, and applying the recursion anyway yields a silently incorrect answer (the dominant real-world failure mode, treated in [`senior.md`](./senior.md)).

---

## 2. The Monge / Quadrangle Inequality

**Definition 2.1 (Quadrangle Inequality, QI).** A function `C` on intervals satisfies the **quadrangle inequality** (equivalently, is **Monge**) if for all `a ≤ b ≤ c ≤ d`:

```
C(a, c) + C(b, d)  ≤  C(a, d) + C(b, c).            (QI)
```

The two terms on the left use "nested/inner" pairs `(a,c)` and `(b,d)`; the right uses "crossing/outer" pairs `(a,d)` and `(b,c)`. (The reverse inequality `≥` defines the **inverse Monge** / anti-Monge condition, relevant for `max` versions.)

**Definition 2.2 (Local form).** `C` satisfies the **local quadrangle inequality** if for all `a < c`:

```
C(a, c) + C(a+1, c+1)  ≤  C(a, c+1) + C(a+1, c).   (LQI)
```

**Lemma 2.3 (LQI ⟺ QI).** For functions defined on all relevant integer intervals, the local form (LQI) holds for all `a < c` **iff** the global form (QI) holds for all `a ≤ b ≤ c ≤ d`.

**Proof.** (QI ⟹ LQI) is immediate by taking `b = a+1`, `d = c+1`. For (LQI ⟹ QI), fix `a ≤ b ≤ c ≤ d`. We show `C(a,c) + C(b,d) ≤ C(a,d) + C(b,c)` by summing local inequalities. First, telescoping in the second coordinate: applying LQI repeatedly gives, for fixed left endpoints `a < a' `, the "monotone difference" statement that `C(a, y) − C(a', y)` is non-increasing in `y` whenever `a < a' ≤ y`. Concretely, LQI says `C(a, y) − C(a+1, y) ≥ C(a, y+1) − C(a+1, y+1)`, i.e. the row-difference `Δ_y := C(a, y) − C(a+1, y)` is non-increasing in `y`. Summing such non-increasing differences over the row index from `a` to `b−1` and over the column index from `c` to `d−1` yields the rectangle inequality (QI). The standard "summation of local inequalities over a grid rectangle" argument (Yao 1980; Burkard-Klinz-Rudolf survey) makes this precise: any global QI rectangle decomposes into unit cells each governed by an LQI. ∎

**Interpretation.** QI is a discrete concavity/supermodularity-type condition. It is the combinatorial heart of Monge matrices, the assignment problem on Monge cost matrices, and the speedups of Yao, Knuth, and SMAWK.

**Proposition 2.4 (Convex-of-length costs are Monge).** If `C(k, j) = w(j − k)` for a **convex** function `w : ℤ_{≥0} → ℝ` (i.e. `w(x+1) − w(x)` is non-decreasing in `x`), then `C` satisfies QI.

**Proof.** Check the local form (LQI) `C(a, c) + C(a+1, c+1) ≤ C(a, c+1) + C(a+1, c)`. Substituting `C(k, j) = w(j − k)`:

```
w(c − a) + w(c+1 − a−1)  ≤  w(c+1 − a) + w(c − a−1)
⟺ w(c − a) + w(c − a)    ≤  w(c − a + 1) + w(c − a − 1).
```

Let `x = c − a`. The inequality is `2 w(x) ≤ w(x+1) + w(x−1)`, i.e. `w(x+1) − w(x) ≥ w(x) − w(x−1)` — exactly the discrete convexity of `w`. By Lemma 2.3, LQI gives QI. ∎

**Consequence.** Any cost depending only on segment *length* through a convex function is Monge: `w(x) = x²`, `w(x) = x log x`, `w(x) = x^{1.5}`, `w(x) = e^x`, etc. This is one of the most common ways a cost qualifies in practice (e.g. "the penalty grows convexly with how many items are lumped together"). Note this is *not* the same as the squared-segment-*sum* cost `(P[j] − P[k])²`, which depends on the segment's *content* (its sum), not just its length — that one is Monge by Proposition 8.2's expansion / Section 10's LQI factorization, a separate argument.

---

## 3. Monge Implies Monotone Argmin (Main Theorem)

This is the theorem that licenses the entire technique.

**Theorem 3.1.** If `C` satisfies the quadrangle inequality (Definition 2.1), then for every `j` with `opt(j)` and `opt(j+1)` both defined (finite),

```
opt(j)  ≤  opt(j+1).
```

That is, the optimal split point is non-decreasing in the column index.

**Proof.** Fix `j`. Let `p := opt(j)` be the smallest minimizer for column `j`. We must show that for column `j+1` no split point `k < p` can be strictly better than `p`; combined with the tie-break-to-smallest convention, this forces `opt(j+1) ≥ p`.

Take any `k` with `k < p`. We show `k` is no better than `p` at column `j+1`, i.e.

```
g(p) + C(p, j+1)  ≤  g(k) + C(k, j+1).            (★)
```

Apply QI with the ordering `a = k`, `b = p`, `c = j`, `d = j+1` (valid since `k < p ≤ j < j+1`, so `a ≤ b ≤ c ≤ d`):

```
C(k, j) + C(p, j+1)  ≤  C(k, j+1) + C(p, j).        (QI instance)
```

Rearrange:

```
C(p, j+1) − C(k, j+1)  ≤  C(p, j) − C(k, j).        (†)
```

Now use that `p = opt(j)` is at least as good as `k` at column `j` (since `p` is a minimizer there and `k` is some other candidate):

```
g(p) + C(p, j)  ≤  g(k) + C(k, j)
⟹  g(p) − g(k)  ≤  C(k, j) − C(p, j) = −( C(p, j) − C(k, j) ).   (‡)
```

Add (†) and (‡). From (‡), `g(p) − g(k) ≤ −(C(p,j) − C(k,j))`. From (†), `C(p,j+1) − C(k,j+1) ≤ C(p,j) − C(k,j)`. Hence

```
g(p) − g(k) + C(p, j+1) − C(k, j+1)
   ≤ −(C(p,j) − C(k,j)) + (C(p,j) − C(k,j)) = 0,
```

which is exactly (★): `g(p) + C(p, j+1) ≤ g(k) + C(k, j+1)`. So no `k < p` beats `p` at column `j+1`. Therefore the smallest minimizer at `j+1` satisfies `opt(j+1) ≥ p = opt(j)`. ∎

**Corollary 3.2 (Staircase of argmins).** Under QI, the sequence `opt(0) ≤ opt(1) ≤ … ≤ opt(n)` is non-decreasing. Equivalently, the cost matrix `M` (Definition 1.3) is **totally monotone** in the column-minimum sense (Section 6), so its column minima have non-decreasing row indices.

**Corollary 3.3 (Bounded total argmin movement).** Because `opt` is non-decreasing and bounded by `n`, the *total* movement `Σ_j ( opt(j+1) − opt(j) ) = opt(n) − opt(0) ≤ n`. This telescoping bound is the seed of the complexity argument: across the whole row, the argmin advances by at most `n` steps in total, which is why the summed scan work can be kept linear per recursion level (Section 5). It also gives an *alternative* `O(n)`-amortized "two-pointer" row fill for the special case where the columns are processed left-to-right and the argmin pointer only moves forward — but that simpler scheme works only when you fill columns *in order*, whereas the divide-and-conquer recursion visits the middle first; the two are different realizations of the same monotone-argmin structure.

**Remark (why "smallest minimizer").** The theorem proves `opt(j+1) ≥ opt(j)` for the *smallest* minimizers. If ties were broken upward, the argmin sequence could fail to be non-decreasing at tie points, which is precisely why the algorithm and theory both fix the convention `opt(j) = min A(j)`.

### 3.1 Worked Verification of Theorem 3.1

Take `a = [1, 3, 2, 4]`, prefix sums `P = [0, 1, 4, 6, 10]`, cost `C(k, j) = (P[j] − P[k])²`, and previous-layer values `g = dp[1][·] = [∞, 1, 16, 36, 100]` (the layer-1 row of the running example). We compute layer 2 and confirm the argmins are non-decreasing.

```
column j=2: candidates  k=1: g[1]+C(1,2)=1+(4-1)²=1+9 =10   ← opt(2)=1
                        k=0: g[0]=∞ (skip)
column j=3: candidates  k=1: 1+(6-1)²=1+25=26
                        k=2: 16+(6-4)²=16+4=20             ← opt(3)=2
column j=4: candidates  k=2: 16+(10-4)²=16+36=52           ← opt(4)=2 (tie at 52, smaller k)
                        k=3: 36+(10-6)²=36+16=52
```

The argmins `opt(2)=1 ≤ opt(3)=2 ≤ opt(4)=2` are non-decreasing, exactly as Theorem 3.1 guarantees. Now verify the QI instance used in the proof, for `(a,b,c,d) = (1, 2, 3, 4)`:

```
C(1,3) + C(2,4) = (6-1)² + (10-4)² = 25 + 36 = 61
C(1,4) + C(2,3) = (10-1)² + (6-4)² = 81 + 4  = 85
61 ≤ 85 ✓  (quadrangle inequality holds)
```

The inequality `C(1,3)+C(2,4) ≤ C(1,4)+C(2,3)` is precisely the (QI instance) line in the proof of Theorem 3.1 with `k=1, p=2, j=3, j+1=4`, and it is what forbids the optimum from jumping backward from column 3 to column 4.

### 3.2 A Non-Monge Counterexample

To see that the Monge condition is *necessary* for monotonicity (not just sufficient for our proof), consider a contrived cost `C'(k, j)` that violates QI. Suppose `g = [0, 0, 0, 0]` (flat predecessors) and `C'` is engineered so that `C'(0, 2) = 1, C'(1, 2) = 5` but `C'(0, 3) = 10, C'(1, 3) = 2`. Then:

```
opt(2): k=0 gives 1, k=1 gives 5  → opt(2) = 0
opt(3): k=0 gives 10, k=1 gives 2 → opt(3) = 1
```

Here `opt(2) = 0 ≤ opt(3) = 1` happens to hold, but flip the column-3 costs (`C'(0,3)=2, C'(1,3)=10`) and you get `opt(3) = 0 < ` nothing — more pointedly, with `C'(0,3)=2, C'(1,3)=10` and `C'(0,2)=10, C'(1,2)=1` you get `opt(2)=1, opt(3)=0`, a **decrease**. Check QI on `(0,1,2,3)`: `C'(0,2)+C'(1,3) = 10+10 = 20` versus `C'(0,3)+C'(1,2) = 2+1 = 3`; since `20 > 3`, QI **fails**, and indeed the argmin decreased. This is the mechanism by which a non-Monge cost breaks the staircase — and why the divide-and-conquer recursion would silently miss the true optimum on such a cost.

---

## 4. Correctness of the Divide-and-Conquer Recursion

**Algorithm (one layer).**
```
COMPUTE(l, r, optL, optR):                  # fills f over columns [l, r]
  if l > r: return
  mid := (l + r) / 2
  best := +∞ ; bestK := optL
  for k := optL to min(optR, mid-1):
      v := g(k) + C(k, mid)
      if v < best: best := v ; bestK := k    # strict <, smallest minimizer
  f(mid) := best
  COMPUTE(l, mid-1, optL, bestK)
  COMPUTE(mid+1, r, bestK, optR)
# top-level: COMPUTE(0, n, 0, n)
```

**Invariant 4.1.** Whenever `COMPUTE(l, r, optL, optR)` is called, every column `j ∈ [l, r]` has `optL ≤ opt(j) ≤ optR`.

**Theorem 4.2 (Correctness).** Under QI (so Theorem 3.1 holds), `COMPUTE(0, n, 0, n)` sets `f(j) = dp[i][j]` correctly for every `j ∈ [0, n]`.

**Proof (induction on the size `r − l + 1` of the column range, assuming Invariant 4.1).**

*Base case `l > r`*: nothing to fill; vacuously correct.

*Inductive step*: assume Invariant 4.1 holds at entry, i.e. `opt(j) ∈ [optL, optR]` for all `j ∈ [l, r]`. Consider `mid`. By the invariant, `opt(mid) ∈ [optL, optR]`, and since the last segment must be non-empty, `opt(mid) ≤ mid − 1`; hence `opt(mid) ∈ [optL, min(optR, mid−1)]`, which is exactly the range the loop scans. The loop therefore examines every candidate that could be the true minimizer, so it computes `f(mid) = min_{k<mid} (g(k) + C(k, mid))` correctly and sets `bestK = opt(mid)` (smallest minimizer, by the strict `<`).

It remains to show the two recursive calls preserve Invariant 4.1 for their ranges:

- **Left call `COMPUTE(l, mid-1, optL, bestK)`.** For any `j ∈ [l, mid-1]`, monotonicity (Theorem 3.1) gives `opt(j) ≤ opt(mid) = bestK`, and the entry invariant gives `opt(j) ≥ optL`. So `opt(j) ∈ [optL, bestK]`. ✓
- **Right call `COMPUTE(mid+1, r, bestK, optR)`.** For any `j ∈ [mid+1, r]`, monotonicity gives `opt(j) ≥ opt(mid) = bestK`, and the entry invariant gives `opt(j) ≤ optR`. So `opt(j) ∈ [bestK, optR]`. ✓

Both recursive calls have strictly smaller column ranges and satisfy Invariant 4.1, so by the inductive hypothesis they fill their columns correctly. Hence all of `[l, r]` is filled correctly. The top-level call `COMPUTE(0, n, 0, n)` trivially satisfies Invariant 4.1 (`opt(j) ∈ [0, n]` always), completing the proof. ∎

**Remark (why the windows may overlap at `bestK`).** The left window's upper bound and the right window's lower bound are both `bestK`. This single shared endpoint is harmless: column `mid` itself is already resolved, and any column in a half whose true optimum equals `bestK` is still covered. The overlap is exactly one index, which is what keeps the per-level work linear (Section 5).

---

## 5. Complexity: O(n log n) per Layer

**Theorem 5.1.** `COMPUTE(0, n, 0, n)` performs `O(n log n)` cost evaluations (and `O(n)` recursive calls), assuming each `C(k, j)` is evaluated in `O(1)`. Hence one layer costs `O(n log n)` and the full `K`-layer DP costs `O(K n log n)` time and `O(n)` space (rolling two rows; `O(Kn)` if storing all `opt` for reconstruction).

**Proof.** Model the recursion as a binary tree. The root handles columns `[0, n]` with window `[0, n]`. Group the recursive calls by **depth** `d` (root at depth 0). At each depth, the calls partition the columns `[0, n]` into disjoint contiguous blocks (each call's column range `[l, r]`), because a parent splits `[l, r]` into `[l, mid-1]` and `[mid+1, r]`, dropping `mid`. So the *number of columns* across all calls at one depth is `≤ n+1`, and the *number of calls* at one depth is `≤ 2^d`, bounded also by `n+1`.

Now bound the scanning work. A call with window `[optL, optR]` scans `≤ optR − optL + 1` candidates. The key claim is that **the sum of window lengths over all calls at a fixed depth is `O(n)`.** Consider the two children of a call with window `[optL, optR]` and chosen `bestK`: the left child has window `[optL, bestK]` (length `bestK − optL + 1`) and the right child `[bestK, optR]` (length `optR − bestK + 1`). Their total length is `(bestK − optL + 1) + (optR − bestK + 1) = (optR − optL + 1) + 1`. So passing from a parent to its two children, the summed window length increases by exactly `1` per split (the shared endpoint `bestK` is double-counted once). At depth `d` there are at most `n` splits total above it, so the summed window length at any depth is `(n+1) + O(n) = O(n)`. Each unit of window length is one `O(1)` cost evaluation.

The depth of the recursion is `O(log n)` because each call halves its column range (`mid` splits `[l, r]` into two halves of size `≤ ⌈(r-l)/2⌉`). Summing `O(n)` work over `O(log n)` depths gives `O(n log n)` cost evaluations. The number of calls is `O(n)` (a binary tree over `n+1` columns has `O(n)` nodes). ∎

**Corollary 5.2.** With a cost evaluable in `O(c)` rather than `O(1)`, one layer is `O(c · n log n)`. For the technique to beat the naive `O(c · n²)`, one needs `c · n log n < c · n²`, i.e. essentially always for large `n` — but the `c` factor still matters when comparing to a SMAWK `O(c · n)` alternative (Section 6).

**Corollary 5.3 (Call-count bound).** The number of `COMPUTE` invocations is exactly `2n + 1` for a row of `n+1` columns (each non-empty range produces one node plus two children, and the recursion tree over `n+1` leaves has `≤ 2(n+1) − 1` nodes). Function-call overhead is therefore `Θ(n)`, dominated by the `Θ(n log n)` cost evaluations — confirming that the recursion's structural overhead is asymptotically negligible against the arithmetic, which is why a straightforward recursive implementation is competitive with hand-tuned iterative variants for `O(1)` costs.

**Remark (comparison to the matrix view).** Theorem 5.1 says finding all column minima of a totally monotone `(n+1) × (n+1)` matrix takes `O(n log n)` by divide-and-conquer. SMAWK (Section 6) improves this to `O(n)` for fully totally-monotone matrices, at the cost of a more intricate algorithm; the `log n` is the price of the simpler recursion.

### 5.1 The Per-Level Window-Length Accounting, Spelled Out

The crux of Theorem 5.1 is that the *summed window length* at each recursion level is `O(n)`. Here is the accounting on a concrete `n = 7` example. The call tree (using the trace from `middle.md`) is:

```
depth 0:  compute(1,7, 0,7)              window [0, 3]  length 4   (mid=4, hi=min(7,3)=3)
depth 1:  compute(1,3, 0,2)              window [0, 1]  length 2   (mid=2, hi=min(2,1)=1)
          compute(5,7, 2,7)              window [2, 5]  length 4   (mid=6, hi=min(7,5)=5)
depth 2:  compute(1,1, 0,1)              window [0, 0]  length 1   (mid=1, hi=min(1,0)=0)
          compute(3,3, 1,2)              window [1, 2]  length 2   (mid=3, hi=min(2,2)=2)
          compute(5,5, 2,4)              window [2, 4]  length 3   (mid=5, hi=min(4,4)=4)
          compute(7,7, 4,7)              window [4, 6]  length 3   (mid=7, hi=min(7,6)=6)
```

Summed window lengths by depth: depth 0 = `4`, depth 1 = `2 + 4 = 6`, depth 2 = `1 + 2 + 3 + 3 = 9`. Each is `O(n)` (here `≤ ~9` for `n = 7`); none approaches the naive `1+2+…+7 = 28`. The total across all depths is `4 + 6 + 9 = 19` cost checks versus the naive `28`, and the gap widens to `Θ(n log n)` vs `Θ(n²)` as `n` grows. The reason a depth's sum cannot exceed `O(n)` is the overlap argument: passing from a parent window of length `L` to its two children produces windows of total length `L + 1`, and there are at most `n` splits above any depth, so the sum stays `(n+1) + O(n)`.

### 5.2 Why Depth Is O(log n) Even with Skewed Windows

A subtlety: the *column* range halves each call (`mid` splits `[l, r]` into two near-equal halves), but the *window* range `[optL, optR]` need not halve. Could the recursion be deep because windows are skewed? No: depth is governed by the *column* range, not the window. Since `mid = (l + r) / 2` bisects the columns, after `d` levels the column range has size `≤ (r − l + 1) / 2^d`, hitting size `1` after `O(log n)` levels regardless of how the windows are distributed. The window skew affects *per-call work*, which the Section 5.1 accounting already bounds; it does not affect *depth*.

---

## 6. Total-Monotonicity and the SMAWK Connection

**Definition 6.1 (Totally monotone matrix).** An `m × n` matrix `M` is **totally monotone** (for column minima) if for every `2 × 2` submatrix on rows `r₁ < r₂` and columns `c₁ < c₂`,

```
M[r₁][c₁] ≥ M[r₂][c₁]  ⟹  M[r₁][c₂] ≥ M[r₂][c₂].
```

Equivalently, if the lower row wins (or ties) in the left column, it also wins in the right column. This is precisely the condition that the column-minimum row indices are non-decreasing.

**Proposition 6.2 (QI ⟹ total monotonicity).** The cost matrix `M[k][j] = g(k) + C(k, j)` (with `+∞` for `k ≥ j`) is totally monotone whenever `C` satisfies QI.

**Proof.** Total monotonicity for column minima is implied by the **Monge condition** `M[r₁][c₁] + M[r₂][c₂] ≤ M[r₁][c₂] + M[r₂][c₁]` for `r₁ < r₂`, `c₁ < c₂`. Substituting `M[k][j] = g(k) + C(k, j)`, the `g` terms cancel (`g(r₁) + g(r₂)` appears on both sides), leaving exactly the QI inequality `C(r₁, c₁) + C(r₂, c₂) ≤ C(r₁, c₂) + C(r₂, c₁)` — which is QI with `a=r₁, b=r₂, c=c₁, d=c₂` (after matching the index roles). A Monge matrix is totally monotone, and total monotonicity gives non-decreasing column-minimum indices. ∎

**Definition 6.3 (SMAWK).** SMAWK (Aggarwal, Klawe, Moran, Shor, Wilber, 1987) finds all column minima (or row maxima) of a **totally monotone** `m × n` matrix in `O(m + n)` time, given `O(1)` access to any entry. It works by alternating **REDUCE** (discard rows that can never be a column minimum, using total monotonicity, leaving `≤ n` relevant rows) and **INTERPOLATE** (recurse on even columns, then fill odd columns by scanning between known neighbors).

**Theorem 6.4 (Linear-time per layer via SMAWK).** If `M[k][j] = g(k) + C(k, j)` is totally monotone and entries are `O(1)`, all column minima — hence one DP layer — can be computed in `O(n)` time by SMAWK, improving the `O(n log n)` divide-and-conquer of Section 5.

**Trade-off.** SMAWK is asymptotically better (`O(Kn)` vs `O(Kn log n)`) but materially more complex to implement and to make handle the `k < j` "staircase" restriction (the matrix is not a full rectangle). The divide-and-conquer recursion is the pragmatic default; SMAWK is the choice when the `log n` factor is decisive or `n` is enormous. The restriction `k < j` is handled in divide-and-conquer trivially (clamp `hi = min(optR, mid-1)`); in SMAWK it requires treating the matrix as "staircase" or padding with `+∞`, which is the main implementation subtlety.

### 6.1 SMAWK in More Detail

SMAWK operates on an implicit `m × n` totally monotone matrix (entries computed on demand). It computes the row indices of all column minima in `O(m + n)`.

- **REDUCE(rows, cols).** Many rows can be eliminated as never-minimal. Using total monotonicity, scan with a stack: a row that loses to a later row in some column can never be a minimum in any column to the right, so discard it. REDUCE returns `≤ |cols|` surviving rows in `O(m)` time.
- **INTERPOLATE.** Recurse on the *even-indexed* columns only (halving the column count), obtaining their minima. Then each *odd* column's minimum lies between the minima of its two even neighbors (by total monotonicity), so it is found by a bounded local scan. The total odd-column work telescopes to `O(n)`.

The recurrence `T(m, n) = T(n/2, n/2) + O(m + n)` solves to `O(m + n)`. For our DP, `m = n = the column count`, giving `O(n)` per layer. The catch is correctness of REDUCE/INTERPOLATE under the **staircase** constraint `k < j`: entries with `k ≥ j` are `+∞`, which preserves total monotonicity (an `+∞` row never wins), so padding is valid — but careless indexing here is the dominant source of SMAWK bugs, which is why the simpler `O(n log n)` recursion is the common production choice.

### 6.2 The Monge-Matrix Lineage

The same total-monotonicity property underlies a family of classical results, all reachable from Proposition 6.2:

- **Optimal binary search trees** (Knuth 1971) — the precursor; a two-dimensional Monge speedup.
- **The assignment problem on Monge cost matrices** — solvable in `O(n)` rather than `O(n³)` because the optimal assignment is the identity-like "non-crossing" matching.
- **All-pairs shortest paths on Monge graphs** — Monge weight structure permits subcubic APSP.
- **The concave/convex least-weight subsequence problem** (Hirschberg-Larmore, Wilber) — `O(n)` and `O(n log n)` variants.

Recognizing a cost as Monge therefore unlocks an entire toolbox, not just the single divide-and-conquer recursion of this topic.

---

## 7. Relationship to Knuth Optimization

**Knuth's setting.** Knuth optimization (sibling `12`) speeds up the **interval DP**

```
dp[i][j] = min over i < k < j of ( dp[i][k] + dp[k][j] ) + C(i, j),
```

where `C` satisfies **both** the quadrangle inequality **and** monotonicity on intervals (`C(b, c) ≤ C(a, d)` for `a ≤ b ≤ c ≤ d`). Under these, the argmin satisfies a **two-sided** bound:

```
opt(i, j-1)  ≤  opt(i, j)  ≤  opt(i+1, j).
```

**Theorem 7.1 (Knuth complexity).** Filling the interval DP in order of increasing interval length `j − i`, scanning only `k ∈ [opt(i, j-1), opt(i+1, j)]`, costs `O(n²)` total (down from the naive `O(n³)`).

**Proof sketch.** For fixed interval length `ℓ`, the scanned ranges `[opt(i, i+ℓ-1), opt(i+1, i+ℓ)]` telescope: their lengths sum to `O(n)` because consecutive ranges share endpoints (the right bound of one is `opt(i+1, j)` and the left bound of the next is `opt(i+1, j)`-adjacent). Summing `O(n)` over `n` lengths gives `O(n²)`. ∎

**Contrast with divide-and-conquer (this topic).**

| Aspect | Divide & Conquer (this) | Knuth (topic 12) |
|--------|-------------------------|------------------|
| Recurrence | layered `g(k) + C(k, j)` | interval `dp[i][k] + dp[k][j] + C(i, j)` |
| Argmin bound | one-sided `opt(j) ≤ opt(j+1)` | two-sided `opt(i,j-1) ≤ opt(i,j) ≤ opt(i+1,j)` |
| Required on `C` | QI only | QI **and** interval-monotonicity |
| Fill order | divide-and-conquer over columns | increasing interval length |
| Per-layer / total | `O(n log n)` / `O(K n log n)` | — / `O(n²)` |

The shared mathematical core is QI; the difference is the recurrence shape (which determines whether one-sided or two-sided bounds are available) and the resulting fill strategy. A layered DP cannot in general use Knuth's two-sided bound (there is no `dp[i+1][j]` of the same DP to bound against), and an interval DP does not fit the column-minimum matrix structure that divide-and-conquer exploits.

---

## 8. Relationship to the Convex Hull Trick

**CHT setting.** The Convex Hull Trick (sibling `10`) applies when the transition has the linear form

```
dp[j] = min over k of ( dp[k] + a[k] · x[j] + b[k] ),
```

i.e. each predecessor `k` contributes a **line** `y = a[k] · X + (dp[k] + b[k])` and the query is its value at `X = x[j]`. The minimum over lines at a query point is read off the **lower envelope** (convex hull) of the lines.

**Theorem 8.1 (CHT complexity).** With lines inserted in order of slope and queries `x[j]` monotone, the lower envelope is maintained with a monotone stack/deque in amortized `O(1)` per operation, giving `O(n)` total; with arbitrary order/queries, `O(n log n)` via Li Chao tree or binary search on the hull.

**When the costs coincide.** If a Monge cost `C(k, j)` *happens* to be linear in a query value `x[j]` — i.e. `C(k, j) = a[k] · x[j] + b[k]` — then both CHT and divide-and-conquer apply, and CHT is usually preferable (it can reach `O(n)` and supports online insertion). But CHT requires the **linear** structure; a general Monge cost (e.g. `(P[j] − P[k])²` expanded is `P[j]² − 2 P[j] P[k] + P[k]²` — note `P[j]²` is constant across `k` and `−2 P[k] · P[j] + (P[k]² + g(k))` *is* linear in `P[j]`!). Indeed, the squared-segment-sum cost is the textbook example where CHT and divide-and-conquer both apply.

**Proposition 8.2 (Squared cost is the CHT/D&C overlap).** For `C(k, j) = (P[j] − P[k])²`,

```
g(k) + C(k, j) = (g(k) + P[k]²) + (−2 P[k]) · P[j] + P[j]².
```

The `P[j]²` term is independent of `k` (drop it from the `min`), leaving a line in the query `P[j]` with slope `−2 P[k]` and intercept `g(k) + P[k]²`. Hence CHT applies. Simultaneously, `(P[j]−P[k])²` satisfies QI, so divide-and-conquer applies. The choice between them is engineering, not feasibility.

**When CHT does *not* generalize.** The line decomposition relied on the squared form expanding into `slope · P[j] + intercept`. A general Monge cost has no such linear decomposition. For instance, `C(k, j) = w(P[j] − P[k])` for a convex `w` that is *not* a quadratic (say `w(x) = x log x`, or `w(x) = x^{1.5}`) is still Monge (convex-of-length costs satisfy QI), so divide-and-conquer applies, but it does **not** factor into lines, so CHT does not apply. This is the precise sense in which divide-and-conquer is strictly more general: it covers all convex-of-length (and more broadly all Monge) costs, while CHT covers only the linear/quadratic-decomposable subset. The set inclusion is `{CHT-applicable layered costs} ⊊ {Monge layered costs}`, and the squared cost sits in the intersection — which is why it serves as the canonical example for both techniques.

**A subtlety: Li Chao tree vs monotone hull.** Even within CHT-applicable costs, the right CHT variant depends on whether slopes and queries are monotone. For the squared cost, `slope = −2 P[k]` is monotone (decreasing) in `k`, and queries `P[j]` are monotone (increasing) in `j` for non-negative arrays, so the cheap monotone-deque hull gives `O(n)` per layer. If either monotonicity fails (e.g. negative array entries make `P` non-monotone), you fall back to a Li Chao tree or binary search on the hull, `O(n log n)` — at which point CHT no longer beats divide-and-conquer asymptotically, and the simpler-to-reason-about divide-and-conquer (whose correctness rests only on QI, robust to the sign of entries *as long as QI still holds*) may be preferable. Note, however, that negative entries can break *both* the CHT monotonicity *and* the QI of the squared cost (Section 10 caveat), so on signed inputs neither tool is automatic — the applicability analysis must be redone.

**Summary.** CHT exploits *linearity*; divide-and-conquer exploits *Monge monotonicity*. Linearity is a special case that often (not always) implies Monge; Monge is more general but yields only `O(n log n)` per layer rather than CHT's potential `O(n)`.

---

## 9. The 1-D k-Means / Clustering Instance

A canonical real application: partition `n` sorted points `x_1 ≤ … ≤ x_n` into `K` contiguous clusters minimizing total within-cluster sum of squared distances to the cluster mean.

**Definition 9.1 (SSE cost).** For a cluster spanning `[k, j)` with mean `μ`,

```
C(k, j) = Σ_{t=k}^{j-1} (x_t − μ)²  = ( Σ x_t² ) − ( Σ x_t )² / (j − k),
```

computable in `O(1)` from prefix sums of `x` and `x²`.

**Theorem 9.2 (SSE is Monge).** The cluster-SSE cost `C` satisfies the quadrangle inequality. Hence 1-D k-means is exactly the layered DP of this topic, solvable in `O(K n log n)` (or `O(K n)` with SMAWK) — this is the basis of the optimal `Ckmeans.1d.dp` algorithm (Wang-Song 2011).

**Proof sketch.** One shows the local form (LQI) `C(a, c) + C(a+1, c+1) ≤ C(a, c+1) + C(a+1, c)` by direct expansion of the SSE closed form; the inequality reduces to a statement about how variance changes when an interval is extended, which holds because adding a point to a sorted interval increases SSE by a non-decreasing amount as the interval grows (a convexity property of squared deviations on sorted data). By Lemma 2.3, LQI gives the full QI. ∎

**Significance.** This turns an NP-hard problem in general dimension into a polynomial, *optimal* algorithm in one dimension, precisely because the SSE cost on sorted data is Monge. It is the headline practical payoff of divide-and-conquer DP optimization.

### 9.1 Why Sorting Is Required

The Monge property of cluster-SSE holds only when the points are **sorted** and clusters are **contiguous**. The proof of Theorem 9.2 uses that extending an interval `[k, j)` to `[k, j+1)` on sorted data adds a point that is `≥` all current points, so the increase in SSE is monotone in the interval's position. On unsorted data, contiguity in index does not correspond to contiguity in value, the cost is no longer Monge, and the optimal 1-D k-means is *not* obtained by a contiguous partition — in fact the unconstrained problem becomes the general (harder) clustering. Sorting (in `O(n log n)`) is therefore a precondition, and it is cheaper than the DP itself, so it does not change the overall complexity.

### 9.2 Choosing K and the Penalized Variant

In practice one rarely knows `K` a priori. Two standard extensions stay within the Monge-DP framework:

- **Sweep all `K`.** Compute `dp[i][n]` for all `i = 1, …, K_max` in one `O(K_max · n log n)` run (the layer loop already produces every row). Then pick `K` by an elbow heuristic or an information criterion (BIC/AIC), each a cheap post-processing of the `dp[·][n]` curve.
- **Penalized objective.** Replace "exactly `K` clusters" with "minimize total SSE `+ β · (number of clusters)`" for a penalty `β`. This drops the layer index entirely: `dp[j] = min_{k<j} ( dp[k] + SSE(k, j) + β )`, a single-row DP that is *still* a Monge transition (the constant `+β` does not affect QI), solvable by one divide-and-conquer pass in `O(n log n)`. The penalty `β` then trades off fit against cluster count, the SSE analogue of model selection.

Both variants preserve the Monge structure, so the same machinery — and the same correctness proof — applies verbatim.

---

## 10. Verifying the Quadrangle Inequality

**Method 1 — Algebraic (LQI).** Prove the single local inequality `C(a, c) + C(a+1, c+1) ≤ C(a, c+1) + C(a+1, c)` from the closed form. By Lemma 2.3 this suffices. This is the cleanest proof and the one to attempt first.

**Method 2 — Structural.** Several closed structural facts give QI for free:
- If `C(k, j) = w(j − k)` for a **convex** `w`, then `C` is Monge. (Costs that depend only on segment *length* through a convex function.)
- Sums `C(k, j) = Σ_{k ≤ s < t < j} d(s, t)` of a non-negative "interaction" `d` are Monge.
- `C(k, j) = (P[j] − P[k])²` and cluster-SSE are Monge (Sections 8–9).

**Method 3 — Empirical (testing, not proof).** Enumerate small instances, build the brute-force `opt` table, and assert `opt(j) ≤ opt(j+1)`. This *refutes* non-Monge costs cheaply but never *proves* QI. It is mandatory in a test suite but insufficient as a correctness argument (Section 3 of [`senior.md`](./senior.md)).

**Proposition 10.1 (Anti-Monge for max).** For *maximization* DPs `dp[i][j] = max_k ( g(k) + C(k, j) )`, the relevant condition is the **inverse** quadrangle inequality `C(a,c) + C(b,d) ≥ C(a,d) + C(b,c)`, which yields a non-decreasing argmax and the same divide-and-conquer fill with `max` in place of `min`. The proof mirrors Theorem 3.1 with inequalities reversed.

**Worked LQI proof for the squared cost.** We verify the local quadrangle inequality for `C(k, j) = (P[j] − P[k])²` where `P` is non-decreasing (non-negative entries). LQI requires, for `a < c`:

```
C(a, c) + C(a+1, c+1) ≤ C(a, c+1) + C(a+1, c).
```

Write `u = P[a], u' = P[a+1], v = P[c], v' = P[c+1]`, with `u ≤ u'` and `v ≤ v'` (and `u' ≤ v` since `a+1 ≤ c`). The inequality becomes:

```
(v − u)² + (v' − u')² ≤ (v' − u)² + (v − u')².
```

Expand both sides; the squared terms `u², u'², v², v'²` appear equally on both sides and cancel, leaving the cross terms:

```
−2uv − 2u'v' ≤ −2uv' − 2u'v
⟺ uv + u'v' ≥ uv' + u'v
⟺ (u' − u)(v' − v) ≥ 0.
```

Since `u' − u = P[a+1] − P[a] = a[a] ≥ 0` and `v' − v = P[c+1] − P[c] = a[c] ≥ 0` (non-negative array entries), the product is `≥ 0`. Hence LQI holds, so by Lemma 2.3 the full quadrangle inequality holds, so by Theorem 3.1 `opt` is monotone and divide-and-conquer is correct. This is the cleanest possible applicability proof — a one-line factorization to `(u'−u)(v'−v) ≥ 0`.

**Caveat for negative entries.** The proof used `a[a] ≥ 0` and `a[c] ≥ 0`. If the array has negative entries, `P` is no longer monotone, the differences can be negative, and the product `(u'−u)(v'−v)` can be negative — LQI may fail. This is exactly the edge case Section 3 of [`senior.md`](./senior.md) warns about: a cost that is Monge on non-negative inputs may not be on signed inputs, so the empirical monotonicity check must include negative-value fuzzing.

---

## 11. Lower Bounds and When O(n) Is Possible

**Information-theoretic floor.** Reading the input (`g(·)` of size `n+1` plus enough of `C` to determine the answer) is `Ω(n)` per layer, so no per-layer algorithm beats `Ω(n)`. SMAWK (Section 6) achieves this `O(n)` floor for totally monotone matrices, so the divide-and-conquer `O(n log n)` is a `log n` factor above optimal.

**Theorem 11.1 (SMAWK optimality).** For a totally monotone `(n+1) × (n+1)` matrix with `O(1)` entry access, SMAWK finds all column minima in `O(n)` time, which is asymptotically optimal (matches the `Ω(n)` read lower bound). Divide-and-conquer's `O(n log n)` is therefore not asymptotically optimal but is simpler and often faster in practice for moderate `n` due to lower constants and better cache behavior.

**When `O(n log n)` is the practical choice.** The `log n` factor is at most ~20 for `n = 10^6`. Against SMAWK's intricate REDUCE/INTERPOLATE bookkeeping and its awkwardness with the `k < j` staircase restriction, the simpler recursion frequently wins on real inputs. The asymptotic gain of SMAWK matters at the largest scales or when `K` is also large (so the `log n` multiplies through `K` layers).

**Total DP lower bound.** With `K` layers, the output has `Θ(Kn)` cells, so the full DP is `Ω(Kn)`; SMAWK achieves `O(Kn)`, divide-and-conquer `O(Kn log n)`. Neither can do better than `Ω(Kn)` because every cell may be needed.

### 11.1 The "monotone but not totally monotone" gap

There is a strictly weaker condition than total monotonicity called **monotonicity** of a matrix: the column-minimum row indices are non-decreasing, but *without* the closed `2 × 2` implication of Definition 6.1. Divide-and-conquer optimization needs only this weaker monotonicity (it never relies on the `2 × 2` closure — only on `opt(j) ≤ opt(j+1)`). SMAWK, by contrast, requires the stronger *total* monotonicity for its REDUCE step to be valid. Consequence:

- If your cost gives a **monotone** but not totally monotone matrix, divide-and-conquer still works (`O(n log n)`), but SMAWK may not.
- The quadrangle inequality is sufficient for the stronger total monotonicity (Proposition 6.2), so when you have a Monge cost both algorithms apply.

In practice almost every natural cost that yields monotone `opt` is Monge (hence totally monotone), so the gap rarely matters — but it explains *why* divide-and-conquer is the more robust default: it asks for less.

### 11.2 Per-Layer vs Whole-Problem Optimality

It is worth separating two optimality questions:

- **Per layer:** finding all column minima of one matrix. Lower bound `Ω(n)` (read the input); SMAWK matches it, divide-and-conquer is `O(n log n)`.
- **Whole problem:** the `K`-layer DP. Lower bound `Ω(Kn)` (write every cell); SMAWK matches it at `O(Kn)`, divide-and-conquer is `O(Kn log n)`.

A frequent confusion is to call divide-and-conquer "optimal" — it is optimal *among simple recursions* and within a `log n` factor of the information-theoretic floor, but SMAWK is the truly optimal algorithm. For the overwhelming majority of contest and production inputs (`n ≤ 10^6`, `log n ≤ 20`), the `log n` gap is dwarfed by constant factors and implementation risk, which is the honest reason divide-and-conquer dominates real usage despite not being asymptotically optimal.

### 11.3 Interaction with the Cost-Evaluation Factor

When `C` costs `O(c)` per evaluation, the bounds become `O(c · n log n)` (divide-and-conquer) and `O(c · n)` (SMAWK) per layer. The `c` factor *multiplies* the gap, so for expensive costs SMAWK's advantage grows: it does `O(n)` evaluations versus `O(n log n)`, saving `c · n · (log n − 1)` evaluations per layer. This is the regime where investing in a SMAWK implementation pays off most — an expensive cost combined with large `n` and many layers. Conversely, with an `O(1)` prefix-sum cost, the evaluations are so cheap that the `log n` factor is nearly free and divide-and-conquer's simplicity wins.

---

## 12. Summary

- **Setup.** A layered DP `dp[i][j] = min_{k<j} ( dp[i-1][k] + C(k, j) )` is equivalent to finding all column minima of the matrix `M[k][j] = dp[i-1][k] + C(k, j)`.
- **Quadrangle / Monge inequality.** `C(a,c) + C(b,d) ≤ C(a,d) + C(b,c)` for `a ≤ b ≤ c ≤ d` (Definition 2.1); equivalent to the checkable local form (Lemma 2.3).
- **Main theorem.** QI ⟹ the optimal split `opt(j)` is non-decreasing in `j` (Theorem 3.1), proved by one QI instance plus the column-`j` optimality of `opt(j)`.
- **Correctness.** The `COMPUTE(l, r, optL, optR)` recursion is correct by induction on the column range, with the invariant `opt(j) ∈ [optL, optR]` preserved across the left/right calls via monotonicity (Theorem 4.2).
- **Complexity.** `O(n log n)` cost evaluations per layer — `O(n)` summed window length per recursion depth (the windows overlap at exactly one index per split) times `O(log n)` depths — hence `O(K n log n)` total, `O(n)` space with rolled rows (Theorem 5.1).
- **Total monotonicity / SMAWK.** QI makes `M` totally monotone (Proposition 6.2); SMAWK finds all column minima in `O(n)` (Theorem 6.4), so divide-and-conquer's `O(n log n)` is a `log n` factor above the optimal `O(n)` (Theorem 11.1).
- **Knuth (topic 12).** Different recurrence (interval `dp[i][k]+dp[k][j]`), two-sided argmin bound, requires QI *and* interval-monotonicity, gives `O(n²)` (Section 7).
- **CHT (topic 10).** Different structure (linear cost / lower envelope of lines); the squared-segment-sum cost is the overlap where both CHT and divide-and-conquer apply (Section 8).
- **k-means (Section 9).** Cluster-SSE on sorted points is Monge, making optimal 1-D k-means an instance of this DP — the headline application.

### Complexity Cheat Table

| Task | Condition | Complexity | Tight? |
|------|-----------|-----------|--------|
| One layer, divide & conquer | QI on `C` | `O(n log n)` | `log n` above optimal |
| One layer, SMAWK | total monotonicity | `O(n)` | optimal (`Ω(n)` read bound) |
| Full DP, `K` layers, D&C | QI on `C` | `O(K n log n)` | — |
| Full DP, `K` layers, SMAWK | total monotonicity | `O(K n)` | optimal (`Ω(Kn)`) |
| Knuth interval DP (topic 12) | QI + interval-monotone | `O(n²)` | from `O(n³)` |
| CHT (topic 10) | linear cost, monotone queries | `O(n)` | — |
| Naive layered fill | none | `O(K n²)` | baseline |

### Worked End-to-End: Squared-Cost Partition, Fully Justified

To tie the theory together, here is the complete chain of reasoning for the running example `dp[i][j] = min_{k<j} ( dp[i-1][k] + (P[j] − P[k])² )` on a non-negative array:

1. **Cost is Monge.** By the LQI factorization (Section 10), the local inequality reduces to `(P[a+1] − P[a])(P[c+1] − P[c]) ≥ 0`, true because array entries are non-negative. By Lemma 2.3, the full quadrangle inequality holds.
2. **Argmin is monotone.** By Theorem 3.1, QI implies `opt(i, j) ≤ opt(i, j+1)` for every layer `i`. The matrix `M[k][j] = dp[i-1][k] + (P[j] − P[k])²` is totally monotone (Proposition 6.2).
3. **The recursion is correct.** By Theorem 4.2, `COMPUTE(0, n, 0, n)` with the invariant `opt(j) ∈ [optL, optR]` fills the row correctly, scanning `[optL, min(optR, mid-1)]` and recursing with `[optL, bestK]` / `[bestK, optR]`.
4. **The recursion is fast.** By Theorem 5.1, the summed window length per recursion depth is `O(n)` and there are `O(log n)` depths, so one row costs `O(n log n)` cost evaluations; with prefix sums each is `O(1)`. Over `K` layers: `O(K n log n)`.
5. **It can be made optimal.** Since `M` is totally monotone, SMAWK (Theorem 6.4) computes each row in `O(n)`, giving the asymptotically optimal `O(K n)` (matching the `Ω(K n)` write bound, Section 11).

Every step is a theorem from this document; nothing is assumed. This is the discipline a correctness argument should follow — and the empirical monotonicity assertion of [`senior.md`](./senior.md) is the runtime guard that catches a slip in step 1 (e.g. negative entries breaking the LQI factorization).

### Connection Back to the Memoryless Principle

The deep reason this DP family admits a speedup at all is the same memoryless structure that distinguishes tractable from intractable DPs throughout this chapter: the transition `dp[i][j]` depends on the previous layer through a *fixed* cost `C(k, j)` of the endpoints `k` and `j` only, with no dependence on the path that reached `k`. That endpoint-only structure is what makes the cost matrix `M` well-defined, and the Monge property of `C` is what makes that matrix totally monotone. Strip away the endpoint-only structure (e.g. a cost depending on the multiset of earlier choices) and the matrix view collapses — there is no single matrix whose column minima are the answers — and the speedup vanishes. The quadrangle inequality is thus best understood as a *second-order* regularity condition layered on top of the *first-order* memoryless condition: memorylessness gives you a matrix; Monge-ness gives that matrix a monotone staircase of minima.

### Closing Notes

- **The one theorem to internalize** is Theorem 3.1: the quadrangle inequality forces the argmin to move only rightward. Everything else — correctness, complexity, the SMAWK connection — follows from that staircase of optimal splits.
- **Total monotonicity** (Section 6) is the matrix-theoretic restatement; it links this DP technique to the broader Monge-matrix literature (assignment problem, all-pairs shortest paths on Monge graphs, the SMAWK searching algorithm).
- **The hardness boundary** is the Monge condition: with it, the problem collapses to near-linear column-minima search; without it, the argmin can jump arbitrarily and no such speedup exists — the naive `O(n²)` per layer is then the honest bound.

Foundational references: Yao, "Speed-up in dynamic programming" (1980) for the quadrangle-inequality speedup; Aggarwal-Klawe-Moran-Shor-Wilber, "Geometric applications of a matrix-searching algorithm" (1987) for SMAWK and total monotonicity; Knuth, "Optimum binary search trees" (1971) for the interval-DP precursor; Wang-Song (2011) for optimal 1-D k-means via Monge DP; Burkard-Klinz-Rudolf, "Perspectives of Monge properties in optimization" (1996) for the Monge-matrix theory; Hirschberg-Larmore (1987) and Wilber (1988) for concave/convex least-weight subsequence algorithms; Galil-Park (1992) for a survey of dynamic-programming speedups via the quadrangle inequality. Sibling topics: `10-convex-hull-trick` and `12-knuth-optimization`.

### One-Paragraph Recap

A layered partition DP `dp[i][j] = min_{k<j} ( dp[i-1][k] + C(k, j) )` is the problem of finding all column minima of the cost matrix `M[k][j] = dp[i-1][k] + C(k, j)`. The quadrangle (Monge) inequality on `C` — verifiable by the one-line local-form factorization — makes `M` totally monotone, which forces the optimal split `opt(i, j)` into a non-decreasing staircase (Theorem 3.1). That staircase is exactly what the `compute(l, r, optL, optR)` recursion exploits: resolve the middle column, then recurse on halves with windows narrowed by the middle's optimum. Correctness follows by induction on the column range (Theorem 4.2); the `O(n log n)` per layer follows because the per-depth window length is linear and the depth is logarithmic (Theorem 5.1). SMAWK reaches the optimal `O(n)` per layer but is more intricate; for the common `O(1)`-cost, moderate-`n` regime, the simpler `O(n log n)` recursion is the right default. The whole edifice rests on a single algebraic condition — the quadrangle inequality — and the single most important engineering rule is to *verify* it (proof or CI assertion) before trusting the result, because failure is silent.
