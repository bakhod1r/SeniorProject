# Leftist Heap — Mathematical Foundations and Complexity Theory

The leftist heap, introduced by Clark A. Crane in his 1972 Stanford technical report *"Linear lists and priority queues as balanced binary trees"*, is one of the earliest mergeable priority queues. Unlike the binomial heap, which achieves logarithmic meld through a forest of perfectly structured trees, the leftist heap achieves the same bound with a single binary tree by enforcing a structural invariant on the *null path length*. Its analysis is one of the cleanest applications of structural induction in data structure theory, and it forms the foundation for Okasaki's persistent priority queues.

## Table of Contents
1. Formal Definition (heap-ordered + leftist invariant)
2. NPL Lemma — proof that NPL = r implies subtree size at least 2^r - 1
3. Right Spine O(log n) Bound (proof by NPL lemma)
4. Recursive Meld — Correctness via Structural Induction
5. Amortised Analysis vs Worst-Case (leftist is worst-case, not amortised)
6. Variants — Weight-Biased Leftist Heap, Persistent Leftist Heap
7. Comparison with Skew Heap (no NPL field — amortised analysis)
8. Comparison Matrix
9. Open Problems
10. Summary

---

## 1. Formal Definition

A **leftist heap** is a rooted binary tree `T` satisfying two invariants.

**Definition 1.1 (Heap order).** For every internal node `v` with key `k(v)` and child `c`,
```text
k(v) <= k(c)
```
(for a min-heap; reverse for max-heap).

**Definition 1.2 (Null Path Length).** The null path length `npl(v)` of a node `v` is the length of the shortest path from `v` to a descendant *external* (null) node. By convention,
```text
npl(null) = -1
npl(v)    = 1 + min(npl(left(v)), npl(right(v)))
```

**Definition 1.3 (Leftist invariant).** For every internal node `v`,
```text
npl(left(v)) >= npl(right(v))
```
That is, the left subtree's NPL is never smaller than the right subtree's NPL.

A consequence of Definition 1.3 is that the *shortest path from any node to a null descendant is the rightmost path* — the so-called **right spine**. All operations exploit this fact: insertion, deletion of the minimum, and meld all touch only nodes along right spines.

**Notation.** For a leftist heap `H`, let `n = |H|` be the number of nodes, `r(H) = npl(root(H))` the NPL of the root, and `R(H)` the length of the right spine (number of edges from root to its rightmost null descendant).

---

## 2. NPL Lemma — Size Lower Bound

The central structural fact is that NPL grows logarithmically in size.

**Lemma 2.1 (NPL size bound).** *If a leftist tree `T` has `npl(root(T)) = r`, then `|T| >= 2^(r+1) - 1`.*

Equivalently, if `T` has `n` nodes, then `npl(root) <= floor(log2(n + 1)) - 1`.

**Proof.** By induction on `r`.

*Base case* (`r = 0`). If `npl(root) = 0`, the root has at least one null child (otherwise NPL would be at least 1). The root itself contributes one node, so `|T| >= 1 = 2^1 - 1`. The bound holds.

*Inductive step.* Assume the lemma holds for all leftist trees with root NPL strictly less than `r`. Let `T` have `npl(root) = r >= 1`. By the recursive definition of NPL,
```text
r = npl(root) = 1 + min(npl(left), npl(right))
```
so `min(npl(left), npl(right)) = r - 1`. By the leftist invariant, `npl(left) >= npl(right)`, so both subtrees have NPL `>= r - 1`:
```text
npl(left)  >= r - 1
npl(right) >= r - 1
```
Both subtrees are leftist (the invariant is hereditary). By the induction hypothesis applied to each subtree,
```text
|left|  >= 2^r - 1
|right| >= 2^r - 1
```
Therefore
```text
|T| = 1 + |left| + |right|
    >= 1 + (2^r - 1) + (2^r - 1)
    =  2 * 2^r - 1
    =  2^(r+1) - 1.
```
This closes the induction.  ∎

**Corollary 2.2.** `r(H) <= floor(log2(n + 1)) - 1 = O(log n)`.

This is the structural lemma that drives every complexity bound for leftist heaps.

---

## 3. Right Spine is O(log n)

**Theorem 3.1.** *For any leftist heap `H` with `n` nodes, the length of the right spine satisfies `R(H) <= floor(log2(n + 1))`.*

**Proof.** Walk down the right spine from the root. At each step, NPL strictly decreases: if `v` is an internal node on the spine, then `npl(v) = 1 + npl(right(v))` (because `right(v)` realises the minimum in `npl(v) = 1 + min(...)`; if both children realised the minimum we can still pick the right). So `npl(right(v)) = npl(v) - 1`.

Therefore the sequence of NPLs along the right spine is
```text
npl(root), npl(root) - 1, npl(root) - 2, ..., 0, -1
```
and the spine length equals `npl(root) + 1`. By Corollary 2.2,
```text
R(H) = r(H) + 1 <= floor(log2(n + 1)).
```
∎

Since every leftist-heap operation does work proportional to the right spine, every operation runs in worst-case `O(log n)`. The proof above is fully constructive — no amortised potential argument is required.

---

## 4. Recursive Meld — Correctness by Structural Induction

The meld operation is the engine of the data structure: insert, find-min, delete-min, decrease-key, and merge are all expressed via meld.

### 4.1 Pseudocode

```text
function meld(H1, H2):
    if H1 = null: return H2
    if H2 = null: return H1
    if key(H1) > key(H2): swap H1 and H2
    // now key(H1) <= key(H2); H1 will be the root of the result
    right(H1) <- meld(right(H1), H2)
    if npl(left(H1)) < npl(right(H1)):
        swap left(H1) and right(H1)
    npl(H1) <- 1 + npl(right(H1))
    return H1
```

### 4.2 Correctness

**Theorem 4.1.** *For any two leftist heaps `H1` and `H2`, `meld(H1, H2)` returns a leftist heap whose multiset of keys equals the disjoint union of the keys of `H1` and `H2`.*

**Proof.** By structural induction on the *sum* of the right-spine lengths `R(H1) + R(H2)`.

*Base.* If either operand is null, the algorithm returns the other unchanged. The result is leftist by assumption and has the correct keys.

*Inductive step.* Assume both heaps are non-null. WLOG `key(H1) <= key(H2)` (the algorithm performs the swap). The recursive call is on `right(H1)` and `H2`. Both are leftist (the invariant is hereditary on subtrees). The recursive call's argument has spine sum
```text
R(right(H1)) + R(H2) = R(H1) - 1 + R(H2) < R(H1) + R(H2),
```
so the induction hypothesis applies: the recursive call returns a correct leftist heap `M` containing exactly the keys of `right(H1)` and `H2`.

We must verify three properties of the returned root `H1`:

1. **Heap order at root.** The new left child is the old `left(H1)`, whose key is `>= key(H1)` by the original heap order. The new right child is `M`. By the IH, `M`'s root has the minimum key among the keys of `right(H1)` and `H2`. The key of `right(H1)` was `>= key(H1)` (original heap order), and `key(H2) >= key(H1)` (the swap ensured this). So every key in `M` is `>= key(H1)`. Heap order at the root holds.

2. **Leftist invariant at root.** After the recursive call we explicitly swap if `npl(left) < npl(right)`. This enforces `npl(left) >= npl(right)` at the root.

3. **Leftist invariant in subtrees.** The left subtree is untouched; it was leftist. The right subtree is `M`, which is leftist by the IH. The swap permutes them, which preserves the property internally.

4. **NPL field.** We set `npl(H1) = 1 + npl(right(H1))`, which is correct because after the swap `right(H1)` has the smaller NPL.

5. **Key multiset.** The keys at the root remain `key(H1)`. The left subtree keeps its keys. The right subtree contains the keys of `right(H1)` and `H2` (by IH). Together this is exactly the original keys of `H1` and `H2`.

All properties hold; the induction closes.  ∎

### 4.3 Complexity

**Theorem 4.2.** *`meld(H1, H2)` runs in time `O(R(H1) + R(H2)) = O(log n1 + log n2) = O(log(n1 + n2))`.*

**Proof.** Each recursive call does `O(1)` work and shortens one of the right spines by one edge. The recursion bottoms out when one heap becomes null, after at most `R(H1) + R(H2)` calls. By Theorem 3.1 this is `O(log(n1 + n2))`.  ∎

### 4.4 Other operations from meld

```text
insert(H, k)     = meld(H, singleton(k))
findMin(H)       = key(root(H))
deleteMin(H)     = meld(left(root(H)), right(root(H)))
merge(H1, H2)    = meld(H1, H2)
```
All inherit `O(log n)` *worst-case* time. `findMin` is `O(1)`.

---

## 5. Amortised vs Worst-Case

A subtle point: the bounds proved above are **worst-case**, not amortised. Every individual operation is guaranteed to finish in `O(log n)` time. This contrasts with skew heaps and Fibonacci heaps, whose bounds hold only on average over a sequence of operations.

| Property | Leftist | Skew | Fibonacci |
|---|---|---|---|
| `meld`        | `O(log n)` worst-case | `O(log n)` amortised | `O(1)` amortised |
| `deleteMin`   | `O(log n)` worst-case | `O(log n)` amortised | `O(log n)` amortised |
| `decreaseKey` | `O(log n)` worst-case | `O(log n)` amortised | `O(1)` amortised |
| Extra field   | NPL (`O(log log n)` bits) | none | mark, degree, parent |

Worst-case bounds are preferable in real-time systems where any single slow operation can violate a deadline. Amortised bounds are preferable when total throughput is the only concern.

The price of leftist's worst-case bound is the explicit NPL field and the conditional swap during meld. Skew heaps drop the field and always swap, recovering simplicity at the cost of amortised analysis.

---

## 6. Variants

### 6.1 Weight-Biased Leftist Heap (WBLH)

Replace the NPL invariant by a *size* invariant: for every node `v`,
```text
|left(v)| >= |right(v)|
```
The size of each subtree replaces NPL as the rank. The right-spine length is still `O(log n)`: since at each step down the right spine the size at least halves (the right subtree has size at most half the parent), the spine has length `<= log2 n + 1`.

WBLH has two practical advantages:
1. **Top-down meld.** The size field permits a single top-down pass; no need to recurse and fix up NPL on the way back. This is cache-friendlier.
2. **Easier parallelisation.** Top-down meld can be pipelined.

The disadvantage: the size field is `O(log n)` bits per node, more than NPL's `O(log log n)` bits.

### 6.2 Persistent Leftist Heap (Okasaki 1998)

In *"Purely Functional Data Structures"* (Chapter 3.1), Okasaki shows that the recursive meld implementation is *naturally persistent*. The original heaps are not mutated; meld constructs a fresh right spine and shares everything off it. The persistent version achieves the same `O(log n)` worst-case bound per operation, with `O(log n)` additional space per update.

```text
function meld(H1, H2):  // persistent
    if H1 = E: return H2
    if H2 = E: return H1
    let T x_a l1 r1 = H1
    let T x_b l2 r2 = H2
    if x_a <= x_b:
        makeT x_a l1 (meld r1 H2)
    else:
        makeT x_b l2 (meld H1 r2)

function makeT(x, a, b):
    if rank(a) >= rank(b): T(x, rank(b)+1, a, b)
    else:                  T(x, rank(a)+1, b, a)
```
The structure is purely functional — no in-place updates. Old versions remain valid and queryable. Each operation allocates `O(log n)` new nodes.

**Theorem 6.1 (Okasaki).** *The persistent leftist heap supports `insert`, `findMin`, `deleteMin`, and `meld` in `O(log n)` worst-case time, with `O(log n)` allocation per update, and supports access to all historical versions.*

---

## 7. Comparison with Skew Heap

A **skew heap** is a leftist heap that drops the NPL field and unconditionally swaps the children of every node on the merge path. The structure is:

```text
function meld_skew(H1, H2):
    if H1 = null: return H2
    if H2 = null: return H1
    if key(H1) > key(H2): swap H1 and H2
    right(H1) <- meld_skew(right(H1), H2)
    swap left(H1) and right(H1)   // always swap
    return H1
```

There is no rank invariant, no NPL field, no conditional. Yet the amortised bound is the same `O(log n)`.

**Theorem 7.1 (Sleator–Tarjan 1986).** *The amortised cost of every skew-heap operation is `O(log n)`.*

The proof uses a potential function counting **heavy right children**: a node `v` is *heavy* with respect to its right child if `|right(v)| > |v| / 2`. The potential is the number of heavy nodes on right spines. Each meld touches at most `O(log n)` light nodes, and each touched heavy node becomes light (because the swap moves it off the right spine), generating enough credit to pay for past heavy work.

|  | Leftist | Skew |
|---|---|---|
| Extra field | NPL (`O(log log n)` bits) | none |
| Bound | worst-case `O(log n)` | amortised `O(log n)` |
| Swap on meld | conditional | unconditional |
| Implementation | more complex | very simple |
| Persistence-friendly | yes | no (amortised bound breaks under multiple uses of same version) |

Skew heaps are the "self-adjusting" cousin of leftist heaps — analogous to how splay trees relate to balanced BSTs.

---

## 8. Comparison Matrix

| Operation       | Binary heap | Binomial heap | Leftist heap | Skew heap | Fibonacci heap | Pairing heap |
|---|---|---|---|---|---|---|
| `insert`        | `O(log n)` worst | `O(1)` amortised | `O(log n)` worst | `O(log n)` amortised | `O(1)` amortised | `O(1)` worst |
| `findMin`       | `O(1)`           | `O(1)`           | `O(1)`           | `O(1)`              | `O(1)`           | `O(1)`        |
| `deleteMin`     | `O(log n)` worst | `O(log n)` worst | `O(log n)` worst | `O(log n)` amortised | `O(log n)` amortised | `O(log n)` amortised |
| `decreaseKey`   | `O(log n)` worst | `O(log n)` worst | `O(log n)` worst | `O(log n)` amortised | `O(1)` amortised | `o(log n)` amortised |
| `meld`          | `O(n)`           | `O(log n)` worst | `O(log n)` worst | `O(log n)` amortised | `O(1)` amortised | `O(1)` worst  |
| Field per node  | none (array)     | parent, sibling, degree | NPL | none | mark, degree, parent, child | child, sibling |
| Persistence-friendly | no          | partial          | yes              | no                   | no               | partial      |
| Cache locality  | excellent        | poor             | poor             | poor                 | poor             | poor          |

The leftist heap occupies a particular niche: **worst-case logarithmic meld with minimal per-node overhead, and a clean persistent version.**

---

## 9. Open Problems

1. **Optimal persistent meldable priority queue.** Brodal and Okasaki (1996) gave an `O(1)` worst-case meld persistent priority queue using bootstrapping over skew binomial heaps. Can the leftist-heap framework match `O(1)` worst-case meld in a persistent setting without bootstrapping?

2. **Parallel meld.** Can `meld` be parallelised to `O(log log n)` depth on a CREW PRAM while preserving the worst-case `O(log n)` work bound?

3. **Cache-oblivious leftist heap.** The pointer structure has poor locality. Is there a cache-oblivious variant matching the worst-case bounds while achieving `O((log n) / B)` cache misses per operation, where `B` is the block size?

4. **Lower bounds for persistent meld.** Pippenger (1996) gave lower bounds for persistent data structures. The exact gap between persistent leftist meld and the lower bound is not fully characterised.

5. **Tight constants.** The leftist heap performs the conditional swap at every node along the meld path. Is there an analysis that bounds the *number* of swaps more tightly than `O(log n)` worst-case for amortised sequences?

---

## 10. Summary

The leftist heap is a textbook example of a data structure whose elegance lies entirely in a single structural invariant — the leftist property on null path lengths. This single invariant yields:

- A clean inductive proof that NPL is `O(log n)`.
- A clean inductive proof that the right spine is `O(log n)`.
- A clean inductive proof that recursive meld preserves the invariant and runs in `O(log n)` *worst-case* time.
- Natural persistence (Okasaki) with the same bounds.
- A variant (weight-biased) that admits top-down implementation.
- A radical simplification (skew heap) that drops the invariant at the cost of moving from worst-case to amortised analysis.

It is one of the earliest examples in the literature where a recursive algorithm's complexity is bounded by an inductively-proved structural property rather than by an amortised potential argument. Crane's 1972 construction predates the formal framework of amortised analysis (Tarjan 1985) by more than a decade, and its proof technique — bounding the cost by the height of the right spine, then bounding the spine by NPL, then bounding NPL by `log n` via the size lemma — remains a model of clean data structure analysis.

### References
- Crane, C. A. (1972). *Linear lists and priority queues as balanced binary trees.* Technical Report STAN-CS-72-259, Computer Science Department, Stanford University.
- Sleator, D. D., and Tarjan, R. E. (1986). Self-adjusting heaps. *SIAM Journal on Computing*, 15(1), 52–69.
- Brodal, G. S., and Okasaki, C. (1996). Optimal purely functional priority queues. *Journal of Functional Programming*, 6(6), 839–857.
- Okasaki, C. (1998). *Purely Functional Data Structures.* Cambridge University Press. Chapter 3.1: Leftist Heaps.
- Tarjan, R. E. (1985). Amortized computational complexity. *SIAM Journal on Algebraic and Discrete Methods*, 6(2), 306–318.
