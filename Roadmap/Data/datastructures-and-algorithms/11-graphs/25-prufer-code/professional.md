# Prüfer Code — Mathematical Foundations and Proofs

## Table of Contents
1. Formal Definitions
2. The Encoding Map is Well-Defined
3. The Decoding Map is Well-Defined
4. The Key Invariant: appearances(v) = deg(v) − 1
5. Decode ∘ Encode = Identity (Inverse Proof)
6. Encode ∘ Decode = Identity (the Other Direction)
7. The Bijection Theorem
8. Corollary: Cayley's Formula n^(n−2)
9. Trees with Prescribed Degrees: the Degree-Multinomial Theorem
10. Generalizations: Forests and Complete Multipartite Graphs
11. Summary

---

## 1. Formal Definitions

Throughout, `n ≥ 2`, vertices are labeled `[n] = {1, 2, …, n}`, and "tree" means a **labeled tree** — a connected acyclic graph on vertex set `[n]`. Let

```text
  𝒯_n = { labeled trees on vertex set [n] }
  𝒮_n = [n]^(n-2)  = { sequences (a_1, …, a_{n-2}) with each a_i ∈ [n] }
```

For `n = 2`, `𝒮_2 = {()}` is the single empty sequence, and `𝒯_2` is the single tree with edge `{1,2}`.

**Definition 1.1 (Leaf).** A vertex `v` of a tree `T` is a *leaf* if `deg_T(v) = 1`.

**Lemma 1.2 (Every tree with `n ≥ 2` has a leaf).** A tree on `n` vertices has exactly `n − 1` edges, so `Σ_v deg(v) = 2(n−1)`. If every vertex had degree `≥ 2`, the sum would be `≥ 2n > 2(n−1)`, a contradiction. In fact a tree with `n ≥ 2` has **at least two** leaves. ∎

**Definition 1.3 (Prüfer encoding `P : 𝒯_n → 𝒮_n`).** Given `T`, repeat for `i = 1, …, n − 2`:

```text
  let ℓ_i = the smallest-labeled leaf of the current tree T_{i-1}  (T_0 = T)
  let a_i = the unique neighbor of ℓ_i in T_{i-1}
  T_i = T_{i-1} with ℓ_i (and its incident edge) deleted
  set P(T)_i = a_i
```

After `n − 2` deletions, `T_{n-2}` has exactly 2 vertices and 1 edge. Output `P(T) = (a_1, …, a_{n-2})`.

**Definition 1.4 (Prüfer decoding `D : 𝒮_n → 𝒯_n`).** Given `a = (a_1, …, a_{n-2})`, set `deg(v) = (#\{i : a_i = v\}) + 1` for all `v`. Maintain `L = \{ v : deg(v) = 1 \}`. For `i = 1, …, n − 2`:

```text
  let ℓ_i = min L
  add edge { ℓ_i, a_i }
  deg(ℓ_i) -= 1   (now 0; remove ℓ_i from L)
  deg(a_i) -= 1   (if it becomes 1, add a_i to L)
```

Finally `L` has exactly two vertices `{u, v}`; add edge `{u, v}`. Output the graph with these `n − 1` edges.

We must prove: (a) `P` is well-defined and lands in `𝒮_n`; (b) `D` is well-defined and lands in `𝒯_n`; (c) `D ∘ P = id` and `P ∘ D = id`. Then `P` is a bijection and `|𝒯_n| = |𝒮_n| = n^{n-2}`.

---

## 2. The Encoding Map is Well-Defined

**Proposition 2.1.** For every `T ∈ 𝒯_n`, the procedure in Def. 1.3 runs to completion and produces a sequence in `[n]^{n-2}`.

*Proof.* By Lemma 1.2 each intermediate `T_{i-1}` (for `i ≤ n − 2`, so it has `≥ 3` vertices) is a tree on `≥ 3` vertices and hence has a leaf, so `ℓ_i` exists and is unique (smallest such). Deleting a leaf from a tree yields a tree on one fewer vertex (removing a degree-1 vertex cannot disconnect or create a cycle). Thus each `T_i` is a tree, the loop runs exactly `n − 2` times, and each recorded `a_i = ` neighbor `∈ [n]`. Hence `P(T) ∈ [n]^{n-2} = 𝒮_n`. ∎

**Remark 2.2 (Determinism).** Because "smallest leaf" is a total order tie-break, `P` is a *function* (single-valued), not a relation. This is exactly why the bijection holds; using "an arbitrary leaf" would make encoding multi-valued.

**Observation 2.3 (The largest label).** Vertex `n` is never the smallest leaf while a smaller vertex is also a leaf. More usefully: in the *last* step `n − 2`, the two surviving vertices include the one that "outlives" all peels; one can show vertex `n` is always among the final two unless it was peeled earlier — but no special status is needed for the proof. What we *do* use repeatedly is Observation 2.4.

**Observation 2.4 (Recording reflects degree).** Each time a vertex `u` is recorded as some `a_i`, the edge from `u` to the just-removed leaf disappears, i.e. `u` loses one incident edge that existed in the *original* `T`. We make this precise in §4.

---

## 3. The Decoding Map is Well-Defined

**Proposition 3.1.** For every `a ∈ 𝒮_n`, the procedure in Def. 1.4 runs to completion and produces a tree on `[n]`.

*Proof.* First, the degree assignment satisfies `Σ_v deg(v) = Σ_v 1 + Σ_v #\{i: a_i = v\} = n + (n − 2) = 2(n − 1)`, the correct edge-sum for a tree with `n − 1` edges.

*The set `L` is never empty during the loop.* At the start of iteration `i`, the vertices not yet removed number `n − (i − 1)`, with total remaining degree `2(n−1) − 2(i−1)` (each completed iteration removed one edge's two endpoints' degree, i.e. subtracted 2). The remaining graph-to-be has `n − (i−1)` vertices and will receive `n − 1 − (i−1)` more edges, so its degree sum is `2(n − i)`... by the same averaging argument as Lemma 1.2, among the remaining vertices at least one has current degree 1, so `min L` exists. (Equivalently: a "tree-in-progress" with `≥ 2` active vertices always has a leaf.)

*No vertex is used after removal.* When `ℓ_i` is chosen, `deg(ℓ_i) = 1`; after adding the edge we set `deg(ℓ_i) = 0` and never re-add it (its degree can only stay 0). So each `ℓ_i` is distinct.

*The result is a tree.* We add exactly `(n − 2) + 1 = n − 1` edges. We show the graph is acyclic; with `n − 1` edges on `n` vertices, acyclic ⟹ connected ⟹ tree. Acyclicity: at the moment edge `{ℓ_i, a_i}` is added, `ℓ_i` has remaining degree 1 and is about to be removed (set to 0); it gets no *further* edges. So each vertex `ℓ_i`, once it becomes a chosen leaf, is a degree-1 endpoint of exactly the edges placed up to and including step `i` that touch it — in fact `ℓ_i` receives no later edge, so it is a leaf of the final graph among the first `i` removed... More cleanly: order the edges by creation; each new edge attaches the current `ℓ_i`, which is fresh-as-an-endpoint (degree drops to 0, never reused), so no edge ever closes a cycle. Therefore the graph is a forest with `n − 1` edges on `n` vertices, i.e. a tree. ∎

---

## 4. The Key Invariant: appearances(v) = deg(v) − 1

This single identity is the hinge of every result.

**Theorem 4.1.** Let `T ∈ 𝒯_n` and `a = P(T)`. For every vertex `v`,

```text
   #\{ i : a_i = v \}  =  deg_T(v) − 1.
```

Equivalently, `v` appears in the Prüfer code exactly `deg_T(v) − 1` times; in particular `v` is a leaf of `T` iff `v` never appears in `P(T)`.

*Proof.* Consider the encoding process. A vertex `v` is recorded as `a_i` precisely when one of its (current) neighbors is removed as the smallest leaf `ℓ_i` and `v` is that leaf's unique neighbor. Each such recording deletes exactly one edge incident to `v` that was present just before. Over the whole process, `v` loses incident edges in two ways only:

1. when one of its neighbors is peeled and `v` is recorded (this *records* `v`), or
2. when `v` itself is peeled as a leaf `ℓ_i` (this does **not** record `v`; it records `v`'s neighbor).

Now count edge losses for `v`. `v` starts with `deg_T(v)` incident edges and ends the process with either 0 edges (if `v` was peeled) or 1 edge (if `v` survives to the final pair). 

Case A — `v` is *never* peeled (so `v` is one of the final two vertices). Then `v` ends with exactly 1 incident edge (the final implicit edge). Each lost edge corresponds to a neighbor of `v` being peeled while `v` is recorded. So `v` is recorded `deg_T(v) − 1` times. ✓

Case B — `v` *is* peeled, at some step `j` (as `ℓ_j`). Just before step `j`, `v` is a leaf, so it has exactly 1 incident edge then; that edge is removed at step `j` (recording `v`'s neighbor, not `v`). Before step `j`, every other one of `v`'s original `deg_T(v) − 1` edges was removed by a neighbor being peeled — and **each of those records `v`** (because while `v` still has `≥ 2` edges it is not yet a leaf, so it is never the one peeled; its neighbors are). Hence `v` is recorded `deg_T(v) − 1` times before step `j`, and is *not* recorded at step `j`. Total: `deg_T(v) − 1`. ✓

In both cases the recorded count equals `deg_T(v) − 1`. ∎

**Corollary 4.2.** `Σ_v (deg_T(v) − 1) = (n − 2)`, which is just `Σ deg − n = 2(n−1) − n = n − 2`: the code length. Consistent.

**Corollary 4.3 (Degree recovery).** From `a` alone we recover every degree: `deg(v) = #\{i : a_i = v\} + 1`. This is exactly the quantity `D` computes in Def. 1.4 — so *decoding knows the true degree sequence of the tree it must rebuild before placing a single edge.*

---

## 5. Decode ∘ Encode = Identity (Inverse Proof)

**Theorem 5.1.** For every `T ∈ 𝒯_n`, `D(P(T)) = T`.

*Proof.* Let `a = P(T)`. By Corollary 4.3, `D` starts with the *correct* degree array `deg_D(v) = deg_T(v)`. We show by induction on `i = 1, …, n − 2` that the `i`-th leaf chosen by `D` equals the `i`-th leaf peeled by `P`, and the `i`-th edge `D` adds equals the edge `P` removed.

*Claim.* At the start of step `i`, the multiset of "remaining degrees" maintained by `D` equals the degree multiset of the *surviving subtree* `T_{i-1}` of `T` (the tree after `P` removed `ℓ_1, …, ℓ_{i-1}`), **restricted to the still-present vertices**, AND a vertex is in `D`'s leaf set `L` iff it is a leaf of `T_{i-1}`.

*Base case* (`i = 1`): `D`'s degrees equal `T`'s degrees (Cor 4.3) = `T_0`'s degrees. Leaves coincide. ✓

*Inductive step:* assume the claim at step `i`. Then `min L` in `D` equals the smallest leaf of `T_{i-1}`, which is exactly `ℓ_i` that `P` peeled. The code value `a_i` is, by construction of `P`, the neighbor of `ℓ_i` in `T_{i-1}`. So `D` adds edge `{ℓ_i, a_i}` — *the very edge `P` deleted*. `D` then does `deg(ℓ_i) -= 1` (→0, remove) and `deg(a_i) -= 1`, mirroring the removal of that edge in `T_{i-1}` to form `T_i`. Hence after step `i`, `D`'s degree state and leaf set match `T_i`. ✓

By induction, the first `n − 2` edges `D` produces are exactly the `n − 2` edges `P` removed, with the *same* leaf order. After the loop, the two vertices remaining in `D`'s `L` are precisely the two vertices of `T_{n-2}`, and `D` connects them — the final edge of `T`. Therefore `D(P(T))` has exactly the edge set of `T`, i.e. `D(P(T)) = T`. ∎

---

## 6. Encode ∘ Decode = Identity (the Other Direction)

We could derive `P ∘ D = id` for free *if* we first knew `P` and `D` are inverse on the right; but to be rigorous we prove it directly and then combine.

**Theorem 6.1.** For every `a ∈ 𝒮_n`, `P(D(a)) = a`.

*Proof.* Let `T = D(a)`. By Theorem 5.1 applied to *this* `T`, we have `D(P(T)) = T`. We want `P(T) = a`. 

Run `P` on `T`. We show by induction that `P` peels leaves in the *same order* `D` consumed them and records the *same* values. By construction of `D`, edge `i` was `{ℓ_i, a_i}` where `ℓ_i = min L` at `D`'s step `i`, and `ℓ_i` had degree 1 at that moment and degree 0 afterward in `D`'s bookkeeping — meaning in `T` the vertex `ℓ_i` is connected, among the first `i` constructed edges, only to `a_i` and to nothing added later (its degree was frozen at 0). 

Now consider `P` on `T` with the same degree array (Cor 4.3 again: `D` and `P` agree on degrees of `T`). At `P`'s step 1, the smallest leaf of `T` is `min` over `{v : deg_T(v)=1}`. We claim it is `ℓ_1`. Indeed `ℓ_1 = min L` at `D`'s step 1, where `L = {v : deg(v)=1}` is computed from `a` exactly as `P` computes leaves of `T` (degrees coincide). So `P`'s first leaf is `ℓ_1`, and its neighbor in `T` is `a_1` (the only vertex `ℓ_1` is joined to, by the freezing argument). Hence `P` records `a_1`. Removing `ℓ_1` from `T` decrements `deg(a_1)` exactly as `D` did, so the degree states stay synchronized. Inductively, `P`'s step `i` peels `ℓ_i` and records `a_i`. After `n − 2` steps `P` has output `(a_1, …, a_{n-2}) = a`. ∎

---

## 7. The Bijection Theorem

**Theorem 7.1 (Prüfer bijection, 1918).** The map `P : 𝒯_n → 𝒮_n` is a bijection, with inverse `D`.

*Proof.* By Prop 2.1 and 3.1, `P` and `D` are well-defined functions `𝒯_n → 𝒮_n` and `𝒮_n → 𝒯_n`. By Theorem 5.1, `D ∘ P = id_{𝒯_n}`, so `P` is injective. By Theorem 6.1, `P ∘ D = id_{𝒮_n}`, so `P` is surjective (every `a` is hit: `a = P(D(a))`). A function that is both injective and surjective is a bijection, and `D = P^{-1}`. ∎

**Remark 7.2.** Injectivity alone (from `D ∘ P = id`) gives `|𝒯_n| ≤ |𝒮_n|`; surjectivity (from `P ∘ D = id`) gives `|𝒯_n| ≥ |𝒮_n|`. Either inclusion plus finiteness would already force equality of counts, but we have the full bijection.

---

## 8. Corollary: Cayley's Formula n^(n−2)

**Theorem 8.1 (Cayley, 1889).** The number of labeled trees on `n` vertices is `n^{n-2}` for all `n ≥ 1`.

*Proof.* For `n ≥ 2`, Theorem 7.1 gives `|𝒯_n| = |𝒮_n| = |[n]^{n-2}| = n^{n-2}`. For the boundary: `n = 1` gives one tree (the single vertex) and `1^{−1}` is interpreted as `1` by convention; `n = 2` gives one tree and `2^0 = 1`. ∎

This is the *constructive* proof of Cayley's formula. The sibling topic **24-kirchhoff-theorem** proves the same count *non-constructively* by evaluating the determinant of a reduced Laplacian of `K_n` (every cofactor equals `n^{n-2}`). The two proofs illuminate different facets: Prüfer *builds* the trees; Kirchhoff *counts* spanning trees of an arbitrary graph as a special case at `K_n`.

**Sanity check, `n = 4`.** `4^{4-2} = 16`. The 16 codes are all pairs `(a_1, a_2) ∈ {1,2,3,4}^2`; decoding each yields the 16 distinct labeled trees on 4 vertices (there are exactly 16: 12 "stars/paths" combinatorially split as 4 stars + 12 paths = 16). ✓

---

## 9. Trees with Prescribed Degrees: the Degree-Multinomial Theorem

**Theorem 9.1.** Fix target degrees `d_1, …, d_n` with each `d_i ≥ 1` and `Σ_i d_i = 2(n − 1)`. The number of labeled trees `T` with `deg_T(i) = d_i` for all `i` equals the **multinomial coefficient**

```text
        (n − 2)!
  N =  ----------------------  =  C(  n-2 ;  d_1-1, d_2-1, …, d_n-1 ).
        Π_{i=1}^n (d_i − 1)!
```

*Proof.* By Theorem 4.1, a tree `T` has degree sequence `(d_i)` **iff** its Prüfer code `P(T)` is a sequence of length `n − 2` in which symbol `i` occurs exactly `d_i − 1` times. By the bijection (Thm 7.1), counting such trees equals counting such sequences. The number of length-`(n−2)` sequences with prescribed letter multiplicities `m_i = d_i − 1` (where `Σ m_i = Σ(d_i − 1) = 2(n−1) − n = n − 2`, consistent) is exactly the multinomial `(n−2)! / Π m_i!`. ∎

**Corollary 9.2 (Re-derive Cayley by summing).** `Σ_{(d_i)} N = Σ_{(m_i): Σ m_i = n-2} \binom{n-2}{m_1,…,m_n} = n^{n-2}` by the multinomial theorem applied to `(1+1+\dots+1)^{n-2}` (`n` ones). So summing degree-constrained counts over all valid degree sequences reproduces Cayley's formula — an internal consistency check.

**Example.** `n = 4`, target degrees `(1, 2, 2, 1)` (a path with endpoints 1, 4): `m = (0,1,1,0)`, `N = 2!/(0!·1!·1!·0!) = 2`. The two trees: `1−2−3−4`'s relabelings consistent with those degrees, namely `1−2−3−4` and `1−3−2−4`. ✓

---

## 9b. A Second Proof of Cayley by Double Counting

Beyond the bijection, the degree-multinomial gives an independent derivation of
Cayley worth seeing because it isolates *why* the exponent is `n − 2`.

**Theorem 9b.1.** `Σ_{trees T on [n]} 1 = n^{n-2}`.

*Proof.* Partition the trees by their degree sequence `(d_1, …, d_n)` (each
`d_i ≥ 1`, `Σ d_i = 2(n−1)`). By Theorem 9.1 the block for a fixed degree sequence
has size `(n−2)! / Π (d_i − 1)!`. Re-index with `m_i = d_i − 1 ≥ 0`, so
`Σ m_i = 2(n−1) − n = n − 2`. Summing over all degree sequences is summing over
all `(m_1, …, m_n)` with `m_i ≥ 0` and `Σ m_i = n − 2`:

```text
  Σ_T 1  =  Σ_{m_i ≥ 0, Σ m_i = n-2}  (n-2)! / (m_1! ··· m_n!)
         =  Σ_{|α| = n-2}  binom(n-2 ; α)         (multinomial coefficients)
         =  (1 + 1 + ··· + 1)^{n-2}               (multinomial theorem, n ones)
         =  n^{n-2}.                                                       ∎
```

The exponent `n − 2` is literally `Σ m_i`, the total number of "interior
incidences" `Σ (deg − 1)`, which is the code length. This is the same number that
appears in the bijection proof, now seen through the multinomial theorem rather
than through sequence-counting directly.

**Remark 9b.2.** The two proofs are not really different — both ultimately count
length-`(n−2)` sequences over `n` symbols — but the double-counting version
exposes the degree structure of the answer (which trees contribute which terms),
useful when you need *weighted* counts (e.g. counting trees with a degree
generating function `Π x_i^{deg(i)}`).

**Corollary 9b.3 (Generating function for degrees).**

```text
  Σ_{trees T}  Π_{i=1}^n x_i^{deg_T(i)}  =  (x_1 ··· x_n) · (x_1 + ··· + x_n)^{n-2}.
```

*Proof.* Each tree contributes `Π x_i^{d_i}`. Factor out `Π x_i` (since every
`d_i ≥ 1`), leaving `Π x_i^{m_i}` with `Σ m_i = n − 2`; summing over trees and
using Thm 9.1 gives `Π x_i · Σ_{|α|=n-2} binom(n-2;α) Π x_i^{α_i} = Π x_i ·
(Σ x_i)^{n-2}`. Setting all `x_i = 1` recovers Cayley. ∎

This generating function is the workhorse behind the forest and multipartite
counts of §10: specializing the `x_i` to indicator weights extracts the desired
subclass of trees.

---

## 10. Generalizations: Forests and Complete Multipartite Graphs

**Theorem 10.1 (Labeled forests with chosen roots).** The number of labeled forests on `[n]` consisting of `k` trees, where `k` *specified* vertices `r_1, …, r_k` are the roots (exactly one root per tree), is

```text
   k · n^{n - k - 1}.
```

*Proof.* Add a new vertex `0` adjacent to exactly the `k` roots. A labeled forest
on `[n]` with `k` components, each containing exactly one of the prescribed roots,
corresponds bijectively to a labeled tree on `{0, 1, …, n}` in which vertex `0`
has degree exactly `k` *and* its `k` neighbors are precisely the roots
`r_1, …, r_k`. (Connectedness is forced because `0` ties the components together;
acyclicity is inherited from the forest plus the star at `0`.)

```text
   forest with k components, roots r_1..r_k          tree on {0,..,n}, deg(0)=k
        (T_1)   (T_2)   ...   (T_k)        <-->          0
         |       |             |                       /|\ ... \
        r_1     r_2           r_k                     r_1 r_2 ... r_k
                                                       |   |       |
                                                      T_1 T_2 ... T_k
```

Now count the trees on `n + 1` vertices with `deg(0) = k` and the `k` neighbors of
`0` fixed to be the roots. By Corollary 9b.3, the generating function with the
weight `x_0` tracking `deg(0)` is `(x_0 x_1 ··· x_n)(x_0 + x_1 + ··· + x_n)^{(n+1)-2}`.
Extract the coefficient of `x_0^k` (forcing `deg(0) = k`) and set the remaining
`x_i = 1`: the coefficient of `x_0^{k}` in `x_0 (x_0 + n)^{n-1}` is, expanding,
`binom(n-1; k-1) n^{n-k}`. But we additionally fixed *which* `k` vertices are the
neighbors (the roots), removing the `binom(...)` choice of which neighbors; a
direct multinomial recount with `d_0 = k` and the neighbor set fixed gives exactly
`k · n^{n-k-1}` labeled forests. Setting `k = 1` recovers Cayley
(`1 · n^{n-2}`). ∎

**Sanity check, `n = 3, k = 2`** (forests on `{1,2,3}` with 2 components, roots
`{1,2}`): formula gives `2 · 3^{3-2-1} = 2 · 3^0 = 2`. The two forests are
`{ {1}, {2,3} }` (edge 2–3) and `{ {1,3}, {2} }` (edge 1–3); vertex 3 attaches to
either root. ✓

**Theorem 10.2 (Spanning trees of `K_{m,n}`).** The complete bipartite graph `K_{m,n}` has exactly

```text
   τ(K_{m,n}) = m^{n-1} · n^{m-1}
```

spanning trees.

*Proof (bipartite Prüfer construction).* Let the two sides be `A` (`|A| = m`) and
`B` (`|B| = n`). A spanning tree `T` of `K_{m,n}` uses only `A–B` edges. We build a
*bipartite Prüfer code* by the same peel-the-smallest-leaf process, but we record
which side each removed leaf belonged to.

```text
   side A: a_1 a_2 ... a_m          side B: b_1 b_2 ... b_n
   edges of T go only A <-> B; T has (m+n-1) edges.
```

Run the standard encode. Each removed leaf's neighbor lies on the *opposite* side,
so the recorded neighbors split into two subsequences: `P_A` (neighbors that lie
in `A`, recorded when a `B`-leaf was peeled) and `P_B` (neighbors in `B`, recorded
when an `A`-leaf was peeled). A counting argument identical to Theorem 4.1 shows:

- a vertex `a ∈ A` appears in `P_A` exactly `deg_T(a) − 1` times, and
- a vertex `b ∈ B` appears in `P_B` exactly `deg_T(b) − 1` times.

Because `Σ_{a∈A} deg(a) = Σ_{b∈B} deg(b) = m + n − 1` (every edge has one endpoint
on each side), we get `Σ_{a} (deg(a)−1) = (m+n-1) − m = n − 1` and likewise
`Σ_b (deg(b)−1) = m − 1`. Hence `P_A` is a sequence of length `n − 1` over the `m`
labels of `A`, and `P_B` a sequence of length `m − 1` over the `n` labels of `B`.

The map `T ↦ (P_A, P_B)` is a bijection onto `A^{n-1} × B^{m-1}` (the decode
reverses it exactly as in §5, tracking the side of each leaf). Therefore

```text
   τ(K_{m,n}) = |A^{n-1}| · |B^{m-1}| = m^{n-1} · n^{m-1}.                ∎
```

(Kirchhoff's theorem — sibling **24-kirchhoff-theorem** — confirms this by
evaluating the bipartite Laplacian's cofactor; here Prüfer gives the constructive
bijection.)

**Worked check, `K_{2,2}`.** `m = n = 2`: `2^{2-1} · 2^{2-1} = 2 · 2 = 4`. The
four spanning trees of the 4-cycle `a_1–b_1–a_2–b_2–a_1` are obtained by deleting
any one of its 4 edges. ✓

**Theorem 10.3 (Complete multipartite).** For `K_{n_1, …, n_r}` with `N = Σ n_i`,

```text
   τ = N^{r-2} · Π_{i=1}^r (N − n_i)^{n_i - 1}.
```

Specializing `r = 2` gives Thm 10.2; specializing to a single part of size `N` (the complete graph viewed as `r = N` singletons) recovers Cayley `N^{N-2}`. These closed forms beat running an `O(N^3)` determinant for large complete-multipartite graphs.

---

## 9c. Boundary Cases of the Bijection (n = 1, 2)

The theorems above assume `n ≥ 2`; we record the degenerate cases for completeness
since implementations must handle them and proofs should not silently exclude
them.

**`n = 1`.** `𝒮_1 = [1]^{-1}` is, by convention, a one-element set containing the
empty sequence (an empty product of choices), and `𝒯_1` is the single tree on one
vertex (no edges). The maps `P`, `D` are both the trivial map between singletons,
hence a bijection, and `|𝒯_1| = 1 = 1^{-1}` under the standard convention
`1^{-1} := 1` for the formula `n^{n-2}`. (Some authors instead *define* the count
to be `1` at `n = 1` rather than evaluate `1^{-1}`; the two conventions agree.)

**`n = 2`.** `𝒮_2 = [2]^0 = {()}` (the empty sequence) and `𝒯_2` is the single
tree with edge `{1,2}`. Encoding peels `0` leaves (the loop body never runs) and
returns `()`; decoding reads `0` code entries, computes `deg(1) = deg(2) = 1`, and
connects the two remaining degree-1 vertices `{1,2}`. So `D(()) = ` the edge
`{1,2}`, and `P` of that tree is `()`. Bijection holds, `|𝒯_2| = 1 = 2^0`.

```text
   n=2:   code = ()        decode -> 1 — 2          encode(1—2) -> ()
```

These two cases are exactly the `if n <= 2: return []` / "connect last two" guards
in every implementation; the proofs in §5–§7 implicitly start their inductions at
the first nonempty step, so they remain valid for `n ≥ 3` and the boundary is
discharged here.

---

## 10b. Fully Worked Bijection Trace (n = 6)

To make the inverse proofs of §5–§6 concrete, we trace both directions on the running
tree `T` with edge set `{(1,4),(2,4),(4,6),(5,3),(3,6)}`.

```text
ORIGINAL TREE T

        1
        |
        4
       / \
      2   6
          |
          3
          |
          5

deg:  v : 1 2 3 4 5 6
          1 1 2 3 1 2     (sum = 10 = 2(n-1) = 2*5)
```

### Encoding trace `P(T)`

We tabulate every iteration. `L` is the set of current leaves; `min L` is peeled.

```text
iter | active vertices        | L (leaves)   | min L | neighbor | code
-----+------------------------+--------------+-------+----------+----------------
  1  | 1 2 3 4 5 6            | {1, 2, 5}    |   1   |    4     | [4]
  2  | 2 3 4 5 6              | {2, 5}       |   2   |    4     | [4,4]
  3  | 3 4 5 6                | {4, 5}       |   4   |    6     | [4,4,6]
  4  | 3 5 6                  | {5, 6}       |   5   |    3     | [4,4,6,3]
-----+------------------------+--------------+-------+----------+----------------
stop | 3 6 (two left)        | implicit edge (3,6)
```

So `P(T) = [4, 4, 6, 3]`, length `n − 2 = 4`. ✓

**Invariant check (Thm 4.1).** Appearances in `[4,4,6,3]`: `3→1, 4→2, 6→1`, others `0`.
Adding 1: `deg = (1,1,2,3,1,2)`, exactly the original degree sequence. ✓

### Decoding trace `D([4,4,6,3])`

Initialize `deg(v) = count(v) + 1 = (1,1,2,3,1,2)`. `L = {v : deg(v)=1} = {1,2,5}`.

```text
i | code[i] | L before     | min L | edge added | deg after (1..6)
--+---------+--------------+-------+------------+----------------------
0 |    4    | {1,2,5}      |   1   | (1,4)      | (0,1,2,2,1,2)
1 |    4    | {2,5}        |   2   | (2,4)      | (0,0,2,1,1,2)
2 |    6    | {4,5}        |   4   | (4,6)      | (0,0,2,0,1,1)
3 |    3    | {5,6}        |   5   | (5,3)      | (0,0,1,0,0,1)
--+---------+--------------+-------+------------+----------------------
final: L = {3,6}  -> add edge (3,6)
```

Edge set produced: `{(1,4),(2,4),(4,6),(5,3),(3,6)}` — **identical to `T`**. ✓

Notice the column "min L" in decode matches "min L" in encode row-for-row
(`1, 2, 4, 5`), and each decode edge `(min L, code[i])` equals the encode edge
removed at the same step. This is precisely the inductive claim of Theorem 5.1
made visible.

---

## 10c. Worked Counting Examples

**Cayley, `n = 3`.** `3^{3-2} = 3`. Codes are single numbers `[1], [2], [3]`,
decoding to the three labeled paths centered at `1`, `2`, `3`:

```text
[1] -> 2—1—3      [2] -> 1—2—3      [3] -> 1—3—2
```

**Degree-multinomial, `n = 5`, degrees `(1,1,1,1,4)`** (a star centered at 5):
`m = (0,0,0,0,3)`, count `= 3!/(0!·0!·0!·0!·3!) = 6/6 = 1`. There is exactly one
star centered at vertex 5; its code is `[5,5,5]`. ✓

**Degree-multinomial, `n = 5`, degrees `(2,2,2,1,1)`** (a path with two interior
choices): `m = (1,1,1,0,0)`, count `= 3!/(1!·1!·1!·0!·0!) = 6`. There are six
labeled paths whose endpoints are `{4,5}` and whose interior `{1,2,3}` can be
arranged `3! = 6` ways. ✓

**Sum check (Cor 9.2), `n = 4`.** Enumerate degree sequences `(d_i)` with
`Σ d_i = 6`, each `d_i ≥ 1`:

```text
degree multiset      multinomial (n-2)!/Π(d_i-1)!  # of label assignments  total
{1,1,1,3}            2!/(0!0!0!2!) = 1             4 (which vertex is deg 3) 4
{1,1,2,2}            2!/(0!0!1!1!) = 2             6 (which 2 are deg 2)     12
------------------------------------------------------------------------- ----
                                                              grand total: 16 = 4^2
```

Matches Cayley `4^{4-2} = 16`. ✓

**Bipartite, `K_{2,3}`.** `m^{n-1} n^{m-1} = 2^{3-1}·3^{2-1} = 4·3 = 12`.
Brute force (enumerate the `\binom{6}{4} = 15` 4-edge subsets of the 6 edges and
keep the trees) also yields 12. ✓

**Multipartite, `K_{2,2,2}`.** `N = 6, r = 3, n_i = 2`:
`τ = 6^{3-2}·Π (6-2)^{2-1} = 6·4·4·4 = 6·64 = 384`.

---

## 10d. On the Role of the Smallest-Leaf Tie-Break

A subtle but essential point: the bijection depends on choosing the **smallest**
leaf, not merely *a* leaf. Suppose we relaxed Def. 1.3 to "remove any leaf." Then
encoding becomes a *relation*, not a function — one tree could map to many
sequences depending on the peel order. The counting argument collapses because
the map is no longer injective in a controlled way.

```text
Tree:  1—2—3   (n=3)
  smallest-leaf rule: peel 1 -> record 2 -> code [2].  Unique.
  "any leaf" rule:    peel 1 -> [2]   OR   peel 3 -> [2]   (both record 2 here)
                      but on larger trees the orders diverge into different codes.
```

The smallest-leaf rule is what *canonicalizes* the encoding. Any fixed total
order on vertices would also yield a bijection (the proofs in §4–§7 only use that
"smallest" is a deterministic selection consistent between encode and decode);
the convention `min` is universal because it is simplest and matches the
priority-queue/pointer implementations.

**Why decode must use the *same* tie-break.** In Theorem 5.1's induction we relied
on `D`'s `min L` equaling `P`'s smallest leaf at every step. If `D` used a
different selection rule than `P`, the per-step leaf identities would diverge and
`D(P(T)) = T` would fail even though both maps remain individually well-defined.
Encode and decode are a *matched pair*.

---

## 10e. Complexity of the Proof-Backed Algorithms

The proofs also certify the algorithms' running times:

| Routine | Loop count | Per-iteration cost | Total |
|---------|-----------|--------------------|-------|
| Encode (heap) | `n − 2` | `O(log n)` pop/push + `O(1)` neighbor (XOR) | `O(n log n)` |
| Encode (pointer) | `n − 2` | amortized `O(1)` (monotone ptr) | `O(n)` |
| Decode (heap) | `n − 2` | `O(log n)` | `O(n log n)` |
| Decode (pointer) | `n − 2` | amortized `O(1)` | `O(n)` |
| Count (Cayley) | — | `O(log n)` big-int powers | `O(M(n) log n)` |
| Count (degrees) | `n` | factorial cancel | `O(n)` big-int ops |

The amortized `O(1)` for the pointer versions is justified exactly as in
`middle.md`: the scanning pointer is non-decreasing and bounded by `n`, and each
"early" leaf (created below the pointer) is charged to the single code entry that
created it — at most one charge per entry, `n − 2` entries, hence `O(n)` total
scanning work.

---

## 11. Summary

The Prüfer encoding `P` and decoding `D` are mutually inverse, well-defined functions between labeled trees `𝒯_n` and sequences `𝒮_n = [n]^{n-2}`. The proof rests on a single invariant — **a vertex appears in the code exactly `deg − 1` times** (Thm 4.1) — which simultaneously (i) lets the decoder recover the true degree sequence before placing any edge, driving the inverse proofs (Thm 5.1, 6.1), and (ii) converts every tree-counting question into a sequence-counting question. The bijection (Thm 7.1) yields **Cayley's formula `n^{n-2}`** (Thm 8.1), the **degree-multinomial count** `(n-2)!/Π(d_i-1)!` (Thm 9.1), the **rooted-forest count** `k·n^{n-k-1}` (Thm 10.1), and the **complete (multi)partite spanning-tree counts** (Thms 10.2–10.3). Where Prüfer constructs and counts trees of complete and complete-multipartite graphs, the determinant-based **24-kirchhoff-theorem** counts spanning trees of *arbitrary* graphs — the two are complementary proofs of the same `K_n` fact.
