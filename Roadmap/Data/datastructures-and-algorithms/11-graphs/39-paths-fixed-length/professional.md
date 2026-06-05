# Paths of Fixed Length — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Walk-Counting Theorem (Proof by Induction)
3. Semiring Generalization of Matrix Multiplication
4. Min-Plus Correctness (Shortest Exact-Length Walks)
5. Boolean Semiring and Transitive Closure
6. Binary Exponentiation: Correctness and Complexity
7. Spectral Theory: Eigenvalues and Growth Rates
8. Generating Functions and the Transfer-Matrix Method
9. Periodicity and the Structure of Powers
10. Walks vs Simple Paths: The #P-Hardness Gap
11. Cayley-Hamilton and the Kitamasa Speedup
12. Fast Matrix Multiplication and Lower Bounds
13. Summary

---

## 1. Formal Definitions

Let `G = (V, E)` be a directed graph (loops and parallel edges allowed) on vertex set `V = {1, …, n}`.

**Definition 1.1 (Adjacency matrix).** The adjacency matrix `A ∈ ℕ^{n×n}` of `G` has

```
A[i][j] = number of edges from i to j.
```

For a simple graph `A[i][j] ∈ {0,1}`; for a multigraph `A[i][j]` may exceed 1. An undirected graph yields a symmetric `A`.

**Definition 1.2 (Walk).** A **walk** of length `k` from `i` to `j` is a sequence of vertices `(w₀, w₁, …, w_k)` with `w₀ = i`, `w_k = j`, and `(w_{m}, w_{m+1}) ∈ E` for every `0 ≤ m < k`. Vertices and edges may repeat. In a multigraph a walk additionally records *which* parallel edge is used at each step.

**Definition 1.3 (Path / simple path).** A **simple path** is a walk in which `w₀, …, w_k` are pairwise distinct (no repeated vertex). A **simple cycle** is a closed walk whose only repetition is `w₀ = w_k`.

**Definition 1.4 (Walk-count matrix).** Let `W_k[i][j]` denote the number of distinct walks of length exactly `k` from `i` to `j` (counting parallel-edge choices). We prove `W_k = A^k`, where `A^0 = I` (identity) by convention.

**Remark.** The distinction in Definitions 1.2 and 1.3 is the crux of the whole topic: `A^k` counts the *walks* of Definition 1.2, which is tractable, **not** the simple paths of Definition 1.3, which (Section 10) is #P-hard.

**Notation conventions.** Throughout, `n = |V|` is the number of vertices, `k` the walk length (edge count), `p` a prime modulus, `ω` the matrix-multiplication exponent, `λ_r` the eigenvalues of `A` with `λ_max = ρ(A)` the spectral radius, and `I` the identity matrix (of the ambient semiring). We write `A^{(k)}` for the `k`-th power in a *non-counting* semiring (min-plus, max-plus, Boolean) to distinguish it from the ordinary integer power `A^k`, though both are computed by the identical squaring algorithm. The Iverson bracket `[P]` is `1` if predicate `P` holds, else `0`. "Walk" always permits repeats; "simple path" never does. Edge multiplicities are carried through, so all results hold verbatim for multigraphs by reading `A[i][j]` as an edge count rather than a 0/1 indicator.

---

## 2. The Walk-Counting Theorem (Proof by Induction)

**Theorem 2.1.** For every integer `k ≥ 0` and all `i, j ∈ V`, the number of walks of length exactly `k` from `i` to `j` equals `(A^k)[i][j]`.

**Proof (induction on `k`).**

*Base case `k = 0`.* A walk of length 0 is the single-vertex sequence `(i)`, which exists iff its endpoints coincide, i.e. iff `i = j`. Thus the number of length-0 walks from `i` to `j` is `[i = j]` (Iverson bracket). By definition `A^0 = I`, and `I[i][j] = [i = j]`. The base case holds.

*Base case `k = 1`.* A walk of length 1 from `i` to `j` is a choice of one edge `i → j`; there are `A[i][j]` of them. And `A^1 = A`. (This case also follows from the inductive step applied to `k = 0`, but is worth stating.)

*Inductive step.* Assume `W_{k-1} = A^{k-1}` for some `k ≥ 1`. Every walk `(w₀, …, w_k)` of length `k` from `i` to `j` decomposes **uniquely** into a length-`(k-1)` prefix `(w₀, …, w_{k-1})` from `i` to `t := w_{k-1}`, followed by a single final edge `(w_{k-1}, w_k) = (t, j)`. Conversely, any length-`(k-1)` walk `i ⇝ t` concatenated with any edge `t → j` yields a distinct length-`k` walk `i ⇝ j`, and distinct (prefix, last-edge) pairs give distinct walks because the prefix and the last edge are recovered unambiguously from the walk. Hence, summing over the intermediate vertex `t`:

```
W_k[i][j] = Σ_{t=1}^{n}  W_{k-1}[i][t] · A[t][j].
```

The factor `W_{k-1}[i][t]` counts prefixes; `A[t][j]` counts the last-edge choices; their product counts concatenations (multiplication principle), and the sum over `t` ranges over all possible penultimate vertices. By the inductive hypothesis `W_{k-1} = A^{k-1}`, so

```
W_k[i][j] = Σ_t (A^{k-1})[i][t] · A[t][j] = (A^{k-1} · A)[i][j] = (A^k)[i][j].
```

This is precisely the definition of matrix multiplication. By induction the theorem holds for all `k ≥ 0`. ∎

**Corollary 2.2 (Closed walks).** `(A^k)[i][i]` is the number of closed walks of length `k` based at `i`, and `tr(A^k) = Σ_i (A^k)[i][i]` counts all closed walks of length `k`. In particular `tr(A^k) = Σ_r λ_r^k` where `λ_r` are the eigenvalues of `A` (Section 7), linking closed-walk counts to the spectrum.

**Corollary 2.3 (Distance from reachability).** The least `k ≥ 0` with `(A^k)[i][j] > 0` equals the shortest-path (fewest-edges) distance from `i` to `j`. (This is the unweighted special case of Section 4.)

### 2.1 Worked Verification

Take `A` on `{1,2,3}` with edges `1→2, 2→3, 3→1, 1→3`:

```
A = [0 1 1]      A² = [1 0 1]      A³ = [1 1 1]
    [0 0 1]           [1 0 0]           [0 1 1]
    [1 0 0]           [0 1 1]           [1 0 1]
```

Check Theorem 2.1 at `(A³)[1][1] = 1`: the only length-3 closed walk based at `1` is `1→2→3→1`. By Corollary 2.2, `tr(A³) = 1 + 1 + 1 = 3`, counting the three rotations of the single directed triangle `1→2→3→1`. This matches the eigenvalue identity `tr(A³) = Σ_r λ_r³` once the spectrum is computed (Section 7). A brute-force enumeration of all `3³ = 27` length-3 vertex sequences confirms every entry of `A³`, providing the empirical anchor for the inductive proof.

**On the convention `A^0 = I`.** Some texts hesitate over `A^0`, but the empty-walk interpretation is forced: a length-0 walk is a single vertex with no edges, which exists from `i` to `j` iff `i = j`. Any other choice (e.g. `A^0 = 0`) would break the base case of Theorem 2.1 and the binary-exponentiation accumulator simultaneously. The identity is also the unique matrix `M` with `MA = AM = A` for all `A`, so it is the only sensible "zeroth power" — algebra and combinatorics agree.

### 2.2 The Multiplication Principle, Made Explicit

The inductive step relies on the **bijection**

```
{length-k walks i ⇝ j}  ≅  ⊎_{t}  ({length-(k-1) walks i ⇝ t} × {edges t → j}),
```

a disjoint union over the penultimate vertex `t`. Disjointness holds because `t = w_{k-1}` is determined by the walk, so no walk is counted under two different `t`. The product structure holds because a prefix and a final edge can be chosen independently and concatenated. Taking cardinalities and applying the rule `|A ⊎ B| = |A| + |B|` and `|A × B| = |A|·|B|` yields the sum-of-products that is matrix multiplication. This combinatorial bijection is the semantic content; the algebra of Section 3 abstracts exactly these two cardinality rules into `⊕` and `⊗`.

---

## 3. Semiring Generalization of Matrix Multiplication

The proof in Section 2 used only two algebraic facts: that walk counts **add** when we sum over the intermediate vertex, and **multiply** when we concatenate. Abstracting these gives the semiring view.

**Definition 3.1 (Semiring).** A **semiring** `(S, ⊕, ⊗, 0̄, 1̄)` is a set `S` with two binary operations such that:
- `(S, ⊕, 0̄)` is a commutative monoid (associative, commutative, identity `0̄`);
- `(S, ⊗, 1̄)` is a monoid (associative, identity `1̄`);
- `⊗` distributes over `⊕` from both sides;
- `0̄` annihilates: `a ⊗ 0̄ = 0̄ ⊗ a = 0̄`.

**Definition 3.2 (Semiring matrix product).** For `A, B ∈ S^{n×n}`,

```
(A ⊗ B)[i][j] = ⊕_{t=1}^n ( A[i][t] ⊗ B[t][j] ).
```

**Proposition 3.3.** `(S^{n×n}, ⊕, ⊗)` is itself a semiring, with additive identity the all-`0̄` matrix and multiplicative identity the matrix `I_S` having `1̄` on the diagonal and `0̄` off-diagonal. In particular matrix `⊗` is associative, so `A^k` is well-defined and the binary-exponentiation identity `A^a ⊗ A^b = A^{a+b}` holds.

**Proof.** Associativity of the matrix product follows from associativity of `⊗`, commutativity and associativity of `⊕`, and two-sided distributivity, by the standard triple-sum reindexing:

```
((A ⊗ B) ⊗ C)[i][l]
  = ⊕_j ( (⊕_t A[i][t] ⊗ B[t][j]) ⊗ C[j][l] )
  = ⊕_j ⊕_t ( A[i][t] ⊗ B[t][j] ⊗ C[j][l] )      (distributivity)
  = ⊕_t ⊕_j ( A[i][t] ⊗ B[t][j] ⊗ C[j][l] )      (commutativity of ⊕)
  = ⊕_t ( A[i][t] ⊗ (⊕_j B[t][j] ⊗ C[j][l]) )    (distributivity)
  = (A ⊗ (B ⊗ C))[i][l].
```

`I_S` acts as identity because `(I_S ⊗ A)[i][j] = ⊕_t I_S[i][t] ⊗ A[t][j] = 1̄ ⊗ A[i][j] ⊕ (⊕_{t≠i} 0̄ ⊗ A[t][j]) = A[i][j]`, using the annihilator and `1̄` laws. ∎

**Instances.** The walk-counting theorem is Proposition 3.3 over `(ℕ, +, ×, 0, 1)`. Replacing the semiring yields:

| Semiring | `⊕` | `⊗` | `0̄` | `1̄` | `(A^k)[i][j]` |
|----------|-----|-----|-----|-----|----------------|
| Counting `(ℕ, +, ×)` | `+` | `×` | `0` | `1` | number of length-`k` walks |
| Min-plus `(ℝ∪{∞}, min, +)` | `min` | `+` | `+∞` | `0` | min weight over length-`k` walks |
| Max-plus `(ℝ∪{−∞}, max, +)` | `max` | `+` | `−∞` | `0` | max weight over length-`k` walks |
| Boolean `({0,1}, ∨, ∧)` | `∨` | `∧` | `0` | `1` | exists a length-`k` walk? |

Because each is a genuine semiring, Proposition 3.3 guarantees associativity, hence the binary-exponentiation algorithm is correct in every one of them. **This is the central theoretical payoff: one algorithm, proven once, serves all four problems.**

**Worked semiring contrast.** On the weighted graph `1 →(2) 2 →(3) 3`, `1 →(10) 3`, consider length-2 walks `1 ⇝ 3`. There are two: `1→2→3` (weights 2,3) and — none other of length 2 ends at 3 except via `2`. Then:

- Counting: `(A²)[1][3] = 1` (one length-2 walk: `1→2→3`).
- Min-plus: `A^{(2)}[1][3] = 2 + 3 = 5` (its total weight).
- Max-plus: same single walk, `5`.
- Boolean: `true` (a length-2 walk exists).

The *direct* edge `1→3` of weight `10` is length **1**, so it appears in `A¹`, not `A²` — a vivid reminder that the power index pins the edge count, and that min-plus power `A^{(2)}[1][3] = 5` may exceed or undercut the unconstrained shortest distance (`min(5, 10) = 5` here) depending on the graph.

**Non-examples.** `(ℝ, +, ×)` with subtraction is a *ring*, not just a semiring — it admits Strassen-style multiply (Section 12) but is unnecessary for the walk theorem. `(ℝ, max, min)` is **not** a semiring usable here in general because `min` does not distribute over `max` in the way required for the path interpretation; choosing operations carelessly breaks Proposition 3.3 and silently corrupts results — the formal reason "pick a real semiring" is not pedantry.

**Idempotency note.** The min-plus, max-plus, and Boolean semirings are **idempotent** (`a ⊕ a = a`), whereas counting is not (`a + a = 2a`). Idempotency is what makes "≤ k" reductions like `(I ∨ A)^{n-1}` (Theorem 5.2) collapse cleanly, and it is why shortest-path closures stabilize after `n−1` steps. The counting semiring's non-idempotency is precisely why walk counts *grow* (geometrically) rather than saturate — the two behaviors trace back to this one algebraic property.

---

## 4. Min-Plus Correctness (Shortest Exact-Length Walks)

Let `A` be the weighted adjacency matrix over the min-plus semiring: `A[i][j]` is the weight of edge `i → j` (and `+∞` if absent). Let `A^{(k)}` denote the `k`-th min-plus power.

**Theorem 4.1.** `A^{(k)}[i][j]` equals the minimum total weight over all walks of length exactly `k` from `i` to `j` (and `+∞` if no such walk exists).

**Proof (induction on `k`).** *Base `k = 0`:* the min-plus identity has `0` on the diagonal and `+∞` off it; the only length-0 walk is the trivial one with weight `0` from a vertex to itself, matching. *Inductive step:* a length-`k` walk `i ⇝ j` of minimum weight splits at its penultimate vertex `t` into a length-`(k-1)` walk `i ⇝ t` plus the edge `t → j`. The minimum total weight is therefore

```
A^{(k)}[i][j] = min_t ( A^{(k-1)}[i][t] + A[t][j] ),
```

which is exactly the min-plus matrix product `(A^{(k-1)} ⊗ A)[i][j]`. By induction this equals `A^{(k)}[i][j]`. The `min` correctly selects the cheapest prefix because `+` is monotone in each argument (a cheaper prefix yields a cheaper completion). ∎

**Relation to Floyd-Warshall (sibling `06-floyd-warshall`).** Floyd-Warshall computes the all-pairs shortest distances *without an edge-count constraint* by a different `O(n³)` dynamic program over allowed intermediate vertices. The min-plus *closure* `A* = I ⊕ A ⊕ A^{(2)} ⊕ … ` (which converges to shortest distances over walks of any length when there are no negative cycles) is what Floyd-Warshall computes implicitly. Min-plus *power* `A^{(k)}` pins the walk to exactly `k` edges — strictly more specific, and the right tool only when the edge count is itself a constraint (e.g., "cheapest itinerary with exactly `k` flights"). Without negative cycles, the min over `k = 0, …, n-1` of `A^{(k)}` recovers the unconstrained shortest path.

**Negative cycles.** If a negative-weight cycle is reachable on the path, then unconstrained shortest distance is `−∞`, but `A^{(k)}` for *fixed* `k` remains finite (you can only loop within the `k`-edge budget). This is a feature: fixed-length min-plus power is well-defined even with negative cycles, whereas unconstrained shortest path is not.

**Theorem 4.2 (Min-plus distributivity / monotonicity).** The min-plus semiring `(ℝ∪{∞}, min, +)` is a genuine commutative semiring: `min` is associative-commutative with identity `+∞`; `+` is associative with identity `0`; and `+` distributes over `min` because `a + min(b, c) = min(a+b, a+c)` (translation by `a` is order-preserving). The annihilator law `a + (+∞) = +∞` holds. Therefore Proposition 3.3 applies, `A^{(k)}` is associative, and binary exponentiation is valid — Theorem 4.1's correctness rides on exactly these algebraic laws, no extra argument needed.

**Closure and the `n − 1` bound.** Define the min-plus closure `A* = min_{k≥0} A^{(k)}` (entrywise). For a graph with no negative cycle, the minimum is attained at some `k ≤ n − 1`, since any optimal walk between two vertices can be shortened to a simple path (removing a non-negative cycle never increases cost) of at most `n − 1` edges. Hence `A* = min(I, A^{(1)}, …, A^{(n-1)})`, which Floyd-Warshall computes in one `O(n³)` pass. Fixed-length power is needed precisely when this "shorten by removing cycles" reduction is *forbidden* because the edge count `k` is a hard constraint.

---

## 5. Boolean Semiring and Transitive Closure

Over the Boolean semiring `({0,1}, ∨, ∧)`, `A[i][j] = 1` iff edge `i → j` exists.

**Theorem 5.1.** `(A^k)[i][j] = 1` iff there exists a walk of length exactly `k` from `i` to `j`.

**Proof.** Specialize Theorem 2.1 / Proposition 3.3 to the Boolean semiring: the sum `⊕ = ∨` is `1` iff *some* term is `1`, and `⊗ = ∧` requires both the prefix-existence and the last edge. By induction, existence of a length-`k` walk is captured exactly. (Equivalently, it is the counting result with `>0` collapsed to `1`.) ∎

**Transitive closure.** The reflexive-transitive closure `A* = ⋁_{k=0}^{n-1} A^k` (Boolean) records reachability by *any* number of edges; `n-1` suffices because a simple path between distinct vertices has at most `n-1` edges, and any longer walk contains a shorter walk between the same endpoints. `A*` can be obtained by Boolean Floyd-Warshall (Warshall's algorithm) in `O(n³)`, or by `O(n³ log n)` repeated squaring; Warshall's single pass is preferred. Fixed-length Boolean power `A^k` answers the *exact-length* reachability question that closure cannot.

**Theorem 5.2 (Closure via doubling).** `(I ∨ A)^{n-1} = A*` over the Boolean semiring. 

**Proof.** `(I ∨ A)^{m} = ⋁_{j=0}^{m} \binom{m}{j}_{Bool} A^j = ⋁_{j=0}^{m} A^j` (Boolean binomial coefficients are `1` whenever the term is reachable, since `OR` is idempotent). For `m = n-1`, this is `⋁_{j=0}^{n-1} A^j = A*` by the `n-1` bound above. ∎

This gives an `O(n³ log n)` closure by squaring `(I ∨ A)` — useful when `A` is given implicitly or when the same squaring ladder is reused for several fixed-length queries. For a one-shot closure, Warshall's `O(n³)` wins; for a *batch* of exact-length reachability queries the squaring ladder amortizes better.

---

## 6. Binary Exponentiation: Correctness and Complexity

**Algorithm.**
```
MAT-POW(A, k):                  # over any semiring S
  R := I_S                       # multiplicative identity
  while k > 0:
    if k & 1 == 1: R := R ⊗ A
    A := A ⊗ A
    k := k >> 1
  return R
```

**Theorem 6.1 (Correctness).** `MAT-POW(A, k)` returns `A^k`.

**Proof (loop invariant).** Write `k` in binary as `Σ_{b∈B} 2^b` where `B` is the set of set-bit positions. Let `A_s` denote the value of variable `A` after `s` squarings; by induction `A_s = A^{2^s}` (since `A^{2^s} ⊗ A^{2^s} = A^{2^{s+1}}`, valid by associativity, Proposition 3.3). 

Invariant: before processing bit `s`, `R = A^{Σ_{b∈B, b<s} 2^b}` (product of the powers for already-consumed set bits). Initially `R = I_S = A^0`, the empty product. When bit `s` of `k` is set, we multiply `R` by `A_s = A^{2^s}`, and since powers of a fixed matrix commute (`A^a ⊗ A^b = A^{a+b}`, again Proposition 3.3), this extends the exponent by `2^s`. After all `⌊log₂ k⌋ + 1` bits, `R = A^{Σ_{b∈B} 2^b} = A^k`. ∎

**Theorem 6.2 (Complexity).** Over an `n × n` matrix with `O(1)` semiring operations, `MAT-POW` performs at most `2⌊log₂ k⌋ + 2` matrix multiplications, hence runs in `O(n³ log k)` time (using schoolbook multiply) and `O(n²)` space.

**Proof.** The loop runs `⌊log₂ k⌋ + 1` times. Each iteration does one squaring (`A ⊗ A`) and at most one conditional multiply (`R ⊗ A`), so at most `2(⌊log₂ k⌋ + 1)` multiplies. Each schoolbook multiply costs `Θ(n³)` semiring operations, each `O(1)`. Total `O(n³ log k)`. Space: `O(1)` matrices of size `n²`. ∎

**Remark (modular cost).** Over `(ℤ_p, +, ×)` each semiring operation is `O(1)` for fixed-width `p`; for big-integer exact counts each operation is `O(M(log answer))` where `M` is the integer-multiplication cost, and `log answer = Θ(k log λ_max)` can itself be large, eliminating the `log k` advantage. This is precisely why exact-count problems specify a modulus.

### 6.1 Worked Binary-Exponentiation Trace

Compute `A^{13}` with `13 = 1101₂` (bits, low to high: `1, 0, 1, 1`):

```
k=13 (1101): bit0=1 → R = I·A = A^1 ;  A := A^2     (square)
k=6  (110):  bit0=0 → (skip)         ;  A := A^4
k=3  (11):   bit0=1 → R = A^1·A^4 = A^5 ; A := A^8
k=1  (1):    bit0=1 → R = A^5·A^8 = A^{13} ; A := A^{16}
k=0: stop. R = A^{13}.   ✓ (8 + 4 + 1 = 13)
```

This is `4` squarings and `3` conditional multiplies — `7` multiplies for exponent `13`, matching `⌊log₂ 13⌋ + popcount(13) = 3 + 3 = 6` plus the final unused square, consistent with the `≤ 2⌊log₂ k⌋ + 2` bound of Theorem 6.2.

### 6.2 Correctness of the Modular Pipeline

**Proposition 6.3.** Let `φ_p : ℤ → ℤ_p` be reduction mod `p`. Then `φ_p` is a ring homomorphism, and applying it entrywise commutes with matrix multiplication: `φ_p(A · B) = φ_p(A) · φ_p(B)` in `Mat_n(ℤ_p)`.

**Proof.** `φ_p(x + y) = φ_p(x) + φ_p(y)` and `φ_p(xy) = φ_p(x)φ_p(y)` by definition of `ℤ_p`. Each entry `(A·B)[i][j] = Σ_t A[i][t] B[t][j]` is a sum of products; applying `φ_p` and using the homomorphism properties term by term gives `Σ_t φ_p(A[i][t]) φ_p(B[t][j]) = (φ_p(A) φ_p(B))[i][j]`. ∎

**Corollary 6.4.** `φ_p(A^k) = φ_p(A)^k`. Hence reducing the input mod `p`, running the *entire* binary exponentiation over `ℤ_p`, and reading the result gives exactly the true walk count reduced mod `p`. The reduction may be interleaved at every operation without affecting the result — the basis for the "reduce in the inner loop" implementation and for the CRT pipeline (run independently mod `p₁, …, p_m`, recombine).

**Addition-chain optimality.** Binary exponentiation uses the binary addition chain for `k`, which has length `⌊log₂ k⌋ + popcount(k) − 1`. This is near-optimal but not always minimal: the *shortest addition chain* problem is hard in general, and for a fixed `k` reused across many matrices, precomputing an optimized chain (or windowed/sliding-window exponentiation) can shave a few multiplies. For the typical single-shot use, plain binary is the right default; the savings of fancier chains are a small constant factor and rarely worth the complexity.

### 6.3 Why Powers of One Matrix Commute

Theorem 6.1's invariant used `A^a · A^b = A^{a+b}`. General matrices do **not** commute, so this needs justification: `A^a` and `A^b` are both polynomials in the single matrix `A` (`A^a = A·A⋯A`), and any two polynomials in the same matrix commute (`p(A) q(A) = q(A) p(A)`, since matrix multiplication of like factors is associative and the factors are all `A`). Therefore the exponents simply add, regardless of `A`'s non-commutativity with *other* matrices. This is the precise reason binary exponentiation — which multiplies various powers of the *same* `A` — is valid even though matrices generally do not commute.

---

## 7. Spectral Theory: Eigenvalues and Growth Rates

**Setup.** If `A` is diagonalizable, `A = S Λ S⁻¹` with `Λ = diag(λ₁, …, λ_n)`. Then `A^k = S Λ^k S⁻¹` and

```
(A^k)[i][j] = Σ_{r=1}^n c_{ijr} · λ_r^k,    where c_{ijr} = S[i][r] (S⁻¹)[r][j].
```

**Theorem 7.1 (Perron-Frobenius, walk-counting form).** If `G` is strongly connected and aperiodic, `A` has a unique eigenvalue `λ_max > 0` of maximum modulus (the spectral radius `ρ(A)`), with strictly positive left/right eigenvectors `u, v`. Then

```
(A^k)[i][j] = v[i] u[j] · λ_max^k · (1 + o(1))    as k → ∞,
```

so the number of length-`k` walks grows like `Θ(λ_max^k)`.

**Consequence.** Walk counts grow geometrically with ratio `λ_max`. If `λ_max > 1` the counts explode (mandating `mod p`); the exponential growth rate `log λ_max` is the *topological entropy* of the graph viewed as a subshift of finite type. The trace identity `tr(A^k) = Σ_r λ_r^k` (Corollary 2.2) is Newton's identity linking closed-walk counts to power sums of eigenvalues, and underlies counting cycles via the characteristic polynomial.

**Exactness caveat.** Eigenvalues of integer matrices are algebraic numbers, typically irrational. Computing `(A^k)[i][j]` via the spectral formula in floating point does **not** give an exact integer, and reducing an irrational mod `p` is meaningless. The spectral form is for asymptotics and growth-rate analysis; exact counts require integer matrix exponentiation mod `p` (Section 6 remark).

### 7.1 Worked Spectral Example: Fibonacci

The Fibonacci transfer matrix `T = [[1,1],[1,0]]` has characteristic polynomial `det(T − λI) = λ² − λ − 1`, roots `φ = (1+√5)/2` and `ψ = (1−√5)/2`. Then

```
F_k = (φ^k − ψ^k) / √5,        (Binet's formula)
```

which is exactly the spectral decomposition `(T^k)[0][1] = Σ_r c_r λ_r^k` with `λ₁ = φ, λ₂ = ψ`. The growth rate is `λ_max = φ ≈ 1.618` (the golden ratio): `F_k ∼ φ^k/√5`, a textbook instance of Theorem 7.1. Note `φ` is irrational — to compute `F_{10^18} mod p` you cannot use Binet in floating point; you must power `T` over `ℤ_p`. This single example crystallizes the whole "eigenvalues for growth, modular matrices for exactness" doctrine.

### 7.1b Counting Cycles from Traces

The trace identity `tr(A^k) = Σ_r λ_r^k` (Corollary 2.2) lets you count *closed walks* of each length directly from the spectrum, and closed-walk counts in turn yield *cycle* counts by inclusion-exclusion over shorter closed walks (Möbius inversion on the divisor lattice of `k`). Concretely, the number of closed walks of length 3 is `tr(A³)`, and for a simple undirected graph this equals `6 ×` (number of triangles), because each triangle is traversed in `2` directions from each of its `3` base vertices. Thus `#triangles = tr(A³)/6` — a classic spectral count obtained for free from the same `A^k` machinery. Longer cycles require subtracting "degenerate" closed walks (those that backtrack or repeat a shorter cycle), which is where the inclusion-exclusion becomes intricate, but the trace remains the generating quantity.

### 7.2 Spectral Radius Bounds

For a 0/1 adjacency matrix with maximum out-degree `Δ_out` and maximum in-degree `Δ_in`, the spectral radius satisfies `λ_max ≤ √(Δ_out · Δ_in)` (and `λ_max ≤ Δ` for `d`-regular graphs, with equality). Thus the number of length-`k` walks from any vertex is at most `≈ Δ^k`, a useful a priori bound on how many bits the exact count needs (`≈ k log₂ Δ`) — directly informing how many CRT primes (Section 6.2) are required to recover the exact value.

Lower bound: `λ_max ≥ d_avg`, the average degree (`= (1/n) Σ degrees`), by the Rayleigh quotient with the all-ones vector. Together, `d_avg ≤ λ_max ≤ Δ_max`, sandwiching the walk-count growth rate between the average and maximum degree — an instant sanity check on any computed count's order of magnitude.

---

## 8. Generating Functions and the Transfer-Matrix Method

The matrix-power view has a generating-function dual that explains *why* fixed-length walk counts satisfy linear recurrences, and connects to combinatorics on words.

**Definition 8.1 (Walk generating function).** Fix `i, j`. Define the ordinary generating function

```
W_{ij}(x) = Σ_{k≥0} (A^k)[i][j] · x^k.
```

**Theorem 8.2 (Transfer-matrix / MacMahon master theorem form).** As a formal power series / matrix of rational functions,

```
W(x) = Σ_{k≥0} A^k x^k = (I − xA)^{-1},
```

and consequently each entry `W_{ij}(x)` is a **rational function** whose denominator divides `det(I − xA)`.

**Proof.** Formally, `(I − xA) Σ_{k≥0} A^k x^k = Σ_{k≥0} A^k x^k − Σ_{k≥0} A^{k+1} x^{k+1} = A^0 = I` (telescoping), so the series is the two-sided inverse of `(I − xA)`. By Cramer's rule, `(I − xA)^{-1} = adj(I − xA) / det(I − xA)`, and every entry of the adjugate is a polynomial in `x`, giving a rational function with denominator `det(I − xA)`. ∎

**Corollary 8.3 (Linear recurrence on walk counts).** The denominator `det(I − xA)` is (up to reversal) the characteristic polynomial of `A` evaluated appropriately; it has degree `≤ n`. A rational generating function with denominator of degree `d` has coefficients satisfying a linear recurrence of order `≤ d`. Hence the sequence `(A^k)[i][j]` for fixed `i, j` obeys a **constant-coefficient linear recurrence of order at most `n`** — precisely the recurrence whose companion matrix is `A` restricted to the cyclic subspace, and the reason Kitamasa (Section 11) works.

**Connection to formal languages.** If `A` is the transition-count matrix of a finite automaton, `W_{ij}(x)` is the generating function counting accepted words by length. Theorem 8.2 is the algebraic statement that **regular languages have rational generating functions** — the transfer-matrix method of analytic combinatorics (Flajolet-Sedgewick, *Analytic Combinatorics*, Ch. V). The radius of convergence of `W_{ij}(x)` is `1/λ_max`, recovering the growth rate of Section 7 analytically: `[x^k] W_{ij}(x) ∼ C λ_max^k`.

### 8.1 Worked Transfer-Matrix Example

Count binary strings of length `k` with no two consecutive `1`s. States: `0` ("last bit 0 or empty"), `1` ("last bit 1"). Transition-count matrix `A = [[1,1],[1,0]]` (from state `0` you may append `0`→state `0` or `1`→state `1`; from state `1` you may only append `0`→state `0`). The generating function for total accepted words starting in state `0`:

```
W(x) = row_0 of (I − xA)^{-1} · (1,1)ᵀ.
det(I − xA) = det([1−x, −x; −x, 1]) = (1−x)·1 − (−x)(−x) = 1 − x − x².
```

So `W(x)` has denominator `1 − x − x²` — the Fibonacci generating function. Therefore the count satisfies `a_k = a_{k-1} + a_{k-2}` and equals `F_{k+2}` (with `a_1 = 2, a_2 = 3, a_3 = 5, …`). The transfer matrix *is* the graph adjacency matrix; the rational denominator `1 − x − x²` is the reversed characteristic polynomial of `A`, and its reciprocal root `φ` is the growth rate. This is the analytic shadow of the matrix-power computation, and it is exactly Task 8 in [`tasks.md`](./tasks.md).

---

## 9. Periodicity and the Structure of Powers

The sequence of matrices `A^0, A^1, A^2, …` over a *finite* semiring (e.g. Boolean, or counting mod `p`) is eventually periodic, which has algorithmic consequences.

**Theorem 9.1 (Eventual periodicity, Boolean case).** Over the Boolean semiring, the sequence `(A^k)_{k≥0}` is eventually periodic: there exist a **tail** `λ ≥ 0` (the index) and a **period** `π ≥ 1` with `A^{k+π} = A^k` for all `k ≥ λ`, and `λ + π ≤ 2^{n²}` (number of distinct Boolean matrices), in fact `λ ≤ n` and `π` divides the lcm of cycle lengths of the graph's cyclic structure for a strongly connected graph.

**Proof sketch.** There are only finitely many `n × n` Boolean matrices (`2^{n²}`), so by pigeonhole some power repeats: `A^{a} = A^{b}` with `a < b`. Multiplicativity then forces `A^{k+(b-a)} = A^k` for all `k ≥ a`. The refined bounds come from the cyclic/period structure of strongly connected components (the **index of imprimitivity**). ∎

**Significance.** For a strongly connected aperiodic Boolean graph, `A^k` stabilizes to the all-ones reachability pattern for `k ≥` the diameter-related bound, so "reachable in exactly `k` steps" eventually means "reachable", and the exact-length distinction vanishes for large `k`. For *periodic* graphs (period `d > 1`), `(A^k)[i][j]` is nonzero only when `k ≡ (level(j) − level(i)) (mod d)` — a parity/coloring constraint. This is why bipartite graphs (period 2) admit no odd-length closed walks: `(A^k)[i][i] = 0` for odd `k`.

**Counting case mod `p`.** Over `ℤ_p`, the matrices `A^k` also lie in a finite set (`p^{n²}` matrices), so the integer-mod sequence is eventually periodic with period dividing the order of `A` in the multiplicative monoid `GL`-or-`Mat_n(ℤ_p)`. When `A` is invertible mod `p`, the period divides `|GL_n(ℤ_p)|`. This is mostly of theoretical interest (the periods are astronomically large), but it guarantees the recurrence structure used by Kitamasa is finite-order over `ℤ_p`.

**Index of imprimitivity.** For a strongly connected graph, the **period** `d = gcd` of all cycle lengths partitions vertices into `d` classes such that every edge goes from class `c` to class `c+1 (mod d)`. Then `(A^k)[i][j] > 0` requires `k ≡ class(j) − class(i) (mod d)`. Detecting `d` is a BFS/DFS coloring task; it tells you in advance which `(i, j, k)` triples are forced to be zero, an `O(V + E)` pre-filter before any expensive power.

### 9.1 Worked Periodicity Example

The directed cycle on 3 vertices, `1→2→3→1`, has `A = [[0,1,0],[0,0,1],[1,0,0]]`. Its period is `d = 3` (the only cycle has length 3), and `A³ = I`. Hence the powers cycle with period 3:

```
A⁰ = I,  A¹ = A,  A² (the "back-shift"),  A³ = I,  A⁴ = A,  …
```

So `(A^k)[i][j] = 1` iff `k ≡ (j − i) (mod 3)` (vertices indexed `1,2,3` as classes `0,1,2`), and `0` otherwise. To answer "length-`10^{18}` walk `1 ⇝ 2`?" you need only `10^{18} mod 3 = 0`, and class difference `2 − 1 = 1 ≠ 0`, so the answer is `0` **without computing any power** — the periodicity pre-filter resolves it in `O(1)`. This is the practical payoff of Theorem 9.1: detect the period once, then resolve many queries by a modular comparison.

**Bipartite special case.** A bipartite graph has period `d = 2`: all closed walks have even length, so `(A^k)[i][i] = 0` for every odd `k`. Equivalently `A`'s spectrum is symmetric about `0` (eigenvalues come in `±λ` pairs), forcing `tr(A^k) = Σ λ_r^k = 0` for odd `k`. This is the algebraic statement that bipartite graphs have no odd cycles.

---

## 10. Walks vs Simple Paths: The #P-Hardness Gap

The efficiency of Section 6 hinges on counting *walks*. The analogous problem for *simple paths* is intractable.

**Definition 8.1.** `#k-PATHS`: given `G`, vertices `s, t`, and `k`, count the simple paths of length exactly `k` from `s` to `t`.

**Theorem 8.2.** Counting Hamiltonian paths (`k = n − 1` covering all vertices) is **#P-complete**, and `#k-PATHS` is #P-hard in general.

**Proof sketch.** The decision version — does a simple path of length `n−1` from `s` to `t` exist — is the Hamiltonian-path problem, NP-complete (Karp 1972). The counting version `#k-PATHS` therefore counts solutions to an NP-complete predicate; by Valiant's theory (Valiant 1979, *The complexity of computing the permanent*) such counting problems are #P-hard, and Hamiltonian-path counting is #P-complete. A polynomial algorithm would imply `P = NP` (for the decision version) and collapse `#P` into `FP`. ∎

**Why walks are easy but paths are hard.** The walk recurrence `W_k = W_{k-1} A` is *memoryless*: appending an edge needs only the current endpoint `t`, not the set of vertices already visited. The simple-path recurrence must track the visited set, blowing the state space up to `2^n` subsets. The standard `O(2^n · n²)` simple-path / Hamiltonian DP (Bellman-Held-Karp) carries exactly this subset state — exponential precisely because the "no repeats" constraint is non-local.

**Practical corollary.** Never use `(A^k)[i][j]` to answer a simple-path-count question. For small `n`, use subset-DP / color-coding (Alon-Yuster-Zwick gives `2^{O(k)}` randomized counting of length-`k` paths, parameterized by `k`, not `n`). For walks, matrix power is optimal up to the multiply constant.

### 10.1 Parameterized Landscape

The simple-path problem is tractable when parameterized by the *path length* `k` (not the graph size):

| Problem | Complexity | Method |
|---------|-----------|--------|
| Count length-`k` **walks** | `O(V³ log k)` | matrix power (this topic) |
| **Detect** length-`k` simple path | `O(2^k · poly)` randomized | color-coding (Alon-Yuster-Zwick 1995) |
| **Count** length-`k` simple paths | `#W[1]`-hard, `O(2^k poly)` for small `k` | inclusion-exclusion / algebraic |
| Count **Hamiltonian** paths (`k = n-1`) | `#P`-complete, `O(2^n n²)` | Bellman-Held-Karp subset DP |
| Longest simple path | `NP`-hard | no poly algorithm unless P=NP |

The gulf between row 1 (polynomial) and rows 2–5 (exponential) is the single most important practical fact about this topic: **the "no repeats" constraint is exactly what makes the difference**, because it destroys the memoryless property the matrix recurrence depends on.

### 10.2 Why the Memoryless Property Is Pivotal

The walk DP state is just "current vertex" — `V` states. The simple-path DP state is "current vertex **and** set of visited vertices" — `V · 2^V` states. Matrix exponentiation exploits that the walk transition is a *fixed linear operator* on the `V`-dimensional state, so iterating it `k` times is a `k`-th power, compressible to `O(log k)` via squaring. The simple-path transition is **not** a fixed linear operator on a small space — it acts on the `2^V`-dimensional space of subset-indexed vectors, and there is no analogous compression because the operator changes as the visited set grows. This is the structural reason one is in `P` and the other in `#P`.

**A vivid counterexample.** Consider a triangle `1→2→3→1` plus the back-edges making it undirected. The number of length-4 *walks* from `1` to `1` includes `1→2→1→2→1`, `1→2→3→... `, etc. — many revisit vertices. The number of length-4 *simple* paths from `1` to `1` is `0` (a simple path of length 4 would need 5 distinct vertices, but there are only 3). The matrix entry `(A⁴)[1][1]` is large; the simple-path count is `0`. They are not even close — proof that you cannot post-process the walk count into a simple-path count by any simple correction.

### 10.3 Approximate and Algebraic Workarounds

For *counting* length-`k` simple paths when `k` is small, the algebraic / inclusion-exclusion approach of Björklund-Husfeldt-Kaski-Koivisto runs in `O^*(2^k)` time. Color-coding gives a randomized `(1±ε)`-approximation in FPT time. None of these are matrix exponentiation, and none scale to `k = 10^{18}` — fixed-length *walk* counting is the only member of this family that handles astronomically large `k`, precisely because walks are the easy case.

---

## 11. Cayley-Hamilton and the Kitamasa Speedup

When only a *single* entry of `A^k` is needed (e.g. one term of an order-`r` linear recurrence), the full `O(r³ log k)` matrix power is wasteful. The insight: `A^k` lives in the at-most-`r`-dimensional algebra generated by `A` (spanned by `I, A, …, A^{r-1}` by Cayley-Hamilton), so it is determined by `r` scalars, not `r²`. Working with those `r` scalars — a polynomial of degree `< r` — instead of the full `r × r` matrix is the entire source of the speedup, and it is why the recurrence and the matrix are interchangeable encodings of the same linear operator.

**Theorem 9.1 (Cayley-Hamilton).** Every `n × n` matrix `A` satisfies its own characteristic polynomial: `χ_A(A) = 0`, where `χ_A(x) = det(xI − A)` has degree `n`.

**Consequence.** `A^n` is a linear combination of `I, A, …, A^{n-1}`. Hence `A^k mod χ_A(A)` can be represented by a polynomial of degree `< n`. Computing `x^k mod χ_A(x)` by polynomial binary exponentiation needs `O(log k)` polynomial multiplications and reductions, each of degree `< n`.

**Theorem 9.2 (Kitamasa complexity).** The `k`-th term of an order-`r` linear recurrence can be computed in `O(r² log k)` (schoolbook polynomial multiply) or `O(r log r log k)` (FFT/NTT multiply), versus `O(r³ log k)` for the matrix power.

**Proof idea.** Represent `A^k` modulo the minimal/characteristic polynomial as a degree-`<r` polynomial `p(x) = Σ_{m<r} c_m x^m`. Then `(A^k)·v₀ = Σ_m c_m (A^m v₀) = Σ_m c_m v_m`, where `v_m` are the first `r` known sequence states. Polynomial squaring + reduction is `O(r²)` (or `O(r log r)` with FFT) per step, and there are `O(log k)` steps. ∎

This is the same answer the matrix view gives — the matrix and the recurrence's companion polynomial are two encodings of one linear operator — but it removes a factor of `r` when only one term (not the full matrix) is required.

### 11.1 The Reduction in Detail

To compute the `k`-th term, work in the quotient ring `R = ℤ_p[x] / (χ(x))`, where `χ(x)` is the characteristic (or minimal) polynomial of the companion matrix, degree `r`. In `R`, the element `x` *acts as* the shift operator (it plays the role of `A`). Compute `x^k mod χ(x)` by binary exponentiation **of polynomials**:

```
KITAMASA(χ, k):                       # χ has degree r
  R := 1 (the polynomial constant 1)
  base := x
  while k > 0:
    if k & 1: R := (R · base) mod χ
    base := (base · base) mod χ
    k := k >> 1
  return R                            # a polynomial of degree < r
```

Each `·` is a degree-`< r` polynomial product (`O(r²)` schoolbook, or `O(r log r)` with NTT), and each `mod χ` is a polynomial division (same cost). With `O(log k)` iterations, total `O(r² log k)`. Finally, if `x^k ≡ Σ_{m=0}^{r-1} c_m x^m (mod χ)`, then `f(k) = Σ_{m=0}^{r-1} c_m f(m)`, a single `O(r)` dot product against the known initial terms. Correctness follows from Cayley-Hamilton: `χ(A) = 0` means `A` satisfies `χ`, so polynomial identities mod `χ` translate exactly into matrix identities, and `(x^k mod χ)(A) = A^k`.

### 11.2 When Each Tool Wins

| Need | Best tool | Cost |
|------|-----------|------|
| Full matrix `A^k` (all pairs) | matrix power | `O(r³ log k)` |
| One entry / one recurrence term, small `r` | matrix power (simpler) | `O(r³ log k)` |
| One recurrence term, large `r` (≥ ~64) | Kitamasa | `O(r² log k)` |
| One recurrence term, very large `r`, NTT-friendly `p` | Kitamasa + NTT | `O(r log r log k)` |

The crossover is around `r ≈ 64`: below it the cubic matrix power's simplicity and cache behavior often beat Kitamasa's polynomial bookkeeping; above it the `r`-factor saving dominates.

### 11.3 Sparse Companion Speedup

A useful middle ground: when the recurrence is **sparse** (only `s ≪ r` nonzero coefficients), the companion matrix has only `r + s` nonzero entries, so a single matrix-vector product is `O(r + s)` rather than `O(r²)`. Applying it `k` times directly (layered) is `O(k(r+s))` — good for small `k`. For large `k`, the companion matrix-power is still `O(r³ log k)` because *powers* of a sparse matrix densify, but Kitamasa with sparse polynomial reduction can exploit the sparsity of `χ` if `χ` itself is sparse. In practice, for the common case of a dense order-`r` recurrence with large `k`, Kitamasa at `O(r² log k)` (schoolbook) or `O(r log r log k)` (NTT, when `p` is NTT-friendly like `998244353`) is the production choice; the matrix view is the conceptual scaffolding that proves it correct.

---

## 12. Fast Matrix Multiplication and Lower Bounds

The `O(n³ log k)` bound assumes schoolbook multiply. Subcubic algorithms apply to the **counting/ring** semiring (which has additive inverses or at least the structure they exploit):

| Multiply algorithm | Exponent `ω` | Cost of `A^k` |
|--------------------|-------------|----------------|
| Schoolbook | 3 | `O(n³ log k)` |
| Strassen (1969) | 2.807 | `O(n^{2.807} log k)` |
| Coppersmith-Winograd & successors | 2.371552 (Williams-Xu-Xu-Zhou 2024) | `O(n^{ω} log k)` |

**Important restriction.** Strassen and its descendants require **subtraction** (a ring, not just a semiring). They apply to integer/modular counting but **not** to the min-plus or max-plus semirings, which lack additive inverses. The best known *general* min-plus matrix multiply is `O(n³ / 2^{Θ(√log n)})` (Williams 2014) — barely subcubic, and only via the "all-pairs shortest path is essentially min-plus matrix multiply" equivalence. It is widely conjectured (the **APSP / min-plus hypothesis**) that no truly subcubic (`O(n^{3-ε})`) min-plus multiply exists; this hypothesis is a pillar of fine-grained complexity.

**Lower bound (information-theoretic, trivial).** Reading the `n²` output entries forces `Ω(n²)`; reading the input forces `Ω(n²)`. The matrix-multiplication exponent `ω` is known to satisfy `2 ≤ ω < 2.3716`, and whether `ω = 2` is a major open problem. For practical graph sizes (`n ≤ few hundred`), Strassen's overhead rarely pays off, so schoolbook `O(n³ log k)` with cache tuning is the implementation of choice; sibling discussions of the multiply itself appear in `10-matrix-exponentiation` (`19-number-theory`).

### 12.1 Fine-Grained Equivalences

The min-plus matrix product is computationally equivalent to **All-Pairs Shortest Paths** (APSP): one min-plus multiply solves APSP on a 3-layer graph, and APSP solves min-plus multiply. The **APSP hypothesis** states APSP requires `n^{3−o(1)}` time. Under it, no truly subcubic min-plus matrix power exists, so the `O(n³ log k)` bound for fixed-length *shortest* walks is essentially tight (up to subpolynomial factors). This stands in sharp contrast to the counting case, where Strassen et al. give `O(n^ω log k)`.

The current best min-plus multiply, `n³ / 2^{Θ(√log n)}` (Williams 2014, via a Boolean-matrix / polynomial-method detour), is subcubic by only a subpolynomial factor — confirming the practical advice that for min-plus you should optimize the *constant* of schoolbook multiply (cache blocking, SIMD where the semiring allows) rather than hope for an asymptotic breakthrough.

**Why subtraction matters.** Strassen's `7`-multiply scheme for `2×2` blocks uses intermediate *differences* like `M₁ = (A₁₁ + A₂₂)(B₁₁ + B₂₂)` and recombines with `±`. Without additive inverses (min-plus has none — there is no `x` with `min(a, x) = +∞` acting as a subtraction), these cancellations are impossible. This is not a gap in cleverness but a provable barrier: any bilinear algorithm computing min-plus product with `o(n³)` operations would refute the APSP hypothesis. Hence the asymmetry — counting (a ring) can be subcubic; shortest-walk (a semiring without inverses) is conjecturally stuck at cubic.

### 12.2 Practical Exponent Selection

| `n` | Recommended multiply | Reason |
|-----|----------------------|--------|
| ≤ 128 | schoolbook, cache-blocked | Strassen overhead/recursion not worth it |
| 128–1024 (ring/counting) | Strassen down to a base case of ~64 | break-even region for `ω < 3` |
| ≥ 1024 (counting, `mod p`) | Strassen / library GEMM over `ℤ_p` | asymptotic gain real |
| any `n` (min-plus) | schoolbook, tuned constant | no useful subcubic algorithm |
| real-valued (Markov) | BLAS GEMM (OpenBLAS/MKL) | hardware-optimized, SIMD |

For graph problems the dimension is the *state count*, almost always small after minimization, so schoolbook with the `i, t, j` order and zero-skip is the realistic default; the asymptotic machinery matters only for the rare large-`n` ring instance.

### 12.3 Boolean Multiply via Bitsets

The Boolean semiring admits a practical (not asymptotic) speedup orthogonal to `ω`: pack each matrix row into machine words and compute `(A ⊗ B)[i] = ⋁_{t: A[i][t]=1} B[t]` as a word-parallel OR of selected rows. This processes 64 columns per instruction, giving an `O(n³ / 64)` *constant-factor* improvement — the famous "Four Russians"-adjacent trick. For exact-length reachability on graphs with a few thousand vertices, the bitset Boolean multiply is the difference between feasible and infeasible, and it composes cleanly with binary exponentiation since each squaring is just a Boolean multiply.

---

## 13. Summary

- **Walk-counting theorem.** `(A^k)[i][j]` counts length-`k` walks, proved by a one-line induction: each multiply appends one edge, summing over the penultimate vertex. The base case is `A^0 = I` (length-0 walks are the trivial stay-put walks).
- **Semiring generalization.** Matrix multiplication needs only a semiring `(⊕, ⊗, 0̄, 1̄)`. Associativity (Proposition 3.3) makes `A^k` and binary exponentiation valid over *any* semiring, so one proof covers counting `(+,×)`, shortest min-plus `(min,+)`, longest max-plus `(max,+)`, and reachability Boolean `(∨,∧)`.
- **Min-plus correctness.** `A^{(k)}[i][j]` is the cheapest exact-`k`-edge walk; the algebra is exactly the one underlying Floyd-Warshall (sibling `06-floyd-warshall`), but pinned to a fixed edge count and well-defined even with negative cycles.
- **Binary exponentiation.** Correct by the set-bit loop invariant and the commutativity of powers of one matrix; `O(n³ log k)` time, `O(n²)` space, at most `2⌊log₂ k⌋+2` multiplies.
- **Spectrum.** `(A^k)[i][j] = Σ_r c_{ijr} λ_r^k`; counts grow like `λ_max^k` (Perron-Frobenius / topological entropy). Eigenvalues give asymptotics, never exact integer counts — those require integer matrices mod a prime.
- **Generating functions.** `Σ_k A^k x^k = (I − xA)^{-1}` is a matrix of rational functions; every fixed-`(i,j)` walk-count sequence obeys a linear recurrence of order `≤ n` (transfer-matrix method), which is why regular languages have rational generating functions and why Kitamasa applies.
- **Periodicity.** Over a finite semiring the powers `A^k` are eventually periodic; the graph's index of imprimitivity `d` forces `(A^k)[i][j] = 0` unless `k ≡ class(j) − class(i) (mod d)` — an `O(V+E)` zero pre-filter (bipartite graphs being the `d = 2` special case).
- **Hardness gap.** Walks are easy because the recurrence is memoryless; counting *simple* paths of length `k` is #P-hard (Hamiltonian-path counting is #P-complete). Never conflate the two.
- **Single-term speedup.** Cayley-Hamilton + Kitamasa compute one recurrence term in `O(r² log k)`, shaving a factor of `r` off the matrix power when the full matrix is not needed.
- **Fast multiply.** Strassen/`ω`-algorithms apply to the ring (counting) case (`O(n^ω log k)`), but the min-plus semiring is conjectured to have no truly subcubic multiply (APSP hypothesis). For practical `n`, cache-tuned schoolbook is the right choice.

### Complexity Cheat Table

| Task | Semiring | Complexity | Tight? |
|------|----------|-----------|--------|
| Count length-`k` walks | `(+, ×)` mod `p` | `O(n³ log k)`, or `O(n^ω log k)` | `ω` open; `≥ Ω(n²)` |
| Shortest exact-`k` walk | `(min, +)` | `O(n³ log k)` | tight under APSP hypothesis |
| Longest exact-`k` walk | `(max, +)` | `O(n³ log k)` | tight under APSP hypothesis |
| Reachable in `k` steps | `(∨, ∧)` | `O(n³ log k)` | — |
| Closure / reach any length | `(∨, ∧)` | `O(n³)` Warshall | — |
| One recurrence term, order `r` | `(+, ×)` mod `p` | `O(r² log k)` Kitamasa | — |
| Count simple paths length `k` | — | `#P`-hard | no poly algorithm |

### Closing Notes

- **Generating-function duality** (Section 8): `Σ A^k x^k = (I − xA)^{-1}` makes the linear-recurrence structure and the rational-GF nature of regular-language counts a theorem, not a coincidence.
- **Periodicity** (Section 9): a one-time `O(V+E)` period detection turns many huge-`k` queries into `O(1)` modular comparisons, and explains bipartite/odd-cycle facts spectrally.
- **Kitamasa** (Section 11): the matrix and the characteristic polynomial are two faces of one operator; use the polynomial face to shave a factor of `r` for single-term queries with large order.
- **Idempotency** (Section 3): min-plus/max-plus/Boolean saturate (closures stabilize at `n−1`); counting grows geometrically (`λ_max^k`) — the same property that forces a modulus on the counting side enables clean "≤ k" closures on the optimization side.
- **Hardness boundary** (Section 10): the memoryless walk recurrence is in `P`; the visited-set-tracking simple-path recurrence is in `#P`. This single structural difference is the most important takeaway for choosing whether matrix exponentiation even applies.

Foundational references: the matrix-power walk theorem appears in any algebraic graph theory text (Biggs, *Algebraic Graph Theory*); Flajolet-Sedgewick (*Analytic Combinatorics*, Ch. V) for the transfer-matrix method and rational generating functions; Valiant (1979) for #P-completeness of the permanent / counting; Cayley-Hamilton and Kitamasa for recurrence reduction; Alon-Yuster-Zwick (1995) for color-coding; Strassen (1969) and Williams-Xu-Xu-Zhou (2024) for fast multiply; Williams (2014) for subcubic APSP. Sibling topics: `01-representation`, `06-floyd-warshall`, and `10-matrix-exponentiation` (`19-number-theory`).
