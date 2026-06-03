# Convex Hull Trick and Li Chao Tree — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions (incl. 1.6 transition = envelope query)
2. The Lower Envelope Is Convex (incl. 2.1 worked example)
3. The Bad-Line (Cross/Intersection) Test: Correctness (incl. 3.1 worked, 3.2 sign stability)
4. The Monotone CHT: Amortized O(1) Analysis (incl. 4.1 potential, 4.2 counterexample)
5. CHT with Binary Search: Correctness and Complexity (incl. 5.1 worked, 5.2 dynamic CHT)
6. The Li Chao Tree: Correctness Proof (incl. 6.1 trace, 6.2 swap step)
7. The Li Chao Tree: O(log C) Complexity (incl. 7.1 single descent, 7.2 numerical precision)
8. Segment Insertion in the Li Chao Tree (incl. 8.1 out-of-range, 8.2 tightness)
9. Min vs Max: The Duality (incl. 9.1 worked, 9.2 bug-risk asymmetry)
10. The Cost Condition: Convexity / Monge / Concavity (incl. 10.1 Monge check, 10.2 non-Monge)
11. Relation to Divide-and-Conquer and Knuth Optimizations (incl. 11.1 D&C, 11.2 Knuth)
12. Lower Bounds and the Output-Size Argument (incl. 12.1 hull duality, 12.2 query bound)
13. Summary
14. Worked Complexity Comparison

---

## 1. Formal Definitions

Let `𝓛 = {L_1, …, L_n}` be a finite set of affine functions (lines) over the reals, `L_j(x) = m_j·x + b_j`, with slope `m_j ∈ ℝ` and intercept `b_j ∈ ℝ`.

**Definition 1.1 (Lower envelope).** The **lower envelope** of `𝓛` is the function
```
E(x) = min_{1 ≤ j ≤ n} L_j(x) = min_j (m_j·x + b_j).
```
The **upper envelope** is `E⁺(x) = max_j L_j(x)`.

**Definition 1.2 (Query).** A **query** at point `x` asks for `E(x)` (and, often, an index `j` attaining it). The CHT/Li Chao structures answer queries after a set of lines has been inserted, possibly interleaving inserts and queries.

**Definition 1.3 (Winning line / breakpoint).** For each `x`, a line `L_j` is a **winner** if `L_j(x) = E(x)`. A **breakpoint** is an `x` where the set of winners changes. Between consecutive breakpoints, a single line is the unique winner (generic case).

**Definition 1.4 (Dominated line).** A line `L_j` is **dominated** (useless) if it is a winner for no `x ∈ ℝ`, i.e. `L_j(x) > E_{≠j}(x)` for all `x`, where `E_{≠j}` is the envelope of the other lines.

**Definition 1.5 (The DP transition).** The technique optimizes transitions
```
dp[i] = g(i) + min_{j ∈ S(i)} ( m_j·x_i + b_j ),
```
where `g(i)`, `x_i` depend only on `i`, and `(m_j, b_j)` depend only on `j` (computed once `dp[j]` is known). Each `j` contributes the line `L_j`, and `dp[i]` is `g(i)` plus a query of the lower envelope at `x_i`.

**Notation.** `n` = number of lines; `Q` = number of queries; `C` = `xhi − xlo + 1`, the size of the (integer) coordinate domain for the Li Chao tree; `ω` will not appear (no matrix multiply here). "Line" means a total affine function on all of `ℝ`; "segment" means an affine function restricted to an interval.

**Proposition 1.6 (Transition = envelope query, exactly).** The rewrite of Definition 1.5 is *unconditional*: for any quantities `g(i), x_i` (functions of `i` only) and `m_j, b_j` (functions of `j` only),
```
dp[i] = g(i) + min_{j ∈ S(i)} (m_j x_i + b_j) = g(i) + E_{S(i)}(x_i),
```
where `E_{S(i)}` is the lower envelope of `{L_j : j ∈ S(i)}`. No convexity or Monge assumption is needed for this step — it is a definitional identity. The Monge/convexity condition (Section 10) is what makes the *active set `S(i)` grow monotonically* (so old lines are never removed and the structures stay valid incrementally); the line *form* is what makes each decision representable as a geometric object. Distinguishing "the rewrite is always valid" from "the *incremental* structure is valid only under monotone `S(i)`" is the key conceptual point, and the source of a common confusion: CHT applies whenever the transition has the line form **and** lines are only ever added (not removed) as `i` advances.

---

## 2. The Lower Envelope Is Convex

**Theorem 2.1.** The lower envelope `E(x) = min_j (m_j x + b_j)` is a **concave**, piecewise-linear function; equivalently, `−E` is convex. The upper envelope `E⁺` is convex.

**Proof.** Each `L_j` is affine, hence both convex and concave. The pointwise **minimum** of affine functions is concave: for `x, y ∈ ℝ` and `θ ∈ [0,1]`,
```
E(θx + (1−θ)y) = min_j ( m_j(θx+(1−θ)y) + b_j )
              = min_j ( θ(m_j x + b_j) + (1−θ)(m_j y + b_j) )
              ≥ θ·min_j(m_j x + b_j) + (1−θ)·min_j(m_j y + b_j)   (min of a sum ≥ sum of mins)
              = θ E(x) + (1−θ) E(y),
```
which is exactly concavity. Symmetrically, the pointwise **maximum** of affine functions is convex. Piecewise-linearity follows because `E` agrees locally with whichever single `L_j` is the winner. ∎

**Remark (terminology).** "Convex Hull Trick" names the technique because the *winning lines*, ordered by slope, are precisely the edges of the boundary of the convex region `{(x, y) : y ≥ L_j(x) for all j}` — i.e. the lower boundary is the graph of `E`, and its slopes increase (for the dual point set, the relevant lines are the vertices of a convex hull). The practical consequence we use everywhere:

**Corollary 2.2 (Monotone winners).** Order the lines on the envelope by slope. As `x` increases from `−∞` to `+∞`, the winning line for the **minimum** changes from the line of largest slope to the line of smallest slope, monotonically — each line wins on a single contiguous interval, and the winning slope is non-increasing in `x`. Hence the index of the winner is a monotone function of `x`. This monotonicity is what makes the moving-pointer query (Section 4) and binary search (Section 5) correct.

**Proof.** Two lines `L_a, L_b` with `m_a > m_b` cross at exactly one `x*`; for `x < x*`, `L_b` is below (smaller value) ... let us be precise: `L_a(x) − L_b(x) = (m_a − m_b)x + (b_a − b_b)`, increasing in `x`. So for small `x`, `L_a − L_b < 0` (i.e. `L_a` is the smaller, the min-winner) and for large `x`, `L_b` is the min-winner. Thus the larger-slope line wins on the left, the smaller-slope on the right; chaining over all envelope lines gives the monotone hand-off. ∎

### 2.1 Worked Convexity / Monotone-Winner Example

Lines `L0: y=2x+0`, `L1: y=0·x+1`, `L2: y=−2x+0`. Compute the envelope minimum on a grid:

```
x:        −2    −1     0     1     2
L0=2x:    −4    −2     0     2     4
L1=1:      1     1     1     1     1
L2=−2x:    4     2     0    −2    −4
min:      −4    −2     0    −2    −4
winner:   L0    L0  L0/L1/L2 L2   L2
```

Far left, `L0` (largest slope) wins; far right, `L2` (smallest slope) wins; `L1` is dominated here (it never strictly wins). The winning slope goes `2 → 0 → −2` — **non-increasing in `x`**, as Corollary 2.2 states; the `min` row is convex (it bends upward at the breakpoint near `x=0`), as Theorem 2.1 guarantees. This monotone hand-off is what a moving pointer tracks and what binary search locates — and note that `L1` being dominated is exactly the situation the bad-line test (Section 3) detects and prunes.

---

## 3. The Bad-Line (Cross/Intersection) Test: Correctness

Consider three lines in **strictly decreasing slope order** `m_1 > m_2 > m_3` (the order in which a min-CHT inserts them so far). We want to decide whether the middle line `L_2` is dominated by `L_1` and `L_3` together — i.e. whether `L_2` ever wins the minimum.

**Definitions.** Let
```
x_{12} = (b_2 − b_1)/(m_1 − m_2)   (intersection of L_1, L_2),
x_{13} = (b_3 − b_1)/(m_1 − m_3)   (intersection of L_1, L_3).
```
Both denominators are positive since `m_1 > m_2` and `m_1 > m_3`.

**Theorem 3.1 (Bad-line criterion).** With `m_1 > m_2 > m_3`, the middle line `L_2` is dominated by `{L_1, L_3}` **iff** `x_{13} ≤ x_{12}`. Cross-multiplying (both denominators positive):
```
L_2 is dominated  ⟺  (b_3 − b_1)(m_1 − m_2) ≤ (b_2 − b_1)(m_1 − m_3).
```

**Proof.** Among the three lines, the min-winner sequence as `x` grows is: largest slope `L_1` on the far left, then possibly `L_2`, then smallest slope `L_3` on the far right (Corollary 2.2). `L_2` wins on a non-empty interval iff the `x` at which `L_1` yields to the *next* line is strictly less than the `x` at which that next line yields to `L_3`.

If `L_2` is *not* dominated, the hand-off order is `L_1 → L_2 → L_3`, occurring at `x_{12}` then `x_{23}`, and `L_2` wins on `(x_{12}, x_{23})`, which is non-empty iff `x_{12} < x_{23}`. One shows `x_{12} < x_{23} ⟺ x_{13} > x_{12}` (the three pairwise intersections are collinear in a precise sense: when `L_2` pokes below, `x_{13}` lies strictly to the right of `x_{12}`). Conversely, if `x_{13} ≤ x_{12}`, then by the time `L_1` would yield to `L_2` (at `x_{12}`), `L_3` is already at or below both (since `L_3` overtakes `L_1` at `x_{13} ≤ x_{12}`), so `L_2` is never strictly the minimum: it is dominated.

Formally, `L_2(x) ≥ min(L_1(x), L_3(x))` for all `x` iff `x_{13} ≤ x_{12}`. Evaluate `L_2 − L_1` and `L_2 − L_3`: `L_2` is below `L_1` for `x > x_{12}` and below `L_3` for `x < x_{23}`. For `L_2` to ever be below *both* simultaneously we need `x_{12} < x_{23}`. Algebra reduces `x_{12} < x_{23}` exactly to `x_{12} < x_{13}` (all three intersection abscissae satisfy a determinant identity), giving the stated criterion by contrapositive. The cross-multiplied form follows because `m_1 − m_2 > 0` and `m_1 − m_3 > 0`, so multiplying both sides preserves the inequality direction. ∎

**Corollary 3.2 (Division-free, sign-stable test).** Because the slopes are inserted in monotone order, the denominators `m_1 − m_2` and `m_1 − m_3` are both positive, so the cross-multiplied test `(b_3 − b_1)(m_1 − m_2) ≤ (b_2 − b_1)(m_1 − m_3)` is exact over the integers with **no division and no sign-flip ambiguity**. This is precisely why the implementation can avoid floats — and why losing the monotone-slope precondition (which could make a denominator negative) would break the inequality direction.

### 3.1 Worked Bad-Line Example

Take three lines in strictly decreasing slope order:

```
L1: m=2,  b=0
L2: m=0,  b=1
L3: m=-2, b=0
```

Intersections: `x_{12} = (b2−b1)/(m1−m2) = (1−0)/(2−0) = 0.5`; `x_{13} = (b3−b1)/(m1−m3) = (0−0)/(2−(−2)) = 0`. Since `x_{13} = 0 ≤ 0.5 = x_{12}`, Theorem 3.1 says `L2` is dominated. Check: at `x=0.5`, `L1=1`, `L2=1`, `L3=−1` — `L3` already wins, so `L2` never gets to be the strict minimum. Cross-multiplied: `(b3−b1)(m1−m2) = 0·2 = 0` and `(b2−b1)(m1−m3) = 1·4 = 4`; `0 ≤ 4` fires, confirming the pop. Now nudge `L2` down to `b=−2`: `x_{12} = −1`, `x_{13} = 0`, and `0 ≤ −1` is **false**, so `L2` is kept — and indeed at `x=0`, `L2 = −2` beats both `L1 = 0` and `L3 = 0`. The single inequality decides the entire envelope membership, and the cross-multiplied form computes it with integer arithmetic only.

### 3.2 Why the Monotone Order Keeps Denominators Positive

The cross-multiplication step multiplied both sides of `x_{13} ≤ x_{12}` by `(m_1 − m_2)(m_1 − m_3)`. Multiplying an inequality by a quantity preserves direction iff that quantity is positive. With `m_1 > m_2 > m_3`, both `m_1 − m_2 > 0` and `m_1 − m_3 > 0`, so their product is positive and the direction is preserved unconditionally. If slopes were *not* monotone — say a later-inserted line had a larger slope than an earlier one — then `m_1 − m_3` could be negative, the multiplication would flip the inequality, and the naive cross-test would pop exactly the wrong line. This is the formal justification for the engineering rule "the monotone CHT requires sorted slopes": it is not a convenience, it is what makes the exact integer comparison *valid*.

---

## 4. The Monotone CHT: Amortized O(1) Analysis

**Setup.** Lines inserted with non-increasing slopes; queries with non-decreasing `x`. The structure is a stack/deque of envelope lines plus a forward pointer `ptr`.

**Theorem 4.1 (Amortized O(1) insert).** Inserting `n` lines costs `O(n)` total time, hence `O(1)` amortized per insert.

**Proof (potential / accounting).** Each insert pushes exactly one line and pops zero or more. A line, once popped (deemed bad by Theorem 3.1), is never re-inserted. So the total number of pops over all `n` inserts is at most `n` (each pushed line is popped at most once). The work per insert is `O(1)` (push) plus `O(#pops in this insert)`, and `Σ #pops ≤ n`. Total `O(n)`. ∎

**Theorem 4.2 (Amortized O(1) query under monotone x).** Answering `Q` queries with non-decreasing `x` costs `O(Q + n)` total via the moving pointer.

**Proof.** By Corollary 2.2 the index of the min-winner is non-increasing in slope-order as `x` increases — concretely, with envelope lines stored in decreasing-slope order, the winner index is **non-decreasing** in `x`. The pointer `ptr` only advances (never retreats) across the sequence of non-decreasing queries. It advances at most `n − 1` times total over all queries (bounded by the deque length), plus `O(1)` work to check the stop condition per query. Total `O(Q + n)`. The correctness of "advance while the next line is ≤ the current at `x`" follows because the per-line values, as a function of position at fixed `x`, are unimodal (first decreasing then increasing) on the envelope, so a greedy forward scan finds the minimum. ∎

**Remark.** If queries are *not* monotone, the pointer argument fails (it would need to retreat), and one must binary-search instead (Section 5). This is the precise theoretical reason the monotone precondition is mandatory for the `O(1)` query.

### 4.1 The Potential Function, Made Explicit

Define the potential `Φ = (current deque length)`. Each insert performs `p` pops and one push, changing `Φ` by `1 − p`. The amortized cost of an insert is `actual + ΔΦ = (1 + p) + (1 − p) = 2 = O(1)`. Summed over `n` inserts, the total amortized cost is `2n`, and since `Φ ≥ 0` always and `Φ` starts at `0`, the total actual cost is `≤ total amortized = 2n = O(n)`. This is the same `O(n)` bound as Theorem 4.1, recovered through the potential method, and it makes the constant explicit: each line contributes at most two units of work (one push, one eventual pop) across its entire lifetime in the structure.

For the pointer query, take `Φ_q = (deque length − ptr)`. Each query advances `ptr` by `a ≥ 0` and does `a + 1` work; `ΔΦ_q = −a`. Amortized cost `= (a+1) − a = 1 = O(1)`. But inserts can *grow* the deque and reset `ptr` (when a pop drops below `ptr`), so the two potentials must be combined carefully; the clean statement is the one in Theorem 4.2: the pointer moves forward `O(n)` times *total* across all queries, because it is bounded by the maximum deque length, never retreating under monotone `x`.

### 4.2 Failure Under Non-Monotone Queries (Counterexample)

Consider envelope lines (decreasing slope) `L0: y=2x`, `L1: y=−2x`, with breakpoint at `x=0` (`L0` wins for `x<0`, `L1` for `x>0`). Query sequence `x = 5, −5`: at `x=5` the pointer advances to `L1` (value `−10`, correct). At the next query `x=−5`, the correct winner is `L0` (value `−10`), but the forward-only pointer is *already at `L1`* and the stop condition `next ≤ current` cannot move it backward — it returns `L1(−5) = 10`, which is wrong (the true min is `−10`). This concrete failure is the operational meaning of Theorem 4.2's monotone-`x` hypothesis: drop it and the pointer query is silently incorrect.

### 4.3 Full Monotone-Insertion Trace

Insert (decreasing slope) `L0:(3,9), L1:(1,1), L2:(0,−1), L3:(−1,1), L4:(−2,6)` — the Set A of the animation. Track the deque:

```
add L0           → deque [L0]                          (size 1, no test)
add L1           → deque [L0,L1]                        (size 2, no middle)
add L2: test(L0,L1,L2): (b2−b0)(m0−m1)=(−1−9)(3−1)=−20
                        (b1−b0)(m0−m2)=(1−9)(3−0)=−24
                 −20 ≤ −24 ? no → keep L1 → deque [L0,L1,L2]
add L3: test(L1,L2,L3): (b3−b1)(m1−m2)=(1−1)(1−0)=0
                        (b2−b1)(m1−m3)=(−1−1)(1−(−1))=−4
                 0 ≤ −4 ? no → keep L2 → deque [L0,L1,L2,L3]
add L4: test(L2,L3,L4): (b4−b2)(m2−m3)=(6−(−1))(0−(−1))=7
                        (b3−b2)(m2−m4)=(1−(−1))(0−(−2))=4
                 7 ≤ 4 ? no → keep L3 → deque [L0,L1,L2,L3,L4]
```

Here no line is popped (Set A is in convex position). A query at `x=2` scans the deque values `L0=15, L1=3, L2=−1, L3=−1, L4=2`; the minimum is `−1`. The pointer, having advanced through earlier monotone queries, lands at `L2` (or `L3`, a tie) and reports `−1`. This trace, reproduced exactly by the `animation.html`, shows the bad-line arithmetic that the code performs at each insertion and confirms the value against direct evaluation.

---

## 5. CHT with Binary Search: Correctness and Complexity

**Setup.** Lines inserted monotone in slope (so the deque holds envelope lines in slope order), queries at arbitrary `x`.

**Breakpoints.** Between consecutive envelope lines `L_{(t)}, L_{(t+1)}` (in slope order) lies a breakpoint `β_t = ` their intersection abscissa. By Corollary 2.2 the breakpoints are **sorted**: `β_1 < β_2 < … < β_{k−1}` for `k` envelope lines.

**Theorem 5.1 (Binary-search query).** For a query `x`, the min-winner is `L_{(t)}` where `t` is the unique index with `β_{t−1} ≤ x < β_t` (with `β_0 = −∞`, `β_k = +∞`). Binary search over the sorted breakpoints finds `t` in `O(log k) = O(log n)`.

**Proof.** Sortedness of breakpoints (Corollary 2.2) makes the predicate "`x < β_t`" monotone in `t`, so binary search applies. The winner on `[β_{t−1}, β_t)` is `L_{(t)}` by construction of the envelope. The breakpoints can be compared against `x` with the same cross-multiplied integer test (Section 3) to avoid floats: `x < β_t ⟺ x·(m_{(t)} − m_{(t+1)}) <` (cross-multiplied form), being careful with the denominator sign. ∎

**Complexity.** Inserts remain amortized `O(1)` (Theorem 4.1); each query is `O(log n)`. Total for the DP: `O(n + Q log n)`, and with `Q = n` (one query per state), `O(n log n)`.

### 5.1 Worked Binary-Search Query

Suppose the deque holds envelope lines (decreasing slope) `L0: y=2x`, `L1: y=0·x+1`, `L2: y=−2x+3` with breakpoints `β_0` (between `L0,L1`) and `β_1` (between `L1,L2`). Solve: `2x = 1 → β_0 = 0.5`; `1 = −2x+3 → β_1 = 1`. So `L0` wins on `(−∞, 0.5)`, `L1` on `(0.5, 1)`, `L2` on `(1, +∞)`. A query at `x = 0.7`: binary search finds `β_0 = 0.5 ≤ 0.7 < 1 = β_1`, so the winner is `L1`, value `1`. Verify: `L0(0.7)=1.4`, `L1(0.7)=1`, `L2(0.7)=1.6` — minimum is `1`, matching. The comparison `x < β_t` is done division-free: `x < (b_{t+1}−b_t)/(m_t−m_{t+1})` becomes `x·(m_t − m_{t+1}) < (b_{t+1} − b_t)` only after checking the sign of `m_t − m_{t+1}` (positive under decreasing slopes), preserving exactness.

### 5.2 The Dynamic CHT (Arbitrary Slope Order): Correctness Sketch

When slopes arrive unsorted, store lines in a balanced BST keyed by slope. On inserting `L`, its correct envelope position is between its slope-neighbors `L_prev` (larger slope) and `L_next` (smaller slope). First test whether `L` is itself dominated by `{L_prev, L_next}` using Theorem 3.1 with `(L_prev, L, L_next)`; if so, discard `L`. Otherwise insert `L`, then repeatedly remove now-dominated neighbors: walk left removing each `L_prev` made bad by its own predecessor and `L`, and walk right symmetrically. **Correctness** follows because the envelope is determined solely by local triples (Theorem 3.1 is a purely local test), and inserting one line can only newly dominate a contiguous run of its immediate neighbors — exactly the runs the left/right sweeps remove. Each removed line is gone forever, so the amortized number of removals is `O(1)` per insert; the BST operations cost `O(log n)`. This matches the C++ `LineContainer` design and gives `O(log n)` per insert and per query (queries binary-search the slope-keyed breakpoints). The hazard, as Section 3.2 warns, is that the bad-line test's denominators are no longer guaranteed positive in a naive transcription — the dynamic CHT must therefore handle the sign explicitly or compute intersections as carefully-ordered rationals, which is precisely why the (sign-agnostic) Li Chao tree is often preferred.

---

## 6. The Li Chao Tree: Correctness Proof

**Structure.** A segment tree over integer domain `[xlo, xhi]`. Each node `v` covers an interval `I_v = [l_v, r_v]` with midpoint `m_v = l_v + ⌊(r_v − l_v)/2⌋`, and stores one line `λ_v` (initially the `+∞` sentinel). Children split `I_v` at `m_v`.

**Insert procedure `Insert(v, f)`** for a new line `f`:
1. Let `g = λ_v`. WLOG (swap if needed) ensure `λ_v` is the lower of `f, g` **at `m_v`**; let `f'` be the other (the loser at the midpoint).
2. If `I_v` is a single point, return.
3. Determine on which side the loser `f'` could still be lower: compare `f'` and `λ_v` at `l_v` (left endpoint). If they disagree with the midpoint comparison (`f'` lower on the left), recurse `Insert(leftchild, f')`; else recurse `Insert(rightchild, f')`.

**Lemma 6.1 (Two lines cross at most once).** Distinct non-parallel lines intersect in exactly one point; parallel lines never cross. Hence on any interval, of two lines, the one that is lower at the midpoint is lower on at least the half of the interval containing the midpoint up to the crossing; the other line can be lower only on **one** of the two child intervals.

**Proof.** `f − g` is affine, so it has at most one zero; its sign is constant on each side of that zero. ∎

**Theorem 6.2 (Query correctness).** After any sequence of `Insert` operations, for every `x ∈ [xlo, xhi]`,
```
min over nodes v on the root-to-leaf path to x of λ_v(x)  =  E(x),
```
the true lower envelope value at `x` over all inserted lines.

**Proof (induction on the number of inserts).** *Invariant:* after inserting a set `F` of lines, for every `x`, the minimum of `λ_v(x)` over the root-to-`x` path equals `min_{f ∈ F} f(x)`.

*Base:* with no lines, all `λ_v = +∞`, and `min_{f ∈ ∅} = +∞`. Holds.

*Step:* assume the invariant holds for `F`, and insert a new line `f`. Fix any `x`; let `P` be its root-to-leaf path. We must show the path-min now equals `min(min_{F} f'(x), f(x))`. Consider the recursion of `Insert`. At the root `v`, after step 1, `λ_v` becomes the lower of (old `λ_v`, `f`) at `m_v`, and the loser `f'` is recursed into exactly the child where Lemma 6.1 says `f'` *could* beat the new `λ_v`. Two cases for the query point `x`:

- If `x` is on the side where the **winner** `λ_v` is guaranteed `≤` loser (the non-recursed side near the relevant region), then `λ_v(x)` already accounts for the better of the two contesting lines at `x`; the loser is provably not below `λ_v` at `x` on this side (by Lemma 6.1 and the midpoint/endpoint comparison), so dropping it loses nothing.
- If `x` is on the recursed side, the loser `f'` is pushed down and, by the inductive invariant applied to the child subtree (which now contains `f'`), the child path-min correctly incorporates `f'(x)`.

In both cases the path-min equals `min(previous path-min, f(x))`. By induction the invariant holds for `F ∪ {f}`. A query simply evaluates this path-min, so it returns `E(x)`. ∎

The crux is Lemma 6.1: because two lines cross once, the loser at the midpoint can only "escape" into a single child, so a single root-to-leaf descent per insert suffices, and a single descent per query reads every line that could be optimal at `x`.

### 6.1 Worked Li Chao Insertion Trace

Domain `[0, 7]` (so the root covers `[0,7]`, midpoint `3`). Insert in this order: `f = 0·x + 5` (constant 5), `g = 2·x + 0`, `h = −1·x + 6`.

- **Insert `f`:** root is the `+∞` sentinel; `f(3)=5 < +∞`, so root stores `f`, no loser to recurse. Root line `= f`.
- **Insert `g`:** at root midpoint `3`, `g(3)=6` vs `f(3)=5`; `f` stays (lower at midpoint), `g` is the loser. Where can `g` still win? At `x=0`: `g(0)=0 < f(0)=5` — `g` is lower on the left, so recurse `g` into the left child `[0,3]` (midpoint `1`). There the sentinel is `+∞`, `g(1)=2` wins, stored. Left child line `= g`.
- **Insert `h`:** at root midpoint `3`, `h(3)=3 < f(3)=5`, so `h` becomes the root line and `f` is the loser. At `x=0`: `f(0)=5` vs `h(0)=6` — `f` lower on the left, recurse `f` into `[0,3]` (midpoint `1`, currently holding `g`). There `f(1)=5` vs `g(1)=2`; `g` stays, `f` is the loser again; at `x=0`, `f(0)=5` vs `g(0)=0` — `g` lower, so `f` recurses into `[0,1]`... and so on until a leaf, where it may or may not be stored.

**Query at `x=0`:** path is root `[0,7]` → left `[0,3]` → left `[0,1]` → leaf `[0,0]`. Take the min of every stored line along the path: `h(0)=6` (root), `g(0)=0` (left), and whatever sits below. The minimum is `0` from `g` — correct, since at `x=0` the lines evaluate to `f=5, g=0, h=6`. The descent visited exactly one node per level (`O(log C)`), and the path-min recovered the true envelope value, illustrating Theorem 6.2.

### 6.2 The Swap Step Is What Maintains the Invariant

The subtle line of the insert is "if the new line is lower at the midpoint, swap it into the node and demote the old line to the loser." Without the swap, the node would keep a line that is *not* best at its own midpoint, violating the invariant that drives the correctness proof. The swap guarantees the node always holds the midpoint-optimal line among everything inserted into its subtree, so the path-min query is correct. A common implementation bug is to recurse the *new* line unconditionally instead of recursing whichever line lost at the midpoint — this breaks the invariant and produces wrong queries on roughly half the inputs (those where the new line should have displaced the old at the node).

### 6.3 Equivalence of Li Chao and CHT Outputs

**Proposition 6.3.** For any fixed line set `𝓛` and any query `x`, a correctly implemented Li Chao tree and a correctly implemented CHT (of either flavour) return the **same** value `E(x) = min_j(m_j x + b_j)`.

**Proof.** Both compute the lower envelope `E` by definition: the CHT maintains exactly the envelope lines (Theorem 3.1 removes precisely the non-envelope lines) and reports the winner at `x` (Theorem 4.2 / 5.1); the Li Chao tree's path-min equals `E(x)` (Theorem 6.2). Two algorithms that both compute the mathematically defined `E(x)` agree on every input. ∎

This equivalence is the basis of the cross-validation strategy in `senior.md` and `tasks.md`: run a min-CHT and a Li Chao tree on the same random lines/queries and assert equality; any discrepancy localizes a bug to whichever structure disagrees with the brute oracle. Because the two use *entirely different* internal mechanisms (slope-ordered deque vs midpoint-keyed segment tree), a bug in one is extremely unlikely to be mirrored in the other, making the agreement a strong correctness signal.

### 6.4 Determinism and Tie-Breaking

The *value* `E(x)` is unique, but the *argmin* (which line achieves it) need not be when lines tie at `x`. Both structures will report *some* minimizing line, but possibly different ones under ties — Li Chao reports whatever line happens to sit on the queried path; the CHT reports the deque slot the pointer/search lands on. If the DP needs a *canonical* argmin (e.g. smallest index, or lexicographically smallest reconstructed partition), the comparison must be augmented to break ties deterministically (prefer the line with smaller index, or smaller slope), and the *same* tie-break must be applied in both insert and query so the reported argmin is consistent. The value-level equivalence of Proposition 6.3 holds regardless; only the argmin requires this extra care, which is why `senior.md` Section 6 treats argmin recovery separately from value computation.

---

## 7. The Li Chao Tree: O(log C) Complexity

**Theorem 7.1.** Over domain size `C = xhi − xlo + 1`, each `Insert` and each `Query` runs in `O(log C)` time; `n` inserts and `Q` queries cost `O((n + Q) log C)`.

**Proof.** The tree has depth `⌈log₂ C⌉`. `Query` follows one root-to-leaf path, doing `O(1)` work per node: `O(log C)`. `Insert` recurses into **one** child per level (Lemma 6.1 guarantees the loser descends into a single side), doing `O(1)` comparison work per node, so it also follows a single root-to-leaf path: `O(log C)`. ∎

**Memory.** A static tree preallocates `O(C)` nodes (a heap layout uses `~2C`; a pointer/lazy layout uses `4C` worst case for the recursion structure). A **dynamic** Li Chao tree allocates a node only when `Insert` first descends into it, giving `O(n log C)` nodes total — the version used when `C` is astronomically large (e.g. `10⁹`), which would make a static tree infeasible.

**Comparison of the log factors.** The CHT's complexity carries `log n` (number of lines); Li Chao carries `log C` (coordinate range). After coordinate compression `C` can be reduced to `O(n + Q)`, making the two comparable; without compression, a very large coordinate domain makes Li Chao's per-op cost larger, which is the main asymptotic argument for the dynamic-CHT alternative when `C ≫ n`.

### 7.1 The Single-Descent Argument, Restated

The reason both `Insert` and `Query` are `O(log C)` and not `O(C)` is that each follows exactly one root-to-leaf path. For `Query` this is obvious (you go toward `x`). For `Insert` it relies on Lemma 6.1: after the midpoint comparison, the loser line can be lower than the (kept) winner on **at most one** of the two child intervals, because the two lines cross at most once and the midpoint already lies in the interval. Therefore the recursion branches into one child, never both. If two lines could cross twice (they cannot, being affine), the loser could escape into both children and the insert would be `O(C)` — so the entire `O(log C)` bound is a direct consequence of affineness. This is the deepest structural fact about the Li Chao tree and worth internalizing: **its efficiency is the affine "cross once" property, not a balancing argument.**

### 7.2 Numerical Precision (Real-Valued Lines)

When slopes and intercepts are reals (not integers), correctness depends on the comparison `f(m_v) < g(m_v)` at node midpoints. Let the lines have magnitude `≤ M` and the domain `≤ X`. The evaluated value `m·x + b` has magnitude `≤ MX + M`, and a single IEEE-754 double subtraction `f(m_v) − g(m_v)` has relative error `O(ε)` with `ε ≈ 2⁻⁵³`. The comparison is **safe** when the two values differ by more than the accumulated rounding, i.e. away from near-coincident lines. Near a tie (`|f(m_v) − g(m_v)| ≲ ε·MX`), the comparison may pick the "wrong" line — but since the two values are within rounding of each other, the *query error* is also bounded by `O(ε·MX)`, so the answer is correct to floating-point precision even if the stored line is not the mathematically exact winner. This graceful degradation (small numerical error rather than catastrophic wrong-line corruption) is another reason Li Chao is preferred for real-valued inputs over the intersection-based CHT, whose division near a near-degenerate intersection can produce an `O(1)` (not `O(ε)`) wrong-pop and a globally corrupted envelope.

**Proposition 7.3 (Bounded query error for real Li Chao).** If every midpoint comparison is decided correctly except when the two candidate values are within `δ`, then for any query `x` the returned value differs from the true envelope `E(x)` by at most `δ` (assuming Lipschitz-bounded line spacing). The error does not compound across levels because the path-min takes the smallest seen value, and any mis-stored line was within `δ` of the correct one at the relevant comparison point.

**Proof idea.** The path-min is a minimum over `O(log C)` correctly-or-near-correctly evaluated lines; the only way to miss the true winner is for it to have been demoted at a node where it was within `δ` of the kept line at that node's midpoint, but then by affineness it is within `δ`-order of the kept line at the query point too (over the node's interval), bounding the deficit. ∎

---

## 8. Segment Insertion in the Li Chao Tree

A line valid only on `[lo, hi] ⊆ [xlo, xhi]` is a **segment**.

**Procedure.** Decompose `[lo, hi]` into the `O(log C)` **canonical nodes** of the segment tree (the standard segment-tree range decomposition: nodes whose intervals are fully inside `[lo, hi]` and whose parents are not). At each canonical node, run the ordinary line-`Insert` confined to that node's subtree.

**Theorem 8.1.** Segment insertion costs `O(log² C)`; queries remain `O(log C)`.

**Proof.** The canonical decomposition yields `≤ 2⌈log₂ C⌉` nodes (standard segment-tree fact). At each, a line-`Insert` into a subtree of depth `O(log C)` costs `O(log C)` (Theorem 7.1). Product: `O(log² C)`. A query still follows one root-to-leaf path taking the min of every `λ_v` it passes; since each canonical insert only affects nodes on paths within `[lo, hi]`, the query correctness argument of Theorem 6.2 carries over, restricted to `x ∈ [lo, hi]` where the segment is defined. For `x ∉ [lo, hi]`, the segment was never inserted on `x`'s path, so it correctly does not participate. ∎

This is why the Li Chao tree is strictly more expressive than the CHT: it supports **range-restricted** lines, which the global-envelope CHT cannot represent.

### 8.1 Why a Query Outside a Segment's Range Is Unaffected

A segment `(m, b)` on `[lo, hi]` is inserted only into the canonical nodes whose intervals are subsets of `[lo, hi]`. For a query point `x ∉ [lo, hi]`, the root-to-leaf path to `x` passes through *no* canonical node of `[lo, hi]` below the level where `[lo, hi]` and `x` diverge — more precisely, the segment's line is stored only inside subtrees confined to `[lo, hi]`, and the path to an `x` outside that interval never enters those subtrees. Hence the segment's line is never read for an out-of-range query, and the query correctly returns the min over only those segments whose ranges cover `x`. This matches the `brute_seg_min` oracle (a line contributes iff `lo ≤ x ≤ hi`) used in the practice tasks.

### 8.2 The log² Factor Is Tight Without Extra Structure

Each segment touches `Θ(log C)` canonical nodes (a range can split into that many in the worst case — e.g. a range like `[1, C−2]` that misses one cell on each end), and a line-insert into a subtree of height `Θ(log C)` costs `Θ(log C)`. The product `Θ(log² C)` is therefore unavoidable for this approach. (Specialized "Li Chao tree beats" or persistent variants can sometimes amortize this, but the plain segment-insert is `Θ(log² C)`.) Queries remain `O(log C)` because a single root-to-leaf path visits one node per level regardless of how many segments were inserted.

---

## 9. Min vs Max: The Duality

**Proposition 9.1.** For any line set,
```
max_j (m_j x + b_j) = − min_j ( (−m_j) x + (−b_j) ).
```

**Proof.** `max_j v_j = − min_j (−v_j)` for any reals `v_j`; apply with `v_j = m_j x + b_j` and note `−(m_j x + b_j) = (−m_j)x + (−b_j)`. ∎

**Consequence.** A single lower-envelope implementation answers upper-envelope (max) queries by inserting `(−m_j, −b_j)` and negating the result. All convexity (Theorem 2.1) and monotone-winner (Corollary 2.2) statements dualize: the upper envelope is convex, and its winning slope is **non-decreasing** in `x`. The bad-line test's inequality direction flips correspondingly — which is exactly why negation (rather than hand-flipping comparisons) is the safer engineering choice (it reuses the *proven* min code unchanged).

### 9.1 Worked Duality Check

Lines `L0: y=x`, `L1: y=−x`, `L2: y=3`. The **upper** envelope (max) at `x=−5,0,5` is `max(−5,5,3)=5`, `max(0,0,3)=3`, `max(5,−5,3)=5` — i.e. `max(|x|, 3)`. Now run the **min** structure on the negated lines `(−1,0), (1,0), (0,−3)`: at `x=−5`, `min(5,−5,−3)=−5`; negate → `5`. At `x=0`, `min(0,0,−3)=−3`; negate → `3`. At `x=5`, `min(−5,5,−3)=−5`; negate → `5`. The negated-min reproduces the max exactly, confirming Proposition 9.1 and the engineering recipe (insert `(−m,−b)`, negate the answer) used in `interview.md` Challenge 3 and `tasks.md` Task 5.

### 9.2 The Two Conventions Are Not Symmetric in Bug-Risk

Although "negate" and "flip every comparison" are mathematically equivalent, they differ operationally. Negation touches exactly two well-defined spots: the insert (`m,b → −m,−b`) and the return (`v → −v`); the entire envelope/bad-line logic stays byte-for-byte identical to the proven min code. Flipping comparisons touches *every* `<` in the bad-line test, the pointer/binary-search stop conditions, and the sentinel sign — a dozen sites, each an opportunity for an inconsistent direction that the type checker cannot catch. Empirically the "flip" approach is the dominant source of min/max bugs; the formal recommendation is therefore to **always negate**.

---

## 10. The Cost Condition: Convexity / Monge / Concavity

The DP transition `dp[i] = g(i) + min_j (m_j x_i + b_j)` is *always* a lower-envelope query — that part needs no extra condition; it is a definitional rewrite. The deeper question is **when a more general cost `C(j, i)`** can be written in the line form, and that is governed by a convexity (Monge) condition.

**Definition 10.1 (Monge / quadrangle inequality).** A cost array `C(j, i)` satisfies the **quadrangle inequality (QI)** (is **Monge**) if for all `j₁ ≤ j₂` and `i₁ ≤ i₂`,
```
C(j₁, i₁) + C(j₂, i₂) ≤ C(j₁, i₂) + C(j₂, i₁).
```

**Theorem 10.2 (Linearizable costs).** If `C(j, i) = f(j) + h(i) + φ(j)·ψ(i)` with `ψ` monotone, then setting `x_i = ψ(i)`, `m_j = φ(j)`, `b_j = dp[j] + f(j)` makes the transition a lower-envelope query, and the resulting cost array is Monge precisely when the product term `φ(j)ψ(i)` has the right sign of cross-difference. The canonical instance `C(j,i) = (x_i − x_j)²` expands to `x_i² − 2x_j x_i + x_j²`: the `x_i²` is the `i`-only term `g(i)`, `−2x_j` is the slope `m_j`, and `x_j² + dp[j]` is the intercept `b_j` — exactly the linearization used throughout these files.

**Proof sketch.** The QI for `C(j,i) = const_i + const_j + φ(j)ψ(i)` reduces to `(φ(j₁) − φ(j₂))(ψ(i₁) − ψ(i₂)) ≤ 0`, i.e. `φ` and `ψ` vary oppositely. When this holds, the optimal `j` (the argmin) is **monotone** in `i`, which is the structural fact CHT exploits: as `x_i = ψ(i)` increases monotonically, the winning line's slope moves monotonically (Corollary 2.2), so old decisions are never revisited — the source of the amortized `O(1)`. ∎

**Why this matters.** The Monge/convexity condition is the *same* family of conditions underlying divide-and-conquer optimization and Knuth's optimization (Section 11). CHT is the special case where the cost is not merely Monge but **linearizable into a product `φ(j)ψ(i)`**, which lets us represent each decision as a literal line and use envelope geometry. When the cost is Monge but not linearizable, CHT does not directly apply, but D&C optimization (monotone argmin) still does.

### 10.1 Worked Monge Verification

Take `C(j, i) = (x_i − x_j)²` with `x` strictly increasing. Pick `j₁ < j₂` and `i₁ < i₂`. The QI requires `C(j₁,i₁) + C(j₂,i₂) ≤ C(j₁,i₂) + C(j₂,i₁)`. Substitute and expand using `C(j,i) = x_i² − 2x_j x_i + x_j²`. The `x_i²` and `x_j²` terms cancel pairwise (each appears once on both sides), leaving only the cross terms:

```
LHS cross: −2x_{j₁}x_{i₁} − 2x_{j₂}x_{i₂}
RHS cross: −2x_{j₁}x_{i₂} − 2x_{j₂}x_{i₁}
QI ⟺ −2(x_{j₁}x_{i₁} + x_{j₂}x_{i₂}) ≤ −2(x_{j₁}x_{i₂} + x_{j₂}x_{i₁})
   ⟺ x_{j₁}x_{i₁} + x_{j₂}x_{i₂} ≥ x_{j₁}x_{i₂} + x_{j₂}x_{i₁}
   ⟺ (x_{j₂} − x_{j₁})(x_{i₂} − x_{i₁}) ≥ 0.
```

Since `x` is increasing and `j₁ < j₂`, `i₁ < i₂`, both factors are positive, so the product is `≥ 0` and the QI holds. Thus `(x_i − x_j)²` is Monge, the argmin is monotone (Theorem 11.1), and CHT applies — exactly the linearization used in the worked DP throughout these files. The cross-term `−2x_j x_i` is precisely the `φ(j)ψ(i)` product (`φ(j) = −2x_j`, `ψ(i) = x_i`) that becomes the line's slope-times-query.

### 10.2 A Non-Monge (CHT-Inapplicable) Cost

Contrast with `C(j, i) = |x_i − x_j|`. This is *not* a single line in `x_i`: it is `x_i − x_j` for `x_i ≥ x_j` and `x_j − x_i` otherwise — a V-shaped function, the *maximum* of two lines `+(x_i − x_j)` and `−(x_i − x_j)`. A lower-envelope query against absolute-value costs would require maintaining two line families (one per branch) or a different structure. The lesson: linearizability is a real restriction; not every Monge-looking cost factors into a product, and `|·|`, `(·)³`, and general convex `(·)` of a difference need either piecewise handling or a fall-back to D&C optimization.

### 10.3 A General Recipe for Linearization

To test whether a transition cost `C(j, i)` is CHT-amenable, write it as a polynomial/expression and isolate the dependence on the query variable. The cost is a single line in `x_i` iff it has the form
```
C(j, i) = A(j)·x_i + B(j) + g(i),
```
i.e. **degree exactly 1 in `x_i`** (a linear term plus an `i`-only term `g(i)` plus a `j`-only intercept piece). Then `m_j = A(j)`, `b_j = B(j) + dp[j]`, and `g(i)` is added outside the min. Concretely:

| Cost `C(j,i)` | `m_j` | `b_j` (with `dp[j]`) | `g(i)` | CHT? |
|---------------|-------|----------------------|--------|------|
| `(x_i − x_j)²` | `−2x_j` | `dp[j] + x_j²` | `x_i²` | yes |
| `a·x_i·x_j + p(j) + q(i)` | `a·x_j` | `dp[j] + p(j)` | `q(i)` | yes |
| `x_j·x_i² + …` | — | — | — | no (degree 2 in `x_i`) |
| `|x_i − x_j|` | — | — | — | no (two branches) |

The single discriminating question is "is the cost linear (degree 1) in the query variable `x_i`, after pulling out terms that depend only on `i`?" If yes, CHT applies; if `x_i` appears squared, absolute-valued, or otherwise non-affinely, it does not (without splitting into multiple line families). This is the operational form of the Monge-plus-linearizable condition of Theorem 10.2, and it is exactly the classification task in `tasks.md` Task 10 and `interview.md` S9.

---

## 11. Relation to Divide-and-Conquer and Knuth Optimizations

All three are DP speedups resting on monotonicity of the optimal decision.

| Optimization | Transition | Enabling condition | Complexity |
|--------------|-----------|--------------------|------------|
| **CHT / Li Chao** | `dp[i] = g(i) + min_j (m_j ψ(i) + b_j)` | cost linearizes into `φ(j)ψ(i)` (a Monge special case) | `O(n log n)` or `O(n)` |
| **Divide & Conquer (sibling `08`)** | `dp_t[i] = min_k (dp_{t-1}[k] + C(k,i))` | `opt(i)` monotone non-decreasing (implied by Monge `C`) | `O(t · n log n)` |
| **Knuth (sibling `09`)** | `dp[i][j] = min_{i≤k<j}(dp[i][k]+dp[k+1][j]) + w(i,j)` | `w` Monge + monotone → `opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]` | `O(n²)` |

**Theorem 11.1 (Monge ⇒ monotone argmin).** If `C(j, i)` is Monge (Definition 10.1), then for the transition `dp[i] = min_j (dp[j] + C(j,i))`, the smallest optimal `j`, call it `opt(i)`, is non-decreasing in `i`.

**Proof.** Suppose `i₁ < i₂` but `opt(i₁) > opt(i₂)`; set `j₂ = opt(i₂) < j₁ = opt(i₁)`. Optimality gives `dp[j₁] + C(j₁,i₁) ≤ dp[j₂] + C(j₂,i₁)` and `dp[j₂] + C(j₂,i₂) ≤ dp[j₁] + C(j₁,i₂)`. Adding: `C(j₁,i₁) + C(j₂,i₂) ≤ C(j₂,i₁) + C(j₁,i₂)`. But Monge with `j₂ < j₁` and `i₁ < i₂` says `C(j₂,i₁) + C(j₁,i₂) ≤ C(j₂,i₂) + C(j₁,i₁)`... combining yields equality throughout, so `j₂` is also optimal for `i₁`, contradicting minimality of `opt(i₁)`. Hence `opt` is monotone. ∎

This monotone-argmin theorem is the shared backbone: **D&C optimization** uses it directly (recursing on the `opt` range), **Knuth** uses its 2D refinement, and **CHT** uses the geometric incarnation (monotone winning slope, Corollary 2.2) when the cost additionally linearizes. Choosing among them is a matter of *which* structural form the cost takes:

- linearizes into lines → **CHT/Li Chao** (fastest constants);
- Monge but not linear, layered `dp_t[i]` → **D&C optimization**;
- Monge interval-merge `dp[i][j]` → **Knuth**.

### 11.1 How D&C Optimization Uses Monotone Argmin

For a layered transition `dp_t[i] = min_k (dp_{t-1}[k] + C(k,i))` with `opt(i)` non-decreasing in `i` (guaranteed by Theorem 11.1 when `C` is Monge), the divide-and-conquer recursion is:

```
solve(iL, iR, kL, kR):                 # compute dp_t[i] for i in [iL,iR], opt(i) in [kL,kR]
  if iL > iR: return
  mid = (iL + iR) / 2
  find best k* in [kL, kR] minimizing dp_{t-1}[k] + C(k, mid)   # O(kR - kL)
  dp_t[mid] = that minimum;  opt(mid) = k*
  solve(iL, mid-1, kL, k*)             # left half's opt is <= k*
  solve(mid+1, iR, k*, kR)             # right half's opt is >= k*
```

The monotonicity `opt(i) ≤ opt(i+1)` is exactly what makes the split `[kL, k*]` and `[k*, kR]` valid. Each level of the recursion does `O(n)` total work scanning `k`-ranges that sum to `O(n)`, and there are `O(log n)` levels, so one layer costs `O(n log n)`; `t` layers cost `O(t n log n)`. CHT achieves `O(n)` per layer when the cost linearizes — strictly better constants — but D&C optimization needs only the *monotone argmin*, not the line form, so it covers Monge costs that do not factor into a product (e.g. some entropy-like or `|·|`-based costs after suitable reformulation).

### 11.2 How Knuth Refines It in 2D

Knuth's optimization targets the interval DP `dp[i][j] = min_{i≤k<j}(dp[i][k] + dp[k+1][j]) + w(i,j)`. When `w` is Monge and monotone, the 2D argmin satisfies the **sandwich**

```
opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j].
```

Filling the table by increasing interval length and restricting the `k`-scan for `dp[i][j]` to `[opt[i][j-1], opt[i+1][j]]` makes the total scan work telescope to `O(n²)` instead of `O(n³)` — a classic amortization where the bounds for adjacent cells overlap and the total range scanned across a diagonal is `O(n)`. This is the 2D analogue of the 1D monotone-argmin used by both CHT (via slope monotonicity) and D&C optimization. All three are facets of the same quadrangle-inequality structure (Theorem 11.1); the difference is whether the DP is a 1D linear-min (CHT), a layered 1D min (D&C), or a 2D interval merge (Knuth).

---

## 12. Lower Bounds and the Output-Size Argument

**Proposition 12.1 (Envelope complexity).** The lower envelope of `n` lines has at most `n` segments (each line contributes at most one maximal winning interval) and exactly `≤ n − 1` breakpoints. Computing the full envelope from scratch (all lines known) takes `Θ(n log n)` in the comparison model: it is equivalent to sorting by slope plus a linear Graham-scan-style pass, and a reduction from sorting shows `Ω(n log n)` is necessary when slopes are unsorted.

**Proof.** Each line is convex-position on the envelope at most once (Section 2), bounding segments by `n`. The `Ω(n log n)` lower bound: given `n` numbers to sort, create lines `L_j(x) = a_j x + a_j²/?`... more cleanly, the **upper/lower envelope of `n` lines is dual to the convex hull of `n` points**, and convex hull has an `Ω(n log n)` lower bound by reduction from sorting (Shamos). Hence so does envelope construction with unsorted slopes. ∎

**Consequence for the structures.**
- If slopes arrive **sorted**, the monotone CHT builds the envelope in `O(n)` — beating the `Ω(n log n)` bound *because the sorting work is already done* (the input order supplies it).
- If slopes are **unsorted**, you pay `Ω(n log n)` somewhere: either sorting up front (then monotone CHT) or `O(log n)` per insert in a dynamic CHT, or `O(log C)` per insert in Li Chao. None can be `o(n log n)` for unsorted slopes with arbitrary queries, matching the lower bound (up to the `log C` vs `log n` distinction).
- Querying needs `Ω(1)` per query trivially; `O(log)` per query is optimal for arbitrary `x` against `n` breakpoints by the comparison-search lower bound.

So the structures are **optimal up to constants**: `O(n)` total when order is given, `Θ(n log n)`/`Θ(n log C)` when it is not.

### 12.1 The Convex-Hull Duality, Explicit

The name "Convex Hull Trick" comes from a point-line duality. Map each line `y = m·x + b` to the **point** `(m, b)` in a dual plane. The lines that appear on the *lower envelope* (minimum) correspond exactly to the points on a specific chain of the **convex hull** of the dual point set — the lower hull when sorted by the dual `x`-coordinate (slope). A line is dominated (never the envelope minimum) iff its dual point lies strictly inside the hull. The bad-line test (Section 3) is, in dual terms, the orientation/turn test that Graham's scan uses to decide whether a point is a hull vertex: "does adding the new point make the previous point a non-vertex (a right/left turn of the wrong sign)?" — pop it. This is why CHT code looks like an incremental convex-hull construction (a monotone stack with a turn test), and why the `Ω(n log n)` convex-hull lower bound transfers directly (Proposition 12.1).

### 12.2 Query Lower Bound

For arbitrary query `x` against `k` envelope segments, locating the owning segment is a predecessor/search problem over `k` sorted breakpoints. In the comparison model, answering an arbitrary point-location query requires `Ω(log k)` comparisons in the worst case (by the same decision-tree argument that gives the binary-search lower bound). Hence the CHT binary-search query (`O(log n)`) and the Li Chao descent (`O(log C)`) are optimal for arbitrary queries up to the `log n` vs `log C` distinction; only the *monotone-query* special case escapes the `log` via amortization (Theorem 4.2), because there the queries collectively supply sorted order, just as sorted slopes let insertion escape the `n log n` envelope-build bound.

### 12.3 Envelope Size vs Input Size

A subtle point: the *number of envelope segments* `k` can be far smaller than the *number of inserted lines* `n` (many lines are dominated). The CHT exploits this — its deque holds only the `k` envelope lines, so query binary search is `O(log k) ≤ O(log n)`. The Li Chao tree, by contrast, does **not** prune dominated lines explicitly; it absorbs them into the tree, and its `O(log C)` bound is insensitive to `k`. When `k ≪ n` (heavy domination) the CHT's working set is smaller and its queries faster; when `k ≈ n` (little domination, lines in convex position) both are comparable. This is a second axis (beyond order assumptions) along which the CHT can win: a small envelope. But it cannot be relied on adversarially — an input can force `k = n` — so the worst-case bounds of Section 14 stand.

### 12.4 Connection to Lower-Envelope-of-Functions Generalizations

The lines here are degree-1 (affine). For higher-degree curves (e.g. parabolas, or general functions that pairwise cross `≤ s` times), the lower envelope has complexity governed by **Davenport–Schinzel sequences**: `λ_s(n)` segments for functions crossing `≤ s` times, which is `n` for lines (`s=1`, giving the `≤ n` segments of Proposition 12.1) and slightly superlinear for higher `s`. The Li Chao tree's "cross at most once" argument (Lemma 6.1) is exactly the `s=1` case; generalizing it to `s>1` requires storing more than one function per node or a different structure, and the per-operation cost rises with `λ_s`. This situates the CHT/Li Chao firmly in the simplest (affine) corner of a rich computational-geometry hierarchy — which is precisely why it is so efficient.

---

## 13. Summary

- **Definition.** The technique answers `min_j (m_j x + b_j)` — the **lower envelope** of lines — which is concave and piecewise-linear (Theorem 2.1), with the **winning slope monotone in `x`** (Corollary 2.2). That monotonicity is the engine behind every fast query.
- **Bad-line test.** With slopes inserted in monotone order, the middle line `L_2` is dominated iff `(b_3−b_1)(m_1−m_2) ≤ (b_2−b_1)(m_1−m_3)` — a **division-free, sign-stable, exact integer** test (Theorem 3.1, Corollary 3.2). Monotone slopes are what keep the denominators positive and the comparison exact.
- **Monotone CHT.** Inserts are amortized `O(1)` (each line popped once, Theorem 4.1); queries under monotone `x` are amortized `O(1)` via a never-retreating pointer (Theorem 4.2). Without monotone queries, binary search the sorted breakpoints in `O(log n)` (Theorem 5.1).
- **Li Chao tree.** Correct by induction using "two lines cross once" (Lemma 6.1, Theorem 6.2); `O(log C)` per insert/query because the midpoint loser descends into a single child (Theorem 7.1). Supports **segment** insertion in `O(log² C)` (Theorem 8.1) — strictly more general than CHT.
- **Min/max duality.** `max = −min(−·)` (Proposition 9.1); negate to reuse the proven min code.
- **Cost condition.** A general cost is CHT-amenable when it **linearizes into `φ(j)ψ(i)`**, a special case of the **Monge / quadrangle inequality** that forces the **argmin to be monotone** (Theorem 11.1) — the same condition underlying D&C optimization and Knuth's optimization (Section 11).
- **Optimality.** Envelope construction is `Θ(n log n)` for unsorted slopes (dual to convex hull, `Ω(n log n)` from sorting), and `O(n)` when slopes arrive sorted — so the structures are optimal up to constants (Section 12).

### Complexity Cheat Table

| Task | Structure | Time | Note |
|------|-----------|------|------|
| Insert, monotone slope | monotone CHT | amortized `O(1)` | each line popped once |
| Query, monotone `x` | monotone CHT (pointer) | amortized `O(1)` | pointer never retreats |
| Query, arbitrary `x` | CHT (binary search) | `O(log n)` | sorted breakpoints |
| Insert/query, arbitrary order | Li Chao tree | `O(log C)` | two-lines-cross-once |
| Insert a segment | Li Chao tree | `O(log² C)` | canonical decomposition |
| Full envelope, unsorted slopes | any | `Θ(n log n)` | dual to convex hull |
| Full envelope, sorted slopes | monotone CHT | `Θ(n)` | input supplies the order |

### Closing Notes

- **Convexity (Section 2)** is the master fact: every query method (pointer, binary search, Li Chao descent) is a way of exploiting that the winning line moves monotonically.
- **The monotone-slope precondition (Section 3)** is not cosmetic — it keeps the cross-product test's sign stable; lose it and you must move to a dynamic CHT or Li Chao.
- **Lemma 6.1 ("two lines cross once") (Section 6)** is the entire reason Li Chao's insert touches one child per level, giving `O(log C)`.
- **The Monge condition (Sections 10–11)** unifies CHT with its sibling optimizations: all three exploit a monotone optimal decision; CHT is the linearizable, geometric special case.
- **Equivalence (Proposition 6.3)** of CHT and Li Chao at the *value* level is the foundation of cross-validation; they differ only in *argmin* under ties, which is why argmin recovery needs an explicit, consistent tie-break.
- **Numerical precision (Proposition 7.3)** degrades gracefully for real-valued Li Chao (error `O(ε·MX)`), unlike the intersection-based CHT whose division near a degenerate crossing can corrupt the envelope globally — the formal case for preferring Li Chao on real inputs.
- **The linearization recipe (Section 10.3)** reduces "does CHT apply?" to "is the cost degree-1 in the query variable after removing `i`-only terms?" — the single operational test behind every classification task in these files.
- **Davenport–Schinzel (Section 12.4)** places affine lower envelopes (`λ_1(n) = n` segments) at the simplest end of a hierarchy; the `O(log C)` Li Chao bound is exactly the affine "cross once" case, and higher-degree curves cost strictly more.

Foundational references: cp-algorithms.com (CHT and Li Chao tree); Flajolet/standard computational-geometry texts for lower-envelope/convex-hull duality (Shamos lower bound); the quadrangle-inequality / Monge literature (Yao 1980 for Knuth's optimization, Aggarwal et al. for the SMAWK/totally-monotone matrices behind D&C optimization). Sibling topics: `08-divide-and-conquer-optimization`, `09-knuth-optimization`.

---

## 14. Worked Complexity Comparison

Consider the canonical DP `dp[i] = g(i) + min_{j<i}(m_j x_i + b_j)` with `n` states, one query per state, and a coordinate range `C`. The following table puts the asymptotics of every approach side by side, with the constant-factor reality that decides production choices.

| Approach | Per-insert | Per-query | Total | Constant factor | Preconditions |
|----------|-----------|-----------|-------|-----------------|---------------|
| Naive inner loop | — | `O(n)` | `O(n²)` | tiny per op, but `n²` ops | none |
| Monotone CHT (pointer) | amort. `O(1)` | amort. `O(1)` | `O(n)` | smallest; flat arrays | sorted slopes + sorted `x` |
| Monotone CHT (binary search) | amort. `O(1)` | `O(log n)` | `O(n log n)` | small | sorted slopes |
| Dynamic CHT (BST) | `O(log n)` | `O(log n)` | `O(n log n)` | medium (BST overhead) | none (but sign care) |
| Li Chao (static) | `O(log C)` | `O(log C)` | `O(n log C)` | medium; `~4C` memory | bounded range |
| Li Chao (dynamic) | `O(log C)` | `O(log C)` | `O(n log C)` | medium; lazy nodes | none |
| Li Chao (segments) | `O(log² C)` | `O(log C)` | `O(n log² C)` | larger | range-restricted lines |

**Reading the table.** For `n = 10⁶` and `C = 2·10⁶` (`log C ≈ 21`): the naive approach needs `10¹²` operations (infeasible); the monotone CHT needs `~10⁶` (milliseconds); Li Chao needs `~2·10⁷` (tens of milliseconds). The monotone CHT's `O(n)` is asymptotically and constant-factor optimal — *when its preconditions hold*. The whole engineering discipline of these documents is: prove the preconditions to earn the `O(n)`, or pay the `log` factor for the robustness of Li Chao.

**Why the lower bounds matter here.** Section 12 showed that unsorted-slope envelope construction is `Ω(n log n)` (convex-hull duality) and arbitrary point-location is `Ω(log)` per query. The table's `O(n log n)` and `O(n log C)` rows are therefore *optimal up to constants* for their respective input assumptions; only by *adding the assumption* "input arrives sorted" can the monotone CHT reach `O(n)` — the sorting work is supplied for free by the input order, exactly as Corollary 2.2's monotone winner is supplied for free by monotone queries. There is no algorithm that beats `O(n)` (you must at least read the `n` lines) or that beats `O(n log n)` for unsorted slopes with arbitrary queries. The structures presented are thus the end of the line: provably optimal, with the only remaining freedom being the constant factor and the robustness/assumption trade-off.

This closes the loop with the practical guidance in `senior.md`: choose the monotone CHT only when you can *prove* the order assumptions (and reap the optimal `O(n)`), and otherwise default to the Li Chao tree, accepting an optimal-up-to-`log` cost in exchange for never having to verify a precondition that an adversarial input might violate.

### 14.1 Why the theory dictates the engineering

Each engineering rule in `senior.md` traces back to a theorem here. The cross-multiplied integer test is exact **only** because monotone slopes keep the denominators positive (Corollary 3.2); lose that and the dynamic CHT or Li Chao is forced. The pointer query is correct **only** under monotone queries (Theorem 4.2); a single non-monotone query breaks it (Section 4.2's counterexample). Li Chao's `O(log C)` rests entirely on affineness — "two lines cross once" (Lemma 6.1) — which is why it never branches into both children. And the choice of *which* optimization (CHT, D&C, Knuth) is governed by the Monge/linearizability hierarchy (Sections 10–11). The practitioner who internalizes these four facts — sign stability, monotone-query necessity, affine single-descent, and the Monge condition — can derive every implementation rule rather than memorizing them, and can recognize instantly when an input violates an assumption the fast variant depends on.

### 14.2 The four load-bearing theorems

If you remember nothing else from this document, remember these four results and their consequences:

1. **Theorem 2.1 / Corollary 2.2 (convexity, monotone winner).** The lower envelope is convex and the winning slope is monotone in `x`. *Consequence:* every fast query (pointer, binary search, Li Chao descent) is a way to exploit this monotonicity.
2. **Theorem 3.1 (bad-line test).** A middle line is dominated iff `(b3−b1)(m1−m2) ≤ (b2−b1)(m1−m3)`, exact over integers under monotone slopes. *Consequence:* the entire CHT pruning is one division-free inequality.
3. **Theorem 6.2 + Lemma 6.1 (Li Chao correctness, single descent).** The path-min equals the true envelope, and the insert recurses into one child because affine lines cross once. *Consequence:* `O(log C)` per operation, arbitrary order.
4. **Theorem 11.1 (Monge ⇒ monotone argmin).** A Monge cost forces the optimal decision to move monotonically. *Consequence:* CHT, D&C optimization, and Knuth are facets of one structural fact, chosen by transition shape.

These four, plus the duality `max = −min(−·)` (Proposition 9.1), are the complete theoretical toolkit; everything else in the topic is engineering on top of them.
