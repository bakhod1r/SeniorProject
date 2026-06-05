# Kadane's Algorithm / Maximum Subarray — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Kadane Recurrence and Optimal Substructure
3. Correctness Proof (Induction on the Endpoint)
4. The Prefix-Sum / Running-Minimum Equivalence
5. Complexity: O(n) Time and the Ω(n) Lower Bound
6. Maximum-Product Correctness (Sign Tracking)
7. Circular Maximum-Subarray Correctness
8. The 2D Reduction: Correctness of Kadane over Column Sums
9. Divide-and-Conquer Recurrence and the Segment Monoid
10. Bounded-Length Variants (At Most / At Least k)
11. Generalizations and the Empty-Subarray Algebra
11b. Tie-Breaking, Uniqueness, and Canonical Solutions
11c. Stability Under Perturbation and Robust Variants
11d. The DP Lattice: Where Maximum-Subarray Sits
12. Summary

---

## 1. Formal Definitions

Let `a = (a₀, a₁, …, a_{n-1})` be a finite sequence of real numbers (`n ≥ 1`).

**Definition 1.1 (Subarray).** A **subarray** is a contiguous block `a[l..r] = (a_l, a_{l+1}, …, a_r)` with `0 ≤ l ≤ r ≤ n−1`. Its **sum** is `S(l, r) = Σ_{m=l}^{r} a_m`. There are exactly `n(n+1)/2` non-empty subarrays.

**Definition 1.2 (Maximum-subarray problem).** Compute

```
OPT = max_{0 ≤ l ≤ r ≤ n-1} S(l, r),
```

the largest sum over all non-empty subarrays. (The empty subarray, sum `0`, is excluded in the classic problem; §11 treats the variant that includes it.)

**Definition 1.3 (Best-ending-here function).** For each endpoint `r`, define

```
f(r) = max_{0 ≤ l ≤ r} S(l, r),
```

the maximum sum over subarrays that **end at `r`**. Every non-empty subarray ends at exactly one index, so

```
OPT = max_{0 ≤ r ≤ n-1} f(r).                              (★)
```

**Definition 1.4 (Prefix sums).** `P₀ = 0` and `P_{r+1} = P_r + a_r`, so `P_k = Σ_{m=0}^{k-1} a_m` and `S(l, r) = P_{r+1} − P_l`.

**Remark.** Equation (★) is the entire reduction: one global maximization over `O(n²)` intervals becomes `n` local maximizations, each of which (Theorem 2.1) satisfies a constant-time recurrence. This is the optimal-substructure decomposition that makes Kadane's a dynamic program.

**Worked instantiation of the definitions.** For `a = (−2, 1, −3, 4, −1, 2, 1, −5, 4)`:

```
prefix sums P:
  P₀ =  0
  P₁ = -2
  P₂ = -1
  P₃ = -4
  P₄ =  0
  P₅ = -1
  P₆ =  1
  P₇ =  2
  P₈ = -3
  P₉ =  1

f(r) values (best subarray sum ending at r):
  f(0) = -2,  f(1) = 1,  f(2) = -2,  f(3) = 4,  f(4) = 3,
  f(5) =  5,  f(6) = 6,  f(7) = 1,   f(8) = 5

OPT = max_r f(r) = f(6) = 6.
By Theorem 4.1: OPT = max_r (P_{r+1} − min_{l ≤ r} P_l)
              = P₇ − min(P₀,…,P₃) = 2 − (−4) = 6,  at r = 6, l = 3.   ✓
```

The two computations — the additive `f`-recurrence and the prefix-minimum difference — agree at `OPT = 6` with the same witness `a[3..6]`, a concrete confirmation of the equivalence proved in §4.

---

## 2. The Kadane Recurrence and Optimal Substructure

**Theorem 2.1 (Recurrence for `f`).** For all `r ≥ 1`,

```
f(0) = a₀,
f(r) = max( a_r,  f(r-1) + a_r ).
```

**Proof.** A subarray ending at `r` is either the singleton `(a_r)` (when `l = r`) or has length `≥ 2`, in which case it is `a[l..r]` with `l ≤ r−1`. In the latter case `S(l, r) = S(l, r−1) + a_r`, and maximizing over `l ≤ r−1` gives `f(r−1) + a_r` (the `a_r` term is constant under the maximization, so it factors out of the `max`). Taking the better of the two cases:

```
f(r) = max( a_r,  max_{l ≤ r-1} S(l, r-1) + a_r ) = max( a_r,  f(r-1) + a_r ).
```

The base case `f(0) = a₀` holds because the only subarray ending at index `0` is `(a₀)`. ∎

**Corollary 2.2 (Restart criterion).** `f(r) = a_r` (a *restart*) iff `f(r−1) ≤ 0`; otherwise `f(r) = f(r−1) + a_r` (an *extension*). This is because `a_r > f(r−1) + a_r ⟺ 0 > f(r−1)`.

**Optimal-substructure statement.** The optimal subarray ending at `r` is built from the optimal subarray ending at `r−1` (when extending) — an optimal solution contains optimal solutions to subproblems. There are **no overlapping subproblems beyond the immediate predecessor**, which is why the DP collapses to `O(1)` state (we keep only `f(r−1)`), unlike DPs that need a full table. Kadane's is thus the minimal non-trivial dynamic program: one-dimensional, constant memory, single pass.

**Contrast with the naive global subproblem.** One might instead define `g(r)` = "the best subarray within `a[0..r]`" (anywhere, not necessarily ending at `r`). This *also* satisfies a recurrence, but a defective one: `g(r)` is *not* a clean function of `g(r−1)` alone, because the new element `a[r]` might extend a run that `g(r−1)` discarded. The fix is to carry *both* `g(r)` (= `bestSoFar`) and `f(r)` (= `bestEndingHere`); the latter is the "interface" through which `a[r]` attaches. This is the textbook lesson that the *right* subproblem (ending-here) is what yields clean optimal substructure — choosing the wrong subproblem (global-so-far alone) loses the Markov property and the `O(1)` collapse. The two-variable formulation is the minimal correct state.

---

## 3. Correctness Proof (Induction on the Endpoint)

**Theorem 3.1.** Kadane's algorithm, with `bestEndingHere` and `bestSoFar` initialized to `a₀` and the update

```
bestEndingHere ← max(a_r, bestEndingHere + a_r);   bestSoFar ← max(bestSoFar, bestEndingHere)
```

for `r = 1, …, n−1`, terminates with `bestSoFar = OPT`.

**Proof (induction on `r`).**

*Loop invariant.* After processing index `r`:
1. `bestEndingHere = f(r)`, and
2. `bestSoFar = max_{0 ≤ s ≤ r} f(s)`.

*Base (`r = 0`).* Initialization sets both to `a₀ = f(0)`. Invariant (1) and (2) hold.

*Step.* Assume the invariant after `r−1`. The update computes `bestEndingHere = max(a_r, f(r−1) + a_r) = f(r)` by Theorem 2.1, establishing (1). Then `bestSoFar = max( max_{s ≤ r-1} f(s),  f(r) ) = max_{s ≤ r} f(s)`, establishing (2).

*Termination.* After `r = n−1`, invariant (2) gives `bestSoFar = max_{0 ≤ s ≤ n-1} f(s) = OPT` by (★). ∎

**Why a negative prefix is provably discarded.** Suppose an optimal subarray `a[l*..r*]` has a proper prefix `a[l*..m]` with `S(l*, m) < 0` for some `m < r*`. Then `a[m+1..r*]` has strictly larger sum (`S(m+1, r*) = S(l*, r*) − S(l*, m) > S(l*, r*)`), contradicting optimality. Hence **no optimal subarray begins with a negative-sum prefix** — formally justifying the restart in Corollary 2.2. The greedy "drop the negative prefix" is therefore not a heuristic but a theorem.

**All-negative corollary.** If every `a_i < 0`, then for all `r`, `f(r−1) < 0`, so every step restarts: `f(r) = a_r`. Thus `OPT = max_r a_r`, the least-negative element. Initialization to `a₀` (not `0`) is what makes this fall out correctly.

**Invariant trace (verifying Theorem 3.1 step by step).** On `a = (−2, 1, −3, 4, −1, 2, 1, −5, 4)`, tracking the invariant `bestEndingHere = f(r)` and `bestSoFar = max_{s≤r} f(s)`:

```
r=0  init                          be = -2   best = -2
r=1  max(1, -2+1=-1)      = 1      be =  1   best =  1   (extend? no: restart, f(0)<0)
r=2  max(-3, 1+(-3)=-2)   = -2     be = -2   best =  1   (extend)
r=3  max(4, -2+4=2)       = 4      be =  4   best =  4   (restart, f(2)<0)
r=4  max(-1, 4+(-1)=3)    = 3      be =  3   best =  4   (extend)
r=5  max(2, 3+2=5)        = 5      be =  5   best =  5   (extend)
r=6  max(1, 5+1=6)        = 6      be =  6   best =  6   (extend) ← global max
r=7  max(-5, 6+(-5)=1)    = 1      be =  1   best =  6   (extend)
r=8  max(4, 1+4=5)        = 5      be =  5   best =  6   (extend)
```

At every row, `be` equals the independently computed `f(r)` from §1's worked instantiation, and `best` equals the running maximum of those — exactly invariants (1) and (2) of Theorem 3.1. The final `best = 6 = OPT`. The restarts at `r=1` and `r=3` are precisely the indices where the preceding `f` was non-positive (Corollary 2.2), and `r=3` is where the winning run `a[3..6]` begins.

---

## 4. The Prefix-Sum / Running-Minimum Equivalence

There is a second, equivalent derivation that some find more illuminating and that powers the bounded-length variants (§10).

**Theorem 4.1.** `OPT = max_{0 ≤ r ≤ n-1} ( P_{r+1} − min_{0 ≤ l ≤ r} P_l )`.

**Proof.** For a fixed endpoint `r`, `f(r) = max_{l ≤ r} S(l, r) = max_{l ≤ r} (P_{r+1} − P_l) = P_{r+1} − min_{l ≤ r} P_l`, since `P_{r+1}` is constant under the maximization and subtracting a smaller `P_l` yields a larger value. Taking the max over `r` and applying (★) gives the claim. ∎

**Algorithmic reading.** Sweep `r` from `0` to `n−1`, maintaining `m_r = min_{0 ≤ l ≤ r} P_l` incrementally (`m_r = min(m_{r-1}, P_r)`). At each `r`, `f(r) = P_{r+1} − m_r`. This is `O(n)` time, `O(1)` space — *exactly Kadane's*, in a prefix-sum disguise.

**Equivalence to the recurrence.** Define `g(r) = P_{r+1} − m_r`. Then
```
g(r) = P_{r+1} − min(m_{r-1}, P_r) = P_{r+1} − min(m_{r-1}, P_r).
```
If `P_r ≤ m_{r-1}` (the running minimum updates at `r`), `g(r) = P_{r+1} − P_r = a_r` — a restart. Otherwise `g(r) = P_{r+1} − m_{r-1} = (P_r − m_{r-1}) + a_r = g(r−1) + a_r` — an extension. These are precisely the two branches of Theorem 2.1, so `g(r) = f(r)`. The two algorithms are the same algorithm. ∎

**Note on the empty-subarray boundary.** The prefix formulation with `min` taken over `l ∈ {0, …, r}` (including `l = 0`, i.e. `P₀ = 0`) corresponds to allowing the empty subarray *only when `P_{r+1} ≥ 0` happens to be beaten*; the strict non-empty version restricts `l ≤ r` so that the subarray `a[l..r]` is non-empty — which is the `min` over `P_0..P_r` paired with endpoint `P_{r+1}`, ensuring `l ≤ r`. The off-by-one here is the algebraic shadow of the all-negative initialization subtlety in §3.

**Geometric reading.** Plot the points `(k, P_k)` for `k = 0, …, n`. A subarray sum `S(l, r) = P_{r+1} − P_l` is the *vertical rise* from the prefix point at `l` to the prefix point at `r+1`. Maximizing `S(l, r)` is therefore "find the pair of prefix points (earlier index, later index) with the greatest upward rise." The running-minimum sweep is the standard one-pass solution to that geometric query: as the right point advances, keep the lowest left point seen so far and measure the rise to it. This is the same primitive as the "best time to buy and sell stock" valley-to-peak search — confirming the §11d equivalence visually.

**Theorem 4.2 (Uniqueness of the prefix-min witness).** For a fixed endpoint `r`, the optimal start `l*` in `f(r) = P_{r+1} − min_{l ≤ r} P_l` is the *smallest* index achieving `min_{l ≤ r} P_l` if ties are broken toward longer subarrays, and the *largest* such index if broken toward shorter subarrays.

**Proof.** All `l` attaining the prefix minimum give the identical sum `P_{r+1} − minPrefix`, so they are all optimal for endpoint `r`; they differ only in the resulting subarray length `r − l + 1`. Choosing the smallest minimizing `l` gives the longest such subarray, the largest gives the shortest. ∎

This theorem makes precise *which* optimal subarray the prefix formulation selects, dovetailing with the tie-breaking discussion of §11b and explaining why the recurrence-based and prefix-based reconstructions can return different (but equally optimal) windows unless their tie-break rules are aligned.

---

## 5. Complexity: O(n) Time and the Ω(n) Lower Bound

**Theorem 5.1 (Upper bound).** Kadane's runs in `O(n)` time and `O(1)` auxiliary space.

**Proof.** The loop executes `n−1` iterations, each performing a constant number of additions and comparisons. Two scalars (`bestEndingHere`, `bestSoFar`), plus optionally three index variables for reconstruction, are the only auxiliary storage. ∎

**Theorem 5.2 (Lower bound).** Any correct algorithm for the maximum-subarray problem must inspect every element, hence requires `Ω(n)` time in the worst case.

**Proof (adversary argument).** Suppose an algorithm declares an answer without reading some `a_j`. An adversary sets `a_j` first to a value consistent with the declared answer, then to `a_j' = M` for `M` arbitrarily large. The subarray `(a_j)` alone has sum `M`, so `OPT ≥ M` exceeds any previously declared finite answer, and `OPT` differs between the two inputs while the algorithm's output cannot (it never read `a_j`). Hence the algorithm is wrong on at least one of the two inputs. Therefore every element must be read, giving `Ω(n)`. ∎

**Conclusion.** Kadane's is **asymptotically optimal**: `Θ(n)` time, matching the lower bound, with optimal `O(1)` space. The `O(n²)` and `O(n³)` brute forces and the `O(n log n)` divide-and-conquer (§9) are all strictly worse in time; divide-and-conquer additionally pays `O(log n)` stack space.

**Refining the constant.** Beyond the asymptotic `Θ(n)`, the per-element work is one addition and one comparison (two comparisons if reconstructing indices). There is no hidden logarithmic factor, no amortization, and no recursion. This makes Kadane's the *cheapest possible* algorithm not only asymptotically but in constant factor: it touches each element once, in cache-friendly sequential order, with branch-predictable comparisons on typical data. The divide-and-conquer, by contrast, incurs `Θ(n)` work *per level* across `Θ(log n)` levels, plus function-call and stack overhead — a real (not merely asymptotic) slowdown observed in benchmarks (see [`tasks.md`](./tasks.md) Task B).

**Decision complexity.** Even in the comparison-and-addition model, the lower bound is tight: the maximum-subarray sum is a function that genuinely depends on all `n` inputs (changing any single `a_j` can change the answer, as the adversary of Theorem 5.2 shows), so no algorithm can certify the answer without reading every input. Kadane's matches this information-theoretic floor exactly.

---

## 6. Maximum-Product Correctness (Sign Tracking)

For the product variant, let `a` contain reals (possibly negative, possibly zero). Define the product `Π(l, r) = ∏_{m=l}^{r} a_m` and `OPT_× = max_{l ≤ r} Π(l, r)`.

The additive recurrence fails because the optimum-ending-here is **not** a function of the single best-ending-here product: multiplying a negative running product by a negative `a_r` can flip it to the maximum. The correct state is a **pair**.

**Definition 6.1.** `hi(r) = max_{l ≤ r} Π(l, r)` and `lo(r) = min_{l ≤ r} Π(l, r)` — the maximum and minimum products ending at `r`.

**Theorem 6.2 (Product recurrence).** With `hi(0) = lo(0) = a₀`,

```
hi(r) = max( a_r,  a_r · hi(r-1),  a_r · lo(r-1) ),
lo(r) = min( a_r,  a_r · hi(r-1),  a_r · lo(r-1) ),
```

and `OPT_× = max_r hi(r)`.

**Proof.** A product ending at `r` is either the singleton `a_r`, or a product ending at `r−1` multiplied by `a_r`. Among the latter, the extremes of `a_r · Π(l, r−1)` over `l ≤ r−1` are attained at the extremes of `Π(l, r−1)`:
- if `a_r ≥ 0`, multiplication is order-preserving, so the max comes from `hi(r−1)` and the min from `lo(r−1)`;
- if `a_r < 0`, multiplication **reverses** order, so the max comes from `lo(r−1)` and the min from `hi(r−1)`.

Taking `max`/`min` over the three candidates `{a_r, a_r·hi(r−1), a_r·lo(r−1)}` covers both sign cases uniformly (the reversal is absorbed because both `a_r·hi` and `a_r·lo` are listed). Hence the recurrences hold, and `OPT_× = max_r hi(r)` by the endpoint decomposition (★ for products). ∎

**The "swap on negative" optimization.** Implementations often swap `hi` and `lo` when `a_r < 0` *before* computing `hi(r) = max(a_r, a_r·hi)` and `lo(r) = min(a_r, a_r·lo)`. This is equivalent to Theorem 6.2: swapping makes the (now-largest) old `lo` play the role of `hi`, so the two-candidate form reproduces the three-candidate max.

**Zeros.** If `a_r = 0`, all three candidates collapse to `0`, so `hi(r) = lo(r) = 0` — the product is severed, and the next index restarts from its own singleton. The recurrence handles this without special-casing.

**Worked sign-tracking trace.** On `a = [-2, 3, -4]`:

```
r=0: hi = lo = -2.
r=1: a_r = 3 ≥ 0.  hi = max(3, 3·(-2), 3·(-2)) = max(3, -6, -6) = 3;  lo = min(3, -6, -6) = -6.
r=2: a_r = -4 < 0. candidates {-4, (-4)·3=-12, (-4)·(-6)=24}.
     hi = max(-4, -12, 24) = 24;  lo = min(-4, -12, 24) = -12.
OPT_× = max(hi over r) = max(-2, 3, 24) = 24.       ✓
```

The decisive moment is `r=2`: the *minimum* product `lo(1) = -6` (the most negative running product) becomes the *maximum* after multiplying by `-4`, producing `24`. A max-only sweep would have discarded `-6` and reported `3` — wrong. This trace is the empirical anchor for Theorem 6.2's sign-reversal argument.

**Number of sign tracks.** Two running extremes (`hi`, `lo`) suffice because multiplication by a scalar maps the interval `[lo, hi]` of achievable products to either `[a_r·lo, a_r·hi]` (if `a_r ≥ 0`) or `[a_r·hi, a_r·lo]` (if `a_r < 0`); in both cases the new extremes are images of the old extremes. No interior product can become extremal, so tracking the two endpoints is both necessary and sufficient — a one-dimensional analogue of how a linear map sends the extreme points of a segment to the extreme points of its image.

---

## 7. Circular Maximum-Subarray Correctness

Let the array be **circular**: a subarray may be `a[l..r]` (non-wrapping, `l ≤ r`) or a wrap `a[l..n−1] ∪ a[0..r]` with `l > r`. Let `OPT_◯` be the maximum over all such non-empty circular subarrays.

**Theorem 7.1.** Let `M = OPT` be the ordinary (non-wrapping) maximum-subarray sum, `T = Σ_i a_i` the total, and `μ` the *minimum*-sum non-empty subarray. Then

```
OPT_◯ = M                       if M < 0   (all elements negative),
OPT_◯ = max(M,  T − μ)          otherwise.
```

**Proof.** Any circular subarray is either non-wrapping or wrapping.
- *Non-wrapping* subarrays are exactly the ordinary subarrays; their best is `M`.
- *Wrapping* subarrays: a wrap `a[l..n−1] ∪ a[0..r]` has sum `T − S(r+1, l−1)`, where `a[r+1..l−1]` is the **complement**, a non-empty contiguous (non-wrapping) middle block (non-empty because the wrap omits at least one element, else it is the whole array, counted under non-wrapping). Maximizing the wrap sum minimizes the complement sum, so the best wrapping sum is `T − μ`.

Thus `OPT_◯ = max(M, T − μ)` **provided a valid wrap exists**, i.e. the complement is non-empty. The degenerate case: if every element is negative, the minimum-sum subarray `μ` is the entire array (`μ = T`), so `T − μ = 0` would correspond to the *empty* subarray — invalid. In that case the best wrap does not exist as a non-empty proper subarray, and `OPT_◯ = M` (the least-negative element). The test `M < 0` exactly detects the all-negative case (since `M = max_i a_i < 0 ⟺ all a_i < 0`). ∎

**Computation.** `M`, `T`, and `μ` are computed in a single `O(n)` pass: run max-Kadane and min-Kadane simultaneously and accumulate `T`. The min-Kadane recurrence is the mirror `minEndingHere = min(a_r, minEndingHere + a_r)`.

**Worked circular trace.** On `a = [5, -3, 5]`:

```
T = 5 + (-3) + 5 = 7.
max-Kadane: best non-wrapping M = 7 (the whole array [5,-3,5]) ... actually max(5, 5-3=2, 2+5=7, ...) → M = 7.
min-Kadane: minimum subarray μ = -3 (just the middle element).
wrap candidate = T − μ = 7 − (−3) = 10  (this is a[2] + a[0] = 5 + 5, the wrap).
M = 7 ≥ 0, so OPT_◯ = max(7, 10) = 10.            ✓
```

The complement of the wrapping subarray `{a[2], a[0]}` is exactly `{a[1]} = {−3}`, the minimum subarray, confirming the `T − μ` identity geometrically.

**Why exactly one wrap case suffices.** A circular subarray that wraps occupies a contiguous arc that *crosses* the boundary between index `n−1` and index `0`. Its complement is the contiguous arc that does *not* cross the boundary — an ordinary subarray. There is a bijection between (wrapping subarray) and (its non-wrapping complement), and the sums are related by `wrap = T − complement`. Hence the *single* quantity `μ` (the minimum non-wrapping subarray) captures the best over *all* wrapping subarrays simultaneously — no separate enumeration of wrap positions is needed. This is the elegance of the `T − μ` formulation.

**The guard, proved.** The all-negative guard `M < 0 ⟹ OPT_◯ = M` is not a patch but a theorem. If every `a_i < 0`, the minimum-sum subarray is the *entire* array, `μ = T`. Then the wrap candidate `T − μ = 0` would require removing all `n` elements, leaving the empty subarray — disallowed under the non-empty contract. So no valid wrapping subarray exists, and `OPT_◯` is the best *non*-wrapping subarray, which is `M`. The test `M < 0` detects this case exactly, since `M = max_i a_i`, and `max_i a_i < 0 ⟺ all a_i < 0`. Conversely, if some `a_i ≥ 0`, then `M ≥ 0`, the minimum subarray omits at least one (non-negative) element, the complement is non-empty, and `T − μ` is a legitimate wrap sum. Thus the two-line guard is provably complete.

---

## 8. The 2D Reduction: Correctness of Kadane over Column Sums

Let `G` be an `R × C` real matrix. A **submatrix** is `G[t..b][l..r]` with `0 ≤ t ≤ b < R` and `0 ≤ l ≤ r < C`; its sum is `Σ_{i=t}^{b} Σ_{j=l}^{r} G[i][j]`. Let `OPT₂` be the maximum over all non-empty submatrices.

**Definition 8.1 (Column-sum band).** For a fixed row pair `(t, b)`, define the 1D array `B^{(t,b)}[j] = Σ_{i=t}^{b} G[i][j]` for `j = 0, …, C−1`.

**Theorem 8.2.** `OPT₂ = max_{0 ≤ t ≤ b < R} Kadane( B^{(t,b)} )`, where `Kadane` returns the 1D maximum-subarray sum.

**Proof.** Every submatrix has a unique top row `t` and bottom row `b`. Fix them. The submatrix sum over columns `[l..r]` equals `Σ_{j=l}^{r} B^{(t,b)}[j]` (sum the column band, then the chosen column range — Fubini for finite sums). Maximizing over the column range `[l..r]` is exactly the 1D maximum-subarray problem on `B^{(t,b)}`, solved by `Kadane`. Maximizing over all `(t, b)` row pairs covers every submatrix exactly once. Hence the double maximum equals `OPT₂`. ∎

**Complexity.** There are `R(R+1)/2 = O(R²)` row pairs. Maintaining `B^{(t,b)}` incrementally as `b` increases (`B^{(t,b)}[j] = B^{(t,b−1)}[j] + G[b][j]`) costs `O(C)` per pair, and `Kadane` costs `O(C)` per pair. Total `O(R² · C)` time, `O(C)` space (one band). By transposing when `R > C`, the bound becomes `O(min(R,C)² · max(R,C))`.

**Lower bound remark.** No truly subquadratic algorithm (in `R·C`) is known for the maximum-sum submatrix of *arbitrary* dimensions; the problem is related to (max,+)-matrix-product and Max-Weight-Rectangle, for which subcubic algorithms would have surprising fine-grained-complexity consequences. For practical grids the `O(R²C)` reduction is the standard.

**Why the reduction is correct, restated as a fixing argument.** The maximization `max over submatrices` is over four free parameters `(t, b, l, r)`. The reduction *fixes* the two vertical parameters `(t, b)` in the outer loop and lets the 1D Kadane optimize the two horizontal parameters `(l, r)` for that fixed band. Because the objective (the submatrix sum) decomposes as `Σ_{j=l}^{r} (Σ_{i=t}^{b} G[i][j])` — a sum over columns of fixed per-column quantities — the inner optimization over `(l, r)` is *exactly* a 1D maximum-subarray over the array of column sums. The outer loop then takes the max over all `O(R²)` vertical choices. This "fix two dimensions, solve the other two optimally" pattern is the general technique for reducing a 2D contiguous-region problem to a 1D one, and it recurs in problems like maximal rectangle and largest all-ones submatrix.

**A note on incremental band maintenance.** Re-deriving `B^{(t,b)}` from scratch for each `(t,b)` would cost `O((b−t)·C)`, summing to `O(R³C)` overall. The incremental update `B^{(t,b)} = B^{(t,b−1)} + (\text{row } b)` exploits that consecutive bands differ by one row, restoring `O(R²C)`. This is the same "extend rather than recompute" insight that powers Kadane's itself, applied one dimension up: do not recompute a prefix you already have.

---

## 9. Divide-and-Conquer Recurrence and the Segment Monoid

**Algorithm.** Split `a[lo..hi]` at `mid = ⌊(lo+hi)/2⌋`. The maximum subarray lies entirely in `[lo, mid]`, entirely in `[mid+1, hi]`, or **crosses** `mid`. The crossing maximum is `(best suffix of the left ending at mid) + (best prefix of the right starting at mid+1)`, each found by an `O(n)` linear scan.

**Theorem 9.1 (Recurrence).** The running time satisfies `T(n) = 2 T(n/2) + Θ(n)`, hence `T(n) = Θ(n log n)` by the Master Theorem (case 2, `a = b² ` with `f(n) = Θ(n^{log_b a}) = Θ(n)`).

**Proof.** Two recursive calls on halves (`2T(n/2)`); the crossing computation scans both halves once (`Θ(n)`). The Master Theorem with `a = 2, b = 2, f(n) = Θ(n)` and `log_b a = 1` gives `Θ(n log n)`. ∎

**The segment monoid (why merging is associative).** Promote each node to a 4-tuple `seg = (total, bestPrefix, bestSuffix, best)`. For a leaf `x`: `(x, x, x, x)`. The merge of left `L` and right `R`:

```
total      = L.total + R.total
bestPrefix = max(L.bestPrefix, L.total + R.bestPrefix)
bestSuffix = max(R.bestSuffix, R.total + L.bestSuffix)
best       = max(L.best, R.best, L.bestSuffix + R.bestPrefix)
```

**Theorem 9.2.** `(merge, leaf)` is a monoid: `merge` is associative, and the all-`−∞`/`0` "empty" tuple `e = (0, −∞, −∞, −∞)` is its identity.

**Proof sketch.** Each component of `merge(merge(L, M), R)` and `merge(L, merge(M, R))` expands, using associativity and commutativity of `+` and `max` and the distributive law `c + max(x, y) = max(c+x, c+y)`, to the same expression in `L, M, R` (e.g. `best` becomes `max(L.best, M.best, R.best, L.suf+M.pre, M.suf+R.pre, L.suf+M.total+R.pre)` either way). The identity laws are routine. ∎

**Consequence.** Associativity is exactly what makes the divide-and-conquer split-point-independent, lets a segment tree answer **range** maximum-subarray queries in `O(log n)` and support point updates, and lets distributed shards merge in any order (senior §2.4). Kadane's `O(n)` is the special case of folding the monoid left-to-right; the divide-and-conquer is folding it as a balanced tree. The monoid view unifies all three.

**The folding equivalence, made precise.** Let `seg(a) = leaf(a₀) ⊕ leaf(a₁) ⊕ … ⊕ leaf(a_{n−1})` under the monoid `⊕ = merge`. By associativity this is well-defined regardless of parenthesization. Then `seg(a).best = OPT`. *Left fold* (parenthesize as `((…(x₀⊕x₁)⊕x₂)…)`) processes elements one at a time, maintaining a running accumulator — and one can verify that the `best` and `bestSuffix` components of the running accumulator are exactly `bestSoFar` and `bestEndingHere` of Kadane's. So Kadane's algorithm *is* the left fold of the segment monoid, with the `total` and `bestPrefix` components carried but unused for the scalar answer. *Balanced fold* (parenthesize as a balanced binary tree) is the divide-and-conquer. They compute the same `seg(a).best` because `⊕` is associative — a clean structural proof that all three algorithms agree.

**Identity and degenerate intervals.** The empty interval maps to the identity `e = (0, −∞, −∞, −∞)`: `total = 0` (empty sum), and `bestPrefix = bestSuffix = best = −∞` because there is no non-empty subarray in an empty interval. With `−∞` as the additive-absorbing sentinel for `max`, `merge(e, S) = merge(S, e) = S` holds, confirming `e` is the monoid identity and validating the segment-tree base case for empty leaves.

**Worked merge trace.** Split `a = (−2, 1, −3, 4, −1, 2, 1, −5, 4)` at the midpoint into `L = a[0..3] = (−2,1,−3,4)` and `R = a[4..8] = (−1,2,1,−5,4)`:

```
L summary:  total = 0,  bestPrefix = 0  (a[0..3]=0 ... actually max(-2,-1,-4,0)=0),
            bestSuffix = 4  (a[3]),     best = 4  (a[3])
R summary:  total = 1,  bestPrefix = 2  (a[4..5]=-1+2=1? → max prefix = 2 via a[5]? )
            bestSuffix = 4  (a[8]),     best = 3  (a[5..6]=2+1=3)

merge(L,R):
  total      = 0 + 1 = 1
  bestPrefix = max(L.bestPrefix=0, L.total + R.bestPrefix = 0+2 = 2) = 2
  bestSuffix = max(R.bestSuffix=4, R.total + L.bestSuffix = 1+4 = 5) = 5
  best       = max(L.best=4, R.best=3, L.bestSuffix + R.bestPrefix = 4+2 = 6) = 6
```

The crossing term `L.bestSuffix + R.bestPrefix = 4 + 2 = 6` is exactly the winning subarray `a[3..6]`, which straddles the midpoint — the case that neither half's recursive `best` captures. This is why the `merge` must include the cross term, and why the result `6` matches `OPT`. Folding the same nine leaves left-to-right instead reproduces the Kadane trace of §3; folding them as a balanced tree reproduces the divide-and-conquer — both equal `6` by associativity.

---

## 10. Bounded-Length Variants (At Most / At Least k)

The raw recurrence `f(r) = max(a_r, f(r−1)+a_r)` has **no notion of length**, so length constraints are imposed through the prefix-sum lens (§4).

**At most `k` elements.** The best subarray ending at `r` of length `≤ k` is `P_{r+1} − min_{r−k+1 ≤ l ≤ r} P_l` (the window of allowed left endpoints has width `k`). Maintaining the windowed minimum of `P` with a **monotonic deque** gives `O(1)` amortized per step, `O(n)` total.

**Theorem 10.1.** `OPT_{≤k} = max_r ( P_{r+1} − min_{max(0, r-k+1) ≤ l ≤ r} P_l )`, computable in `O(n)` with a monotonic deque maintaining the sliding-window minimum of the prefix array.

**Proof.** Length `r − l + 1 ≤ k ⟺ l ≥ r − k + 1`, combined with `l ≤ r` (non-empty) and `l ≥ 0`. So the feasible left endpoints for endpoint `r` form the window `[max(0, r−k+1), r]`, over which we minimize `P_l` and subtract from `P_{r+1}`. The deque keeps indices of `P` in increasing-value order, evicting those outside the window from the front and those dominated from the back, yielding the window minimum in amortized `O(1)`. ∎

**At least `k` elements.** Now `l ≤ r − k + 1`, so the constraint is a *prefix-running* minimum that lags by `k`: `OPT_{≥k} = max_{r ≥ k-1} ( P_{r+1} − min_{0 ≤ l ≤ r-k+1} P_l )`. Maintain `min_{l ≤ r-k+1} P_l` as a simple running minimum updated with a `k`-step delay (add `P_{r-k+1}` to the candidate pool when processing `r`). This is `O(n)`, `O(1)` extra space.

**Theorem 10.2.** `OPT_{≥k}` is computable in `O(n)` time and `O(1)` space via the lagged running-minimum of the prefix array.

**Proof.** The feasible left endpoints `[0, r−k+1]` form a *prefix* (not a sliding window), so their minimum is monotone-maintainable by a single running variable that absorbs `P_{r−k+1}` as `r` advances; the maximization over `r` then yields `OPT_{≥k}`. Correctness follows from Theorem 4.1 restricted to the feasible-endpoint set. ∎

Both variants confirm the structural point: **length constraints live in the prefix-sum + windowed-minimum formulation, not in the bare additive recurrence.**

**Worked at-most-`k` trace.** On `a = (1, −3, 2, 1, −1)` with `k = 2`, prefix `P = (0, 1, −2, 0, 1, 0)`:

```
r=0: window of l in [0,0]: min P = P₀ = 0.  cand = P₁ − 0 = 1.
r=1: window l in [0,1]: min(P₀,P₁)=0.       cand = P₂ − 0 = -2.
r=2: window l in [1,2]: min(P₁,P₂)=-2.      cand = P₃ − (−2) = 0 − (−2) = 2.
r=3: window l in [2,3]: min(P₂,P₃)=-2.      cand = P₄ − (−2) = 1 + 2 = 3.   ← best
r=4: window l in [3,4]: min(P₃,P₄)=0.       cand = P₅ − 0 = 0.
OPT_{≤2} = 3, the subarray a[2..3] = (2, 1).                                  ✓
```

The deque holds prefix indices in increasing-value order; at `r=3` it evicts `P₀, P₁` (now outside the width-`2` window of feasible left endpoints) and exposes `min = −2`, yielding the optimal length-`2` window. Note the *unconstrained* Kadane answer here would also be `3` (the same window happens to satisfy the bound), but on inputs where the unconstrained optimum is longer than `k`, the deque correctly forbids it — which a bare recurrence cannot.

**Why the deque, not a running min.** For at-most-`k`, the feasible-left-endpoint set is a *sliding window* `[r−k+1, r]` that both gains a new element and loses an old one as `r` advances. A single running-minimum variable cannot retract the departing element, so it would report a stale (too-small) minimum once the true minimizer leaves the window. The monotonic deque solves exactly this "minimum over a sliding window" subproblem in amortized `O(1)`, which is why at-most-`k` is strictly harder than at-least-`k` (whose feasible set is a growing prefix, retractions-free, hence a plain running minimum suffices).

---

## 11. Generalizations and the Empty-Subarray Algebra

**The empty-subarray variant.** If the empty subarray (sum `0`) is allowed, define `f⁺(r) = max(0, f⁺(r−1) + a_r)` and `OPT⁺ = max(0, max_r f⁺(r))`. Equivalently `OPT⁺ = max(0, OPT)`.

**Proposition 11.1.** `OPT⁺ = max(0, OPT)`, and `OPT⁺ = OPT` whenever some `a_i ≥ 0`.

**Proof.** Allowing the empty subarray adds the single candidate value `0`, so `OPT⁺ = max(0, OPT)`. If some `a_i ≥ 0`, then `OPT ≥ a_i ≥ 0`, so `max(0, OPT) = OPT`. The two contracts differ **only** when every element is negative, where `OPT < 0` but `OPT⁺ = 0`. ∎

This proposition is the formal statement of the senior-level "contract" decision: the two problems coincide except on all-negative inputs, which is exactly why that single case must be tested against the stated requirement.

**Semiring perspective.** The additive Kadane recurrence lives in the max-plus (tropical) semiring `(ℝ ∪ {−∞}, max, +)`: `bestEndingHere` is a max-plus "running product," and `OPT` is a max-plus sum of these. The product variant lives over `(ℝ, max/min, ×)` with the order-reversal handled by tracking both extremes. The segment monoid (§9) is the matrix-like structure of this algebra restricted to intervals. This places maximum-subarray in the same family as shortest/longest-path tropical algebra, though the 1D contiguity makes it far easier than the general path problems.

**Why subsequence is different (and easier).** If gaps were allowed (a *subsequence*, not a subarray), the optimum is simply `Σ max(a_i, 0)` (take every non-negative element) — an `O(n)` triviality with no DP needed. The contiguity constraint is what makes the maximum-*subarray* problem interesting: it forbids skipping a negative element in the middle of an otherwise-strong run, forcing the `f(r−1)` dependence.

**The semiring made explicit.** In the max-plus semiring `(ℝ ∪ {−∞}, ⊕ = max, ⊗ = +)`, the quantity `f(r)` is the `⊗`-product accumulated along the suffix ending at `r`, "reset" to a fresh start whenever continuing would lower the value. Formally, define for the interval `[l, r]` the value `w(l, r) = Σ_{m=l}^{r} a_m` (a `⊗`-product in additive notation). Then

```
OPT = ⊕_{l ≤ r} w(l, r) = max_{l ≤ r} Σ_{m=l}^{r} a_m,
```

a `⊕`-sum (maximum) over all contiguous `⊗`-products (interval sums). The segment monoid of §9 is precisely the closure of this algebra under interval concatenation, with the 4-tuple recording the data needed to combine adjacent intervals: the full product (`total`), the best left-anchored and right-anchored sub-products (`bestPrefix`, `bestSuffix`), and the best interior sub-product (`best`). This situates maximum-subarray in the same algebraic family as the tropical shortest-path computations of `06-floyd-warshall` and the matrix-power walk counts of `32-paths-fixed-length`, differing only in that the 1D contiguity restricts attention to *interval* products rather than arbitrary path products — which is exactly why it is solvable in linear, rather than cubic, time.

---

## 11b. Tie-Breaking, Uniqueness, and Canonical Solutions

The value `OPT` is unique, but the *optimal subarray* need not be — several `(l, r)` may achieve it. A rigorous treatment specifies a canonical choice.

**Definition 11b.1 (Tie-breaking orders).** Among all `(l, r)` with `S(l, r) = OPT`, common canonical selections are:
- **leftmost-shortest:** smallest `l`, then smallest `r − l`;
- **leftmost-longest:** smallest `l`, then largest `r`;
- **earliest-found:** the first optimum encountered in the left-to-right sweep.

**Proposition 11b.2.** The index-reconstruction Kadane of [`middle.md`](./middle.md), which updates `(bestL, bestR)` only on a *strict* improvement (`be > best`), returns the **earliest-found, shortest-at-that-endpoint** optimum: it fixes the endpoint `r` to the first index attaining `OPT`, and `start` is the *latest* restart `≤ r`, hence the shortest run ending at that `r`.

**Proof.** Strict `>` means `(bestL, bestR)` is recorded the first time `be` reaches a new maximum, so the recorded `r` is the earliest endpoint achieving `OPT`. By Corollary 2.2, `start` is the most recent restart, i.e. the largest `l ≤ r` with `f(l−1) ≤ 0` (or `l = 0`); this is the shortest optimal run ending at `r`, because any earlier start would include a non-positive prefix and not increase the sum. ∎

To obtain **leftmost-longest** instead, use `≥` and additional bookkeeping; the point is that tie-breaking is a *specification* decision, not an accident of the code, and it must be stated in any contract that returns indices (a downstream consumer comparing two implementations will see spurious "mismatches" if the tie-break is unspecified).

**Counting optima.** The number of distinct optimal subarrays can be as large as `Θ(n²)` (e.g. an array of all zeros under the empty-disallowed contract: every subarray sums to `0 = OPT`). Enumerating all of them is therefore not `O(n)` in the worst case; Kadane's returns *one* canonical optimum in `O(n)`, and listing all requires an output-sensitive `O(n + occ)` second pass over the prefix structure.

## 11c. Stability Under Perturbation and Robust Variants

**Sensitivity.** Changing one element `a_j` by `δ` changes `OPT` by at most `|δ|` (any subarray containing `j` shifts by `δ`; those not containing `j` are unchanged), so `OPT` is `1`-Lipschitz in each coordinate. This bounds how much numerical error in a single input perturbs the answer — useful when inputs are measured quantities with error bars.

**Robust / penalized variants.** Production "best window" objectives often add a length penalty (`S(l, r) − γ·(r − l + 1)` for `γ ≥ 0`) to discourage trivially long windows. This is *still* a maximum-subarray problem on the shifted array `a'_i = a_i − γ`, because the penalty is additive per element. Hence Kadane's solves the penalized version verbatim by pre-subtracting `γ` from every element — a one-line reduction that preserves `O(n)` and is worth recognizing rather than re-deriving a bespoke DP.

**Maximum-average subarray (contrast).** By contrast, maximizing the *average* `S(l, r)/(r − l + 1)` is **not** a Kadane problem (the objective is not additive). With a minimum length constraint it is solved by binary search on the average value combined with a Kadane-style feasibility check (`a_i − mid` has a length-`≥ L` subarray with non-negative sum), giving `O(n log(maxVal/ε))`. This is a clean example of where the additive structure that Kadane's exploits breaks down, and how a parametric-search wrapper recovers tractability.

## 11d. The DP Lattice: Where Maximum-Subarray Sits

Maximum-subarray is the **minimal non-trivial dynamic program**, and locating it in the broader DP landscape clarifies both why it is so cheap and what its near neighbours cost.

**The three DP dimensions.** A dynamic program is characterized by (i) the number of states, (ii) the per-state transition cost, and (iii) the dependency depth (how many earlier states each state reads). For maximum-subarray:

- **States:** `n` (one `f(r)` per index) — minimal for a sequence problem.
- **Transition cost:** `O(1)` — a single `max` of two terms.
- **Dependency depth:** `1` — `f(r)` reads only `f(r−1)`.

The depth-`1` dependency is what collapses the `O(n)` state table to `O(1)` rolling state. Problems with depth `k` (reading the last `k` states) need `O(k)` rolling state; problems whose transition scans all earlier states (depth `O(n)`) cost `O(n²)` unless a monotonic-structure or convex-hull trick reduces the transition.

**Neighbours in the lattice.**

| Problem | States | Transition | Total | Relation to max-subarray |
|---------|--------|-----------|-------|--------------------------|
| Maximum subarray (sum) | `n` | `O(1)`, depth 1 | `O(n)` | the base case |
| Maximum product subarray | `n` | `O(1)`, depth 1, 2-tuple state | `O(n)` | richer state (min+max) |
| Longest increasing subsequence | `n` | `O(log n)` with BIT/patience | `O(n log n)` | non-contiguous, ordering constraint |
| House robber / no-two-adjacent | `n` | `O(1)`, depth 2 | `O(n)` | depth-2 dependency |
| Best-time-to-buy-sell-stock | `n` | `O(1)`, depth 1 | `O(n)` | a relabeled max-subarray on first differences |
| Maximum-sum submatrix | `R²` bands | `O(C)` Kadane | `O(R²C)` | one dimension lifted |

**Stock-trading equivalence.** "Maximum profit from one buy and one sell" on prices `p` is exactly maximum-subarray on the *first-difference* array `d_i = p_i − p_{i−1}`: a buy at `l` and sell at `r` earns `p_r − p_l = Σ_{i=l+1}^{r} d_i`, a subarray sum of `d`. So the famous interview problem is Kadane's in disguise — recognizing this collapses a "new" problem to a solved one, the hallmark of DP fluency.

**Why depth matters for parallelism.** Depth-1 dependency is also what makes the *associative-monoid* lift (§9) possible: because each state depends only on an aggregate of a contiguous block, the computation is a fold of an associative operator, hence parallelizable and tree-foldable. Deeper or non-local dependencies (e.g. LIS) lack this clean monoid structure and are correspondingly harder to parallelize. The maximum-subarray problem thus sits at a sweet spot: rich enough to require a genuine recurrence, simple enough to admit `O(1)` space, optimal linear time, *and* an associative parallel form.

## 12. Summary

- **Reduction.** `OPT = max_r f(r)` where `f(r)` is the best subarray ending at `r` — one global maximization over `O(n²)` intervals becomes `n` local ones (★).
- **Recurrence.** `f(r) = max(a_r, f(r−1) + a_r)`, with restart iff `f(r−1) ≤ 0` (Corollary 2.2); optimal substructure with `O(1)` state, the minimal non-trivial DP.
- **Correctness.** A loop-invariant induction (Theorem 3.1) proves `bestSoFar = OPT`; the key lemma is that no optimal subarray begins with a negative-sum prefix, so dropping such prefixes is provably safe. The all-negative answer is the least-negative element, which follows from initializing to `a₀`.
- **Prefix-minimum equivalence.** `OPT = max_r (P_{r+1} − min_{l ≤ r} P_l)` (Theorem 4.1) is the *same* algorithm in prefix-sum form, and it is the lens that powers the bounded-length variants.
- **Complexity.** `Θ(n)` time, `O(1)` space, **optimal** by an `Ω(n)` adversary lower bound (Theorem 5.2).
- **Product variant.** Track both `hi` and `lo`; a negative element reverses multiplicative order, so the min can become the max (Theorem 6.2). Zeros sever the product automatically.
- **Circular variant.** `max(M, T − μ)` with an all-negative guard (`M < 0 ⟹ answer = M`), because the wrap's complement must be a non-empty subarray (Theorem 7.1).
- **2D reduction.** Fix a row band, collapse to column sums, run 1D Kadane; correct by Fubini, `O(R²C)` with a transpose optimization (Theorem 8.2).
- **Divide-and-conquer.** `T(n) = 2T(n/2)+Θ(n) = Θ(n log n)`; the `(total, bestPrefix, bestSuffix, best)` tuple forms an **associative monoid** (Theorem 9.2), enabling segment-tree range queries and distributed merging.
- **Bounded length.** "At most/at least `k`" are `O(n)` via windowed/lagged prefix-minimum (Theorems 10.1–10.2), not via the bare recurrence.
- **Empty-subarray algebra.** `OPT⁺ = max(0, OPT)`; the two contracts coincide except on all-negative inputs (Proposition 11.1). Subsequence (gaps allowed) is the trivial `Σ max(a_i, 0)` — contiguity is what makes the subarray problem non-trivial.
- **Tie-breaking.** The optimal value is unique but the optimal subarray may not be; strict-`>` index reconstruction returns the earliest, shortest optimum (Proposition 11b.2), and the tie-break must be specified in any indices-returning contract.
- **Stability and robust variants.** `OPT` is `1`-Lipschitz in each input; a length penalty `γ` reduces to plain Kadane on `a_i − γ`; the maximum-*average* subarray is not additive and needs parametric (binary) search around a Kadane feasibility test.
- **DP placement.** Maximum-subarray is the minimal non-trivial DP: `n` states, `O(1)` depth-1 transition, hence `O(1)` rolling space, optimal `O(n)` time, and an associative monoid lift for parallelism. Best-time-to-buy-sell-stock is the same problem on first differences.

### Complexity Cheat Table

| Task | Method | Time | Space | Optimal? |
|------|--------|------|-------|----------|
| Max-sum subarray | Kadane / prefix-min | `O(n)` | `O(1)` | yes (`Ω(n)` bound) |
| Max-sum + indices | Kadane + start tracking | `O(n)` | `O(1)` | yes |
| Max-product subarray | dual min/max | `O(n)` | `O(1)` | yes |
| Circular max-sum | `max(M, T−μ)` + guard | `O(n)` | `O(1)` | yes |
| 2D max-sum submatrix | row-band + 1D Kadane | `O(R²C)` | `O(C)` | no subquadratic known |
| Range max-subarray queries | segment monoid | `O(log n)`/query | `O(n)` | — |
| At most/at least `k` | prefix-min + deque | `O(n)` | `O(n)`/`O(1)` | yes |
| Divide & conquer (contrast) | recursion | `O(n log n)` | `O(log n)` | no (Kadane beats it) |
| Penalized (length-γ) max-subarray | Kadane on `a−γ` | `O(n)` | `O(1)` | yes |
| Maximum-average subarray (≥ L) | parametric search + Kadane | `O(n log(V/ε))` | `O(1)` | — |
| Enumerate all optima | prefix-structure pass | `O(n + occ)` | `O(occ)` | output-sensitive |

### Theorem Index

For quick reference, the load-bearing results proved above:

- **Theorem 2.1** — the `f(r) = max(a_r, f(r−1)+a_r)` recurrence (optimal substructure).
- **Theorem 3.1** — Kadane terminates with `bestSoFar = OPT` (loop-invariant induction).
- **Theorem 4.1 / 4.2** — prefix-minimum equivalence and the uniqueness of its witness.
- **Theorem 5.1 / 5.2** — `O(n)` upper bound and `Ω(n)` adversary lower bound (optimality).
- **Theorem 6.2** — product recurrence with sign-tracking (min/max pair).
- **Theorem 7.1** — circular `max(M, T−μ)` with the all-negative guard.
- **Theorem 8.2** — 2D reduction correctness (fix the band, Kadane the column sums).
- **Theorem 9.1 / 9.2** — `O(n log n)` divide-and-conquer and the associative segment monoid.
- **Theorems 10.1 / 10.2** — bounded-length variants via windowed/lagged prefix minimum.
- **Proposition 11.1** — `OPT⁺ = max(0, OPT)`; the empty-subarray contract.
- **Proposition 11b.2** — canonical (earliest, shortest) optimum returned by strict-`>` reconstruction.

Each is `O(n)` (or `O(R²C)` for 2D) and each was anchored by an explicit worked trace, so an implementer can regression-test against the hand-computed values rather than only against another implementation.

### Reusable Regression Vectors

Collected for convenience, the worked values an implementation should reproduce exactly:

```
sum:      kadane([-2,1,-3,4,-1,2,1,-5,4]) = 6   at indices (3, 6)
all-neg:  kadane([-3,-1,-2])              = -1  at indices (1, 1)
product:  maxProduct([-2,3,-4])           = 24
product:  maxProduct([-2,0,-1])           = 0
circular: maxCircular([5,-3,5])           = 10  (wrap a[2],a[0])
circular: maxCircular([-3,-2,-3])         = -2  (guard fires)
2D:       maxSubmatrix(4x5 canonical)     = 29  rows 1..3, cols 1..3
at-most:  maxAtMostK([1,-3,2,1,-1], 2)    = 3   subarray a[2..3]
empty⁺:   OPT⁺([-3,-1,-2])                = 0
```

These nine vectors exercise every theorem above and every edge case (all-negative, zero-in-product, wrap, guard, 2D band, length bound, contract). Any implementation matching all nine, plus a randomized property-test against the `O(n²)` oracle, is correct with very high confidence.

Foundational references: Bentley, *Programming Pearls* (Column 7–8, the origin and the `O(n)` derivation); CLRS Chapter 4 (divide-and-conquer maximum-subarray and the Master Theorem); Bentley/Grenander for the original 2D motivation; the maximum-scoring-segment literature in bioinformatics (Ruzzo–Tompa); tropical/max-plus algebra for the semiring view; and the segment-tree maximum-subarray monoid (a competitive-programming staple). Sibling topics: `13-dynamic-programming` and the `sliding-window-technique` skill.
