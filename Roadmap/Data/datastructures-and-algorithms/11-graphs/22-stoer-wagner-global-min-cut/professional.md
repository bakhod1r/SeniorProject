# Stoer-Wagner Global Minimum Cut — Mathematical Foundations and Complexity Theory

## Table of Contents

1. [Formal Definitions](#1-formal-definitions)
2. [The Maximum-Adjacency (Legal) Ordering](#2-the-maximum-adjacency-legal-ordering)
3. [The Cut-of-the-Phase Lemma — Full Proof](#3-the-cut-of-the-phase-lemma--full-proof)
4. [Merge Correctness and the Reduction](#4-merge-correctness-and-the-reduction)
5. [Global Correctness of the Algorithm](#5-global-correctness-of-the-algorithm)
6. [Complexity — O(V³) Time, O(V²) Space](#6-complexity--ov-time-ov-space)
7. [Heap Variant Complexity](#7-heap-variant-complexity)
8. [Relationship to Max-Flow / Min-Cut](#8-relationship-to-max-flow--min-cut)
9. [Comparison with Alternatives](#9-comparison-with-alternatives)
10. [Worked Phase Trace](#10-worked-phase-trace)
11. [Reference Implementations](#11-reference-implementations)
12. [Summary](#12-summary)

---

## 1. Formal Definitions

Let `G = (V, E, w)` be a finite **undirected** graph with `n = |V|` vertices and a weight function `w : E → ℝ≥0` extended to all unordered pairs by `w(u, v) = 0` when `{u, v} ∉ E`. Weights are **non-negative**; the algorithm's correctness depends on this.

**Definition 1.1 (Cut).** A *cut* is a partition of `V` into two non-empty sets `(S, V\S)`. Its *weight* is

```text
w(S, V\S) = Σ  w(u, v)   over all u ∈ S, v ∈ V\S.
```

**Definition 1.2 (Global minimum cut).** The *global minimum cut* is a cut of minimum weight over all `2^{n-1} - 1` partitions:

```text
λ(G) = min over non-empty S ⊊ V of w(S, V\S).
```

**Definition 1.3 (s-t cut).** For distinct `s, t ∈ V`, an *s-t cut* is a cut `(S, V\S)` with `s ∈ S` and `t ∈ V\S`. The *minimum s-t cut* `c(s, t)` is the smallest weight among all s-t cuts. Note `λ(G) = min_{s≠t} c(s, t)`, but we will not need to try all pairs.

**Definition 1.4 (Connection to a set).** For `A ⊆ V` and `v ∉ A`,

```text
w(A, v) = Σ_{a ∈ A} w(a, v),
```

the total weight of edges between `v` and the set `A`. This is the *key* the algorithm maximizes.

**Definition 1.5 (Merge / contraction).** Merging vertices `s, t` produces a graph `G/{s,t}` on `V \ {t}` where the merged vertex `s` inherits all edges: for every `x ∉ {s, t}`, the new weight is `w'(s, x) = w(s, x) + w(t, x)`. All cuts of `G` that keep `s` and `t` on the **same** side correspond bijectively, with equal weight, to cuts of `G/{s,t}`.

---

## 2. The Maximum-Adjacency (Legal) Ordering

**Definition 2.1 (Legal / MA ordering).** Given a start vertex `a₁`, a *maximum-adjacency ordering* `a₁, a₂, …, a_n` of `V` is built greedily: having chosen `A_i = {a₁, …, a_i}`, the next vertex is

```text
a_{i+1} = argmax_{v ∉ A_i}  w(A_i, v).
```

Ties are broken arbitrarily. We write `A_i = {a₁, …, a_i}` for the prefix set.

This ordering is the structural twin of Prim's MST and of Dijkstra: a greedy frontier expansion keyed on a "connection" value. The distinguishing feature is that the key is the **sum of all edges** to the frontier `A_i`, which is precisely a cut quantity.

**Property 2.2.** By construction, for every `i`, `w(A_i, a_{i+1}) ≥ w(A_i, v)` for all `v ∉ A_i`. The last vertex `a_n` therefore had, at the moment of its inclusion, the *largest remaining* connection — yet it was added *last*, meaning every other vertex had an even larger pull earlier. Intuitively `a_n` is the most loosely attached vertex.

---

## 3. The Cut-of-the-Phase Lemma — Full Proof

This is the heart of the algorithm. Let `a₁, …, a_n` be a maximum-adjacency ordering. Set `s = a_{n-1}` and `t = a_n`. The **cut-of-the-phase** is `({t}, V\{t})`, of weight `w(A_{n-1}, t)`.

**Lemma 3.1 (Cut-of-the-phase).** `({t}, V\{t})` is a *minimum `s-t` cut* of `G`. Equivalently,

```text
w({t}, V\{t}) = c(s, t) = min weight of any cut separating s = a_{n-1} from t = a_n.
```

**Proof.** Let `C` be an *arbitrary* `s-t` cut. We show `w(C) ≥ w({t}, V\{t})`; since `({t}, V\{t})` is itself an `s-t` cut (as `s ≠ t`), this proves it is a minimum one.

For a vertex `a_i` (`i ≥ 2`) we say `a_i` is **active** with respect to `C` if `a_i` and `a_{i-1}` lie on *opposite* sides of `C` — i.e. the cut "separates" `a_i` from its immediate predecessor in the ordering. Because `s = a_{n-1}` and `t = a_n` are on opposite sides of any `s-t` cut, **`a_n = t` is active**.

Define, for each active vertex `a_i`, the quantity

```text
w(A_{i-1}, a_i)   =   weight of edges from a_i back into the prefix A_{i-1}.
```

We prove by induction over the active vertices (in increasing index order) the key inequality:

> **Claim.** For every active `a_i`,
> ```text
> w(A_{i-1}, a_i)  ≤  w(C_i),
> ```
> where `C_i` is the cut `C` *restricted* to the induced subgraph on `A_i = {a₁, …, a_i}` (i.e. the weight of edges inside `A_i` that cross `C`).

*Base case.* Let `a_i` be the **first** active vertex. Then `a₁, …, a_{i-1}` are all on the **same** side of `C` (none was active), and `a_i` is on the other side. Hence every edge from `a_i` into `A_{i-1}` crosses `C`, so

```text
w(A_{i-1}, a_i) = w(C_i).      (all such edges are cut; nothing else in A_i is cut)
```

Thus `w(A_{i-1}, a_i) ≤ w(C_i)` holds with equality. ✓

*Inductive step.* Let `a_i` be an active vertex and let `a_j` (`j < i`) be the **previous** active vertex. Assume the claim for `a_j`:

```text
w(A_{j-1}, a_j) ≤ w(C_j).            (IH)
```

We bound `w(A_{i-1}, a_i)`. Split the prefix `A_{i-1}` into `A_{j-1}` and `{a_j, …, a_{i-1}}`:

```text
w(A_{i-1}, a_i) = w(A_{j-1}, a_i) + w({a_j,…,a_{i-1}}, a_i).      (*)
```

By the **maximum-adjacency property** applied at step `j` (where `a_j` was chosen over `a_i`, both being outside `A_{j-1}`):

```text
w(A_{j-1}, a_i) ≤ w(A_{j-1}, a_j).      (MA property, since a_j = argmax beat a_i)   (**)
```

Now consider `w(C_i) − w(C_j)`: this is the weight of cut edges that lie inside `A_i` but not inside `A_j`, i.e. edges from `{a_j, …, a_{i-1}, a_i}` that cross `C` and touch `a_i`'s side. Since `a_j, …, a_{i-1}` are all on the **same** side as each other and as `a_i`'s *opposite* (no active vertex strictly between `a_j` and `a_i`), every edge from `a_i` to `{a_j, …, a_{i-1}}` crosses `C`. Therefore

```text
w({a_j,…,a_{i-1}}, a_i) ≤ w(C_i) − w(C_j).      (***)
```

Combine (*), (**), (***), and the IH:

```text
w(A_{i-1}, a_i)
   = w(A_{j-1}, a_i) + w({a_j,…,a_{i-1}}, a_i)
   ≤ w(A_{j-1}, a_j) + (w(C_i) − w(C_j))          [by (**) and (***)]
   ≤ w(C_j)         + (w(C_i) − w(C_j))            [by IH]
   = w(C_i).
```

This proves the claim for `a_i`, completing the induction. ✓

**Finishing the proof of Lemma 3.1.** Apply the claim to the active vertex `a_n = t` (it is active in any `s-t` cut). With `i = n`, `A_{i-1} = A_{n-1} = V \ {t}` and `C_n = C` (the whole cut). The claim gives

```text
w(A_{n-1}, t) ≤ w(C).
```

But `w(A_{n-1}, t) = w({t}, V\{t})` is exactly the cut-of-the-phase. Since `C` was an arbitrary `s-t` cut, the cut-of-the-phase has weight no larger than any `s-t` cut, hence it **is** a minimum `s-t` cut. ∎

> **Why non-negativity matters.** Step (***) and the base case both rely on "cut edges contribute non-negatively." With negative weights, `w(A_{i-1}, a_i)` could exceed the cut weight, and the MA property `(**)` no longer bounds cut contributions. The lemma genuinely fails for graphs with negative edges.

---

## 4. Merge Correctness and the Reduction

**Lemma 4.1 (Merge preserves the relevant cuts).** Let `G' = G/{s,t}` be `G` with `s` and `t` merged. Then

```text
λ(G) = min( c_G(s, t),  λ(G') ),
```

where `c_G(s, t)` is the minimum `s-t` cut in `G`.

**Proof.** Any global min cut `C` of `G` either separates `s` and `t`, or does not.

- **If `C` separates `s` and `t`:** then `C` is an `s-t` cut, so `w(C) ≥ c_G(s, t)`. Since `C` is a *minimum* cut, `λ(G) = w(C) ≥ c_G(s, t)`. Also `c_G(s, t)` is achieved by some genuine cut, so `λ(G) ≤ c_G(s, t)`. Hence `λ(G) = c_G(s, t)`.

- **If `C` keeps `s` and `t` on the same side:** by Definition 1.5, cuts of `G` keeping `s, t` together correspond exactly (same weight) to cuts of `G'`. So `λ(G) = w(C) = λ(G')`.

In both cases `λ(G) ∈ {c_G(s,t), λ(G')}`, and since each of those values is realized by a valid cut of `G` (an `s-t` cut, resp. a cut keeping `s,t` together), `λ(G) = min(c_G(s,t), λ(G'))`. ∎

By Lemma 3.1, `c_G(s, t)` equals the cut-of-the-phase weight `w(A_{n-1}, t)`, which the phase computes *for free*. So one phase yields `c_G(s, t)`, and merging reduces the problem to `λ(G')` on a graph with one fewer vertex.

---

## 5. Global Correctness of the Algorithm

**Theorem 5.1.** The Stoer-Wagner algorithm returns `λ(G)`.

**Proof.** Induction on `n = |V|`.

*Base case `n = 2`.* Two vertices `u, v`; the only cut is `({u}, {v})` of weight `w(u, v)`. A single phase orders them `u, v` (or `v, u`), and the cut-of-the-phase is exactly `w(u, v) = λ(G)`. ✓

*Inductive step.* Assume correctness for all graphs with `< n` vertices. On `G` with `n` vertices, the algorithm runs one phase, computing the cut-of-the-phase `= c_G(s, t)` (Lemma 3.1), then merges `s, t` into `G'` (with `n-1` vertices) and recurses. By the inductive hypothesis the recursion returns `λ(G')`. The algorithm returns

```text
min( c_G(s, t),  λ(G') )  =  λ(G)      by Lemma 4.1.
```

∎

So tracking `best = min over all phases of (cut-of-the-phase)` yields the global minimum cut after `n - 1` phases. The partition is recovered by remembering, at the phase achieving `best`, the original-vertex set fused into the isolated last vertex `t`.

---

## 6. Complexity — O(V³) Time, O(V²) Space

Consider the array implementation on an adjacency matrix.

**Per phase.** A phase on a graph with `m` current (un-merged) vertices:

- It adds all `m` vertices one at a time.
- Each addition does an `argmax` over ≤ `m` keys: `O(m)`.
- Each addition updates ≤ `m` keys (`key[v] += w[sel][v]`): `O(m)`.

So one phase is `Σ_{i=1}^{m} O(m) = O(m²)`.

**Across phases.** Phase `p` (`p = 0, …, n-2`) runs on `m = n - p` vertices, costing `O((n-p)²)`. The merge after each phase is `O(n)`. Total:

```text
T(n) = Σ_{p=0}^{n-2} O((n-p)²)
     = O( n² + (n-1)² + … + 2² )
     = O( Σ_{k=2}^{n} k² )
     = O( n³ / 3 )
     = Θ(n³).
```

**Space.** The adjacency matrix dominates: `Θ(n²)`. The per-phase arrays (`key`, `inA`, `merged`) are `Θ(n)`. Partition recovery adds an `Θ(n²)` worst-case group bookkeeping (or `Θ(n)` with a union-find / parent pointer). Total space `Θ(n²)`.

**Lower-order remarks.** There is no early termination in the array version — the work is fixed at `Θ(n³)` regardless of density (a dense matrix is processed identically to a sparse one stored as a matrix). Seeding `best` with the minimum weighted degree prunes nothing asymptotically but is a cheap sanity bound.

**Tight constants.** The dominant work is the inner key-update `key[v] += w[sel][v]`, executed `Σ_{m} m² / 2 ≈ n³/6` times, plus an equal number of comparisons in the `argmax`. So the leading constant is roughly `n³/3` matrix accesses — the reason a flat 1D matrix with sequential row sweeps (excellent cache behavior) is materially faster than a 2D nested array of pointers. Unlike Floyd-Warshall, the access pattern is row-at-a-time (`w[sel][*]`), which is fully cache-friendly.

---

## 7. Heap Variant Complexity

Replace the per-step `argmax`/`update` with a max-priority-queue keyed on `w(A, v)`.

- **Per phase** on `m` vertices, `m'` edges: `m` extract-max operations (`O(log m)` each) and `O(m')` key increases (each an `O(log m)` heap push under lazy deletion). Per phase: `O((m + m') log m) = O(m' + m log m)` with a Fibonacci heap, or `O((m + m') log m)` with a binary heap.

- **Across `n-1` phases**, summing edges and using a binary heap:

```text
T(n) = Σ over phases O((m + E_phase) log m)  =  O(V·E + V² log V)
```

with a Fibonacci heap. (Binary heaps give `O(V·E log V)`; in practice binary heaps are used and constants favor them on real graphs.)

| Variant | Time | Space | Best regime |
|---------|------|-------|-------------|
| Array (matrix) | `Θ(V³)` | `Θ(V²)` | Dense, small `V` |
| Binary heap (lists) | `O(V·E log V)` | `O(V + E)` | Sparse |
| Fibonacci heap (lists) | `O(V·E + V² log V)` | `O(V + E)` | Asymptotic optimum |

The `V² log V` term is irreducible: even a sparse graph runs `V-1` phases, each touching `O(V)` heap entries.

### 7.1 Loop invariants of a single phase

A phase maintains two invariants that together justify its `O(V²)` cost and the correctness of the extracted cut.

```text
Invariant K (key correctness): at the start of each selection iteration,
   for every v ∉ A,   key[v] = w(A, v) = Σ_{a ∈ A} w(a, v).

Invariant M (max choice): the vertex sel selected this iteration satisfies
   key[sel] ≥ key[v]   for all v ∉ A.
```

*Proof of K by induction on `|A|`.* Initially `A = {a₁}` and `key[v]` was set to `w(a₁, v)` (or `0` then a single update) — matches. Inductive step: when `sel` joins `A`, the update `key[v] += w(sel, v)` for all `v ∉ A` turns `w(A, v)` into `w(A ∪ {sel}, v)`. ✓ Invariant M is immediate from selecting the `argmax`. Together, at termination, `key[a_n] = w(A_{n-1}, a_n)` is *exactly* the cut-of-the-phase, which Lemma 3.1 proves minimal — so the phase emits a correct minimum `s-t` cut value with no extra computation.

### 7.2 Numerical and overflow considerations

Edge weights up to `W` accumulate during merges: after `n-1` merges a single super-edge can sum `O(n)` original edges, and a vertex key can reach `O(n·W)`. With integer weights up to `10⁹` and `n` up to a few thousand, intermediate sums can exceed 32-bit range. Use 64-bit accumulators (`int64` / `long`) for both the matrix cells and the keys. There is no subtraction in the algorithm (only `min`, `+=`), so no cancellation or precision loss occurs with integers; floating-point weights, however, can accumulate rounding error in long merge chains — prefer rationals or a tolerance when weights are real.

---

## 8. Relationship to Max-Flow / Min-Cut

**Global cut via max-flow.** Fix a vertex `p`. Every global cut separates `p` from at least one other vertex `q`, so

```text
λ(G) = min_{q ≠ p}  c(p, q).
```

By the max-flow / min-cut theorem, each `c(p, q)` is the value of a maximum `p-q` flow. This requires `n-1` max-flow computations. With Dinic's algorithm each is `O(V² E)` in general (better on unit-capacity), giving `O(V³ E)` total — far worse than Stoer-Wagner's `O(V³)` on dense graphs.

**Stoer-Wagner's advantage.** It computes `c(s, t)` for a *cleverly chosen* `(s, t)` per phase — the last two MA-order vertices — for the cost of a single `O(V²)` scan, *with no flow at all*. The merge then guarantees the chosen pairs collectively cover the global optimum (Theorem 5.1). It trades the max-flow machinery for the cut-of-the-phase lemma.

**Hao-Orlin** improves the flow-based approach to a single parametric max-flow computation (`O(V E log(V²/E))`), competitive on sparse graphs. Stoer-Wagner remains the simplest deterministic method and the standard textbook choice.

---

## 9. Comparison with Alternatives

| Attribute | Stoer-Wagner | Hao-Orlin (flow) | Karger-Stein | Nagamochi-Ibaraki |
|-----------|--------------|------------------|--------------|-------------------|
| Approach | MA ordering + merge | Parametric max-flow | Randomized contraction | Sparse certificate + MA |
| Time | `O(V³)` / `O(VE + V² log V)` | `O(VE log(V²/E))` | `O(V² log³ V)` | `O(VE + V² log V)` |
| Determinism | Deterministic | Deterministic | Monte Carlo | Deterministic |
| Graph type | Undirected, `w ≥ 0` | Undirected/directed `w ≥ 0` | Undirected, `w ≥ 0` | Undirected, `w ≥ 0` |
| Simplicity | Very high | Low | Moderate | Moderate |
| Failure prob. | 0 | 0 | `1/V^c` per run | 0 |

**Open / advanced.** Near-linear deterministic global min cut for *simple* unweighted graphs (Kawarabayashi-Thorup, `O(E log^O(1) V)`) and Karger's near-linear randomized algorithm push the frontier well below `O(V³)`, but they are substantially more intricate. Stoer-Wagner's enduring value is the combination of exactness, determinism, and a textbook-short proof.

### 9.1 Why the global min cut is in P (and `s-t` directed cuts too)

The global minimum cut is polynomial-time solvable, unlike many cut-flavored problems that are NP-hard. The decisive structural fact is the **submodularity** of the cut function `f(S) = w(S, V\S)`:

```text
f(S) + f(T) ≥ f(S ∪ T) + f(S ∩ T)   for all S, T ⊆ V.
```

Minimizing a symmetric submodular function over non-empty proper subsets is polynomial (Queyranne's algorithm generalizes Stoer-Wagner to arbitrary symmetric submodular `f` in `O(V³)` oracle calls). The cut-of-the-phase lemma is exactly the special case of Queyranne's "pendant pair" lemma for the cut function. By contrast, the **maximum** cut (MAX-CUT) is NP-hard, and **balanced** / **normalized** cut variants are NP-hard — adding a balance or cardinality constraint destroys submodular minimizability.

| Problem | Tractability |
|---------|-------------|
| Global min cut (undirected) | **P** — Stoer-Wagner `O(V³)` |
| Min `s-t` cut | **P** — max-flow |
| Symmetric submodular minimization | **P** — Queyranne `O(V³)` |
| Maximum cut (MAX-CUT) | **NP-hard** |
| Minimum bisection (balanced) | **NP-hard** |
| Normalized cut | **NP-hard** (spectral approximation used) |

This table is the senior/professional dividing line: knowing *which* cut problems Stoer-Wagner solves — and which require approximation — is what prevents you from reaching for it on a balanced-partition task it cannot solve.

---

## 10. Worked Phase Trace

Graph on `V = {0,1,2,3}`, edges `0-1:3, 0-2:1, 1-2:3, 1-3:1, 2-3:5`.

**Phase 1**, start `A={0}`:

```text
keys:        w(A,1)=3  w(A,2)=1  w(A,3)=0   → add 1   (A={0,1})
update:      w(A,2)=1+3=4  w(A,3)=0+1=1     → add 2   (A={0,1,2})
update:      w(A,3)=1+1+5? = 0+1+5 = 6      → add 3   (A=all)
order: 0,1,2,3 → s=2, t=3.  cut-of-phase = w(A_3, 3) = 6.
best = 6.  merge 2,3 → super "23":  w(0,23)=1+0=1,  w(1,23)=3+1=4.
```

**Phase 2** on `{0,1,23}`, start `A={0}`:

```text
keys: w(A,1)=3  w(A,23)=1  → add 1
update: w(A,23)=1+4=5      → add 23
order: 0,1,23 → s=1, t=23. cut-of-phase = 5  (partition {0,1} | {2,3}).
best = min(6,5)=5. merge 1,23 → super "123": w(0,123)=3+1=4.
```

**Phase 3** on `{0,123}`:

```text
add 123. cut-of-phase = 4  (partition {0} | {1,2,3}).
best = min(5,4)=4.
```

Global min cut `λ(G) = 4`, partition `{0} | {1,2,3}` (edges `0-1:3`, `0-2:1`). Matches Lemma 3.1 and Theorem 5.1.

**Verification against the lemma.** In Phase 1, `s=2, t=3`; the lemma claims `({3}, {0,1,2})` is a minimum `2-3` cut. Its weight is `w(1,3)+w(2,3) = 1+5 = 6`. Any other `2-3` cut — e.g. `({2,3}, {0,1})` of weight `w(0,2)+w(1,2)+w(0,3)+w(1,3) = 1+3+0+1 = 5`? That cut keeps 2 and 3 *together*, so it is not a `2-3` cut. Checking genuine `2-3` cuts (3 alone, or `{1,3}`, etc.) confirms `6` is indeed the minimum among them, consistent with Lemma 3.1. The global optimum `4` is found in Phase 3, separating `s=0` from the fully-merged `{1,2,3}`.

---

## 11. Reference Implementations

### 11.1 Go — array `O(V³)` with partition recovery

```go
package main

import "fmt"

// StoerWagner returns (minCutWeight, oneSideOfPartition).
func StoerWagner(n int, weight [][]int) (int, []int) {
	w := make([][]int, n)
	for i := range w {
		w[i] = append([]int(nil), weight[i]...)
	}
	merged := make([]bool, n)
	groups := make([][]int, n)
	for i := range groups {
		groups[i] = []int{i}
	}
	best := 1 << 60
	var bestSide []int

	for phase := 0; phase < n-1; phase++ {
		inA := make([]bool, n)
		key := make([]int, n)
		prev, last := -1, -1
		active := 0
		for i := 0; i < n; i++ {
			if !merged[i] {
				active++
			}
		}
		for added := 0; added < active; added++ {
			sel := -1
			for v := 0; v < n; v++ {
				if !merged[v] && !inA[v] && (sel == -1 || key[v] > key[sel]) {
					sel = v
				}
			}
			inA[sel] = true
			prev, last = last, sel
			for v := 0; v < n; v++ {
				if !merged[v] && !inA[v] {
					key[v] += w[sel][v]
				}
			}
		}
		if key[last] < best {
			best = key[last]
			bestSide = append([]int(nil), groups[last]...)
		}
		// merge last into prev
		merged[last] = true
		groups[prev] = append(groups[prev], groups[last]...)
		for v := 0; v < n; v++ {
			if !merged[v] {
				w[prev][v] += w[last][v]
				w[v][prev] += w[v][last]
			}
		}
	}
	return best, bestSide
}

func main() {
	w := [][]int{
		{0, 3, 1, 0},
		{3, 0, 3, 1},
		{1, 3, 0, 5},
		{0, 1, 5, 0},
	}
	c, side := StoerWagner(4, w)
	fmt.Println("min cut =", c, "side =", side) // 4 [0]
}
```

### 11.2 Java — array `O(V³)` with min-weighted-degree seed

```java
import java.util.*;

public class StoerWagnerPro {
    static int minCut(int n, int[][] weight) {
        int[][] w = new int[n][];
        for (int i = 0; i < n; i++) w[i] = weight[i].clone();
        boolean[] merged = new boolean[n];

        // seed best with min weighted degree (valid upper bound)
        int best = Integer.MAX_VALUE;
        for (int i = 0; i < n; i++) {
            int deg = 0;
            for (int j = 0; j < n; j++) deg += w[i][j];
            best = Math.min(best, deg);
        }

        for (int phase = 0; phase < n - 1; phase++) {
            boolean[] inA = new boolean[n];
            int[] key = new int[n];
            int prev = -1, last = -1, active = 0;
            for (int i = 0; i < n; i++) if (!merged[i]) active++;
            for (int added = 0; added < active; added++) {
                int sel = -1;
                for (int v = 0; v < n; v++)
                    if (!merged[v] && !inA[v] && (sel == -1 || key[v] > key[sel])) sel = v;
                inA[sel] = true;
                prev = last; last = sel;
                for (int v = 0; v < n; v++)
                    if (!merged[v] && !inA[v]) key[v] += w[sel][v];
            }
            best = Math.min(best, key[last]);
            merged[last] = true;
            for (int v = 0; v < n; v++)
                if (!merged[v]) { w[prev][v] += w[last][v]; w[v][prev] += w[v][last]; }
        }
        return best;
    }

    public static void main(String[] args) {
        int[][] w = {{0,3,1,0},{3,0,3,1},{1,3,0,5},{0,1,5,0}};
        System.out.println(minCut(4, w)); // 4
    }
}
```

### 11.3 Python — brute-force validator (cross-check on small graphs)

```python
from itertools import combinations


def brute_force_min_cut(n, w):
    """O(2^n) exact min cut by trying every non-trivial subset. For validation only."""
    best = float("inf")
    verts = range(n)
    for size in range(1, n):
        for S in combinations(verts, size):
            Sset = set(S)
            cut = sum(
                w[u][v]
                for u in S
                for v in verts
                if v not in Sset
            )
            best = min(best, cut)
    return best


if __name__ == "__main__":
    w = [[0,3,1,0],[3,0,3,1],[1,3,0,5],[0,1,5,0]]
    print(brute_force_min_cut(4, w))  # 4  — must match Stoer-Wagner
```

---

### 11.4 Python — assertion harness tying it all together

```python
import random


def random_graph(n, max_w=9):
    w = [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            x = random.randint(0, max_w)
            w[i][j] = w[j][i] = x
    return w


def assert_correct(trials=200):
    for _ in range(trials):
        n = random.randint(2, 8)
        w = random_graph(n)
        sw = stoer_wagner(n, [r[:] for r in w])   # from junior.md
        bf = brute_force_min_cut(n, w)
        assert sw == bf, (n, w, sw, bf)
    print("all trials passed")


# stoer_wagner(n, w) must equal brute_force_min_cut(n, w) on every random graph.
```

This harness is the practical embodiment of Theorem 5.1: exhaustive subset enumeration (`brute_force_min_cut`) is the ground truth, and the `O(V³)` algorithm must agree on every random instance. Any disagreement localizes a bug to merge logic, key updates, or the cut-recording step.

---

## 12. Summary

At professional level, Stoer-Wagner's correctness rests on the **cut-of-the-phase lemma** (Lemma 3.1): in a maximum-adjacency ordering, isolating the last vertex `t` is a *minimum* `s-t` cut for the second-to-last vertex `s`. The proof is an induction over "active" vertices that crucially uses the MA greedy property and edge-weight **non-negativity**. The **merge lemma** (Lemma 4.1) reduces `λ(G)` to `min(c(s,t), λ(G'))`, and induction (Theorem 5.1) gives global correctness in `n-1` phases. The array version is `Θ(V³)` time and `Θ(V²)` space; the heap variant achieves `O(V·E + V² log V)`. Against `n-1` max-flow runs, Stoer-Wagner trades the entire flow apparatus for one short lemma — the reason it is the canonical deterministic global-min-cut algorithm.

---

## Next step:

Continue to [`interview.md`](./interview.md) for tiered interview questions and a full coding challenge in Go, Java, and Python.

---
