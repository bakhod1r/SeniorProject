# D-Ary Heap — Mathematical Foundations and Complexity Theory

The d-ary heap generalises the binary heap by allowing each internal node to have
up to `d` children for an integer `d >= 2`. The structure preserves the
implicit-array layout that makes binary heaps cache-friendly, but it changes
the height of the tree from `log_2 n` to `log_d n` and, consequently, the
trade-off between the cost of `push` (sift-up) and `pop` (sift-down). This
document develops the formal definition, derives the index arithmetic, proves
the loop invariant of sift-down, gives a tight `O(n)` bound for build-heap that
exposes the constant `(d - 1)`, derives the workload-optimal `d`, analyses
external-memory and cache behaviour, states the matching comparison-based lower
bound, and surveys variants such as the d-ary soft heap.

## Table of Contents
1. Formal Definition — d-ary heap as a d-ary complete tree with the order invariant
2. Generalised Index Arithmetic
3. Correctness Proof — sift-down loop invariant
4. Tight O(n) Build-Heap Bound for Branching Factor d
5. Workload-Optimal Choice of d — minimising alpha * log_d n + beta * d * log_d n
6. Cache-Aware Analysis — alignment factor
7. Lower Bound — Omega(log n / log d) per push
8. Comparison with Binary Heap (constant factors)
9. d-Ary Soft Heap and Related Variants
10. Open Problems
11. Summary

---

## 1. Formal Definition

A **d-ary heap** of size `n` is a pair `(T, key)` where `T` is a rooted tree
on the vertex set `V = {0, 1, ..., n - 1}` and `key : V -> K` is a labelling
into a totally ordered key universe `(K, <=)` such that:

- (Shape invariant) `T` is a *complete d-ary tree*: every level except
  possibly the last is fully populated with `d` children per internal node, and
  the last level is filled from the left without gaps.
- (Order invariant, min-heap) For every non-root `v` with parent `p(v)`,
  `key(p(v)) <= key(v)`.

Equivalently, the order invariant states that for every internal node `u`,

```text
key(u) <= min { key(c) : c is a child of u }.
```

The completeness condition together with the parent-child arithmetic of
Section 2 makes the tree *implicit*: it is stored as a contiguous array of
length `n`, with no pointers. The labelling `key` is precisely the array
content.

**Height.** A complete d-ary tree on `n` nodes has height

```text
h(n) = floor(log_d ((d - 1) * n + 1)) - 1     for d >= 2
     = Theta(log_d n).
```

For `d = 2` this collapses to the familiar `floor(log_2 n)`.

**Reference.** CLRS (Cormen, Leiserson, Rivest, Stein), *Introduction to
Algorithms*, 3rd ed., Chapter 6, Problem 6-2 introduces d-ary heaps and asks
the reader to derive the height and the cost of `EXTRACT-MIN` and
`DECREASE-KEY`.

---

## 2. Generalised Index Arithmetic

Place the root at index `0` (zero-based). For an internal node `i`, its `d`
children occupy the contiguous slots

```text
child_k(i) = d * i + k + 1,    for k = 0, 1, ..., d - 1.
```

The parent of any non-root node `j >= 1` is

```text
parent(j) = floor((j - 1) / d).
```

**Derivation.** Number the nodes in breadth-first order. Level `L` (root at
level 0) contains the indices `[ (d^L - 1) / (d - 1), (d^(L+1) - 1) / (d - 1) )`.
A node at level-offset `o` on level `L` has index
`i = (d^L - 1) / (d - 1) + o`. Its `k`-th child sits at level-offset
`d * o + k` on level `L + 1`, hence at index

```text
(d^(L+1) - 1) / (d - 1) + d * o + k.
```

Subtracting `1`, dividing by `d`, and using `(d^(L+1) - 1)/(d - 1) = d * (d^L - 1)/(d - 1) + 1`
gives `child_k(i) = d * i + k + 1`. The parent formula is obtained by
inverting: from `j = d * i + k + 1` with `0 <= k <= d - 1`, we have
`i = floor((j - 1) / d)`.

**Sibling range.** The full sibling set of `j` is the contiguous interval

```text
[ d * parent(j) + 1, d * parent(j) + d ] intersect [0, n).
```

This contiguity is critical: a sift-down step scans this range with one tight
loop and one branch predictor hint, accessing at most `d` consecutive array
elements.

**One-based variant.** Some textbooks (and the Boost `d_ary_heap` source)
place the root at index `1`, giving

```text
child_k(i) = d * (i - 1) + k + 1,    parent(j) = floor((j - 2) / d) + 1.
```

The asymptotics are identical; the zero-based form is preferred in modern C++
and Rust implementations.

---

## 3. Correctness Proof — Sift-Down Loop Invariant

The `sift-down` procedure restores the order invariant after the root is
replaced (e.g. by the last element during `EXTRACT-MIN`).

```text
SIFT-DOWN(A, i, n):
    while true:
        m <- i                                     // candidate for minimum
        for k in 1 .. d:
            c <- d * i + k
            if c < n and A[c] < A[m]: m <- c
        if m == i: return
        swap A[i], A[m]
        i <- m
```

**Theorem.** If, before the call, the subtree rooted at every proper
descendant of `i` satisfies the order invariant, then after `SIFT-DOWN(A, i, n)`
the subtree rooted at `i` satisfies it as well.

**Proof (loop invariant).** Define the predicate `P(i)`:

```text
P(i): every child c of i satisfies (a) c is the root of a heap, and
      (b) if A[i] <= A[c] then the subtree rooted at i is a heap.
```

We show `P(i)` holds at the top of every iteration.

*Initialisation.* By hypothesis, every proper descendant of the initial `i`
roots a heap; in particular, each child of `i` does so. Hence (a) holds.
Statement (b) is the standard "root dominates children implies whole tree is a
heap" lemma, proved by induction on subtree size.

*Maintenance.* Suppose `P(i)` holds and the loop body finds an index `m != i`
with `A[m] = min { A[i], A[child_1(i)], ..., A[child_d(i)] }`. After swapping
`A[i]` and `A[m]`, the new value at `i` is the former minimum, which is less
than or equal to the value at every child of `i`. By (b), it remains to show
that the subtree at `m` (now containing the old `A[i]`) still satisfies the
hypothesis of `P(m)`. The children of `m` are unchanged, so (a) for `m` is
inherited from the initial assumption. The new `A[m]` may violate the order
relation with its children, but that is precisely what the next iteration
will repair. Hence `P(m)` holds for the next iteration.

*Termination.* The variable `i` strictly increases at each iteration (children
have larger indices), and is bounded by `n - 1`. The loop must terminate, and
when it does either `m == i` (the order at `i` is already satisfied, so by
(b) the whole subtree is a heap) or `i` has no children (a leaf is
trivially a heap).

This completes the proof. The same scheme proves `SIFT-UP` symmetrically with
the invariant "every ancestor strictly above `i` roots a heap of its own
left-and-right subtrees".

---

## 4. Tight O(n) Build-Heap Bound for Branching Factor d

`BUILD-HEAP` calls `SIFT-DOWN` on every internal node from the last to the
first. The number of internal nodes is at most `ceil(n / d)`.

**Step cost.** A single `SIFT-DOWN` call at a node of subtree-height `h`
performs at most `h` swaps and at most `(d - 1) * h` comparisons (each level
scans `d` children, of which one is the parent in the next iteration, so
`d - 1` strictly new comparisons per level).

**Node count by height.** In a complete d-ary tree on `n` nodes, the number of
nodes whose subtree has height exactly `h` is at most

```text
n_h <= ceil( n / d^(h + 1) ).
```

*Justification.* A node at subtree-height `h` is the root of a complete d-ary
subtree of `>= d^h` nodes (taking the convention that a leaf has height 0).
Distinct such roots have disjoint subtrees, so their count is at most
`n / d^h`. The tighter bound `n / d^(h + 1)` follows from the observation that
together with each height-`h` node we may charge its `d` children of
height `h - 1`, giving `d^(h+1)` "owned" descendants. (See CLRS Lemma 6.3 for
the binary case; the generalisation is verbatim with `2` replaced by `d`.)

**Total comparisons.**

```text
T(n) <= sum_{h = 0}^{h_max}  n_h * (d - 1) * h
      <= sum_{h = 0}^{infty} ceil(n / d^(h+1)) * (d - 1) * h
      <= n * (d - 1) / d  *  sum_{h = 0}^{infty}  h / d^h.
```

The series `S(d) = sum_{h >= 0} h / d^h = d / (d - 1)^2` for `d > 1` (standard
derivative-of-geometric-series identity). Substituting,

```text
T(n) <= n * (d - 1) / d  *  d / (d - 1)^2  =  n / (d - 1).
```

**Conclusion.** `BUILD-HEAP` runs in

```text
T(n) <= n / (d - 1)   comparisons     =   O(n)   for any fixed d >= 2.
```

For `d = 2` we recover the classical bound `T(n) <= n`. For larger `d` the
constant shrinks: `d = 4` gives `n / 3`, and `d = 16` gives `n / 15`. This is
one of the strongest reasons to prefer a d-ary heap for one-shot heapification
of a large array.

---

## 5. Workload-Optimal Choice of d

Consider a sequence of operations with `alpha * N` pushes and `beta * N` pops
(`alpha + beta = 1`). The amortised cost per operation is

```text
C(d) = alpha * c_push(d) + beta * c_pop(d)
     = alpha * log_d n             // sift-up: one comparison per level
       + beta * (d - 1) * log_d n  // sift-down: d - 1 comparisons per level
     = (alpha + beta * (d - 1)) * log n / log d.
```

We minimise `C(d)` over real `d > 1`. Let `f(d) = (alpha + beta * (d - 1)) / log d`.
Taking the derivative and setting it to zero:

```text
f'(d) = [ beta * log d  -  (alpha + beta * (d - 1)) / d ] / (log d)^2 = 0
   <=> beta * d * log d  =  alpha + beta * (d - 1)
   <=> beta * d * (log d - 1)  =  alpha - beta.
```

**Balanced workload (`alpha = beta = 1/2`).** The right side is `0`, so
`log d = 1`, giving

```text
d* = e ~ 2.718.
```

Since `d` must be an integer, the practical optimum is `d = 2` or `d = 3`. The
binary heap is within a constant factor of optimal for balanced workloads,
which is why it remains the textbook default.

**Push-heavy workload — Dijkstra and Prim.** Dijkstra's algorithm on a graph
with `V` vertices and `E` edges performs `V` pops (one per settled vertex)
and up to `E` decrease-key calls (each implemented as a push in lazy-deletion
variants). Setting `alpha = E / (E + V)` and `beta = V / (E + V)`, the
analysis of CLRS Chapter 24 yields total cost

```text
O( (V + E) * log_d V  +  V * (d - 1) * log_d V ).
```

Differentiating with respect to `d` gives the famous choice

```text
d* = max(2, ceil(E / V)).
```

For a graph with average degree `k`, picking `d = k` makes both terms balanced
and gives total cost `O((E + V) * log_{E/V} V)`, asymptotically faster than
the binary-heap `O((E + V) * log V)` whenever `E = omega(V)`.

Tarjan attributes this observation to Johnson (1977) and discusses it in
*Data Structures and Network Algorithms* (CBMS-NSF Regional Conference Series
in Applied Mathematics, 1983).

**Boost reference.** The Boost C++ Libraries `boost::heap::d_ary_heap`
documentation explicitly exposes `boost::heap::arity<N>` as a configurable
template parameter and notes that "for cache-friendly operation, `arity` in
the range 4 to 8 is usually optimal on modern hardware".

---

## 6. Cache-Aware Analysis — Alignment Factor

In the external-memory model of Aggarwal and Vitter (1988), the machine has
internal memory of `M` words and transfers blocks of `B` consecutive words at
a time. The cost metric is the number of block transfers (I/Os).

**Sift path length in blocks.** A d-ary heap of `n` elements has height
`log_d n`. If each level fits within a single block, the entire sift path is
`log_d n` distinct nodes, but consecutive nodes on the path may share blocks.
A more precise count is

```text
I/Os per pop = O( log_d n / log_d(M / B) )      when d is small enough that
                                                a parent and all its d children
                                                fit in O(d / B) blocks.
```

**Alignment factor.** If `d * sizeof(key) <= B`, every sift-down step reads
exactly one cache line for the d children: a perfectly aligned, sequential
access pattern that the hardware prefetcher serves at maximum bandwidth. The
constant in the I/O bound improves by a factor of `d` compared to a binary
heap.

**Implication.** Pick `d` so that `d * sizeof(key)` matches the cache-line
size `B`. On x86-64 with `B = 64` bytes and 8-byte keys, this gives
`d = 8`; on Apple Silicon (`B = 128`) it gives `d = 16`. Both values agree
with empirical benchmarks of `d_ary_heap` implementations.

**Caveat — root pollution.** The root is accessed on every operation and is
therefore always cached. Asymptotically, the I/O complexity is dominated by
the leaf-side of the path, which is amortised across many operations and
benefits the most from large `d`.

For an explicit cache-oblivious construction, see Frigo, Leiserson, Prokop,
and Ramachandran, "Cache-Oblivious Algorithms", FOCS 1999. They show that the
funnel-heap matches the lower bound `Theta((1/B) * log_{M/B}(N/B))` per
amortised op, which a fixed-d d-ary heap cannot match for all `M/B`.

---

## 7. Lower Bound — Omega(log n / log d) per Push

Any comparison-based priority queue must spend `Omega(log n)` comparisons per
ordered output (otherwise sorting `n` elements via `n` `push` + `n` `pop`
would beat the `Omega(n log n)` decision-tree bound).

**Branching factor and depth.** A d-ary heap of `n` elements has depth
`log_d n`. A `push` performs at most one comparison per level, hence at most
`log_d n` comparisons. So pushes are *cheaper* than pops, but only because the
work is shifted: each pop performs `(d - 1) * log_d n` comparisons.

**Tightness.** Summing across `n` pushes and `n` pops,

```text
total comparisons >= n * log_2 n      (sorting lower bound)
total work in d-ary heap = n * log_d n + n * (d - 1) * log_d n
                        = n * d * log_d n
                        = n * d * log n / log d.
```

For `d = 2` this is `2 n log_2 n`, twice the lower bound; for `d = e` it is
`e * n * log n / 1 = e n log n / log 2 = e n log_2 n ~ 2.71 n log_2 n`. The
*per-pop* lower bound is `Omega(log n)` independent of `d`, and the
*per-push* lower bound is `Omega(log n / log d)`, achieved by the d-ary heap.

Thus, the d-ary heap is *not* asymptotically faster than the binary heap when
both push and pop work is counted; it merely **redistributes** that work
between the two operations and **reduces constants** by exploiting cache
alignment.

---

## 8. Comparison with Binary Heap (Constant Factors)

| Operation | Binary heap (`d = 2`) | d-ary heap (general `d`) |
| --- | --- | --- |
| `push` (sift-up) | `log_2 n` comparisons | `log_d n` comparisons |
| `pop` (sift-down) | `2 * log_2 n` comparisons | `(d - 1) * log_d n` comparisons |
| `build-heap` | `<= n` comparisons | `<= n / (d - 1)` comparisons |
| Height | `log_2 n` | `log_d n` |
| Cache lines per sift step | `1` (two children fit) | `ceil(d * sizeof(key) / B)` |
| Suitable `d` for x86-64 (64-byte line, 8-byte key) | `2` | `4` or `8` |

**Pop cost ratio.** For fixed `n`, the ratio of comparisons per pop is

```text
((d - 1) * log_d n) / (2 * log_2 n)  =  (d - 1) * log 2 / (2 * log d).
```

For `d = 4`: ratio is `3 * 0.693 / (2 * 1.386) = 0.75`, a 25 percent saving in
comparisons. For `d = 8`: ratio is `7 * 0.693 / (2 * 2.079) = 1.17`, a 17
percent *penalty* in comparisons — but offset by the cache effect.

**Push cost ratio.** `log_d n / log_2 n = log 2 / log d = 1 / log_2 d`. For
`d = 4` this is `0.5`; for `d = 8`, `0.33`. Pushes become dramatically
cheaper.

---

## 9. d-Ary Soft Heap and Related Variants

The **soft heap** of Chazelle (J. ACM 47(6), 2000) is a comparison-based
priority queue that supports `insert`, `meld`, and `extract-min` in
amortised `O(1)` time **at the cost of introducing controlled errors**:
at any point a parameter `epsilon in (0, 1/2]` allows up to `epsilon * n`
keys to be reported with a *corrupted* value greater than their true value.

**d-ary variant.** Chazelle's original construction uses binomial-style
trees, but a d-ary analogue exists (Kaplan and Zwick, "A simpler
implementation and analysis of Chazelle's soft heaps", SODA 2009). The d-ary
soft heap admits a tunable trade-off:

```text
insert: O(log(1/epsilon))         amortised
delete-min: O(log(1/epsilon))     amortised
total corrupted keys: <= epsilon * I, where I is the total number of inserts.
```

**Applications.**

- Chazelle's `O(m * alpha(m, n))` minimum spanning tree algorithm uses a soft
  heap to find approximately-minimum edges and then "cleans up" the
  corruption.
- Pettie and Ramachandran's optimal deterministic MST algorithm (2002) builds
  on the same primitive.
- Selection in linear time without partitioning (Chazelle's lecture notes,
  Princeton, 2003).

A d-ary soft heap variant has been explored for parallel and cache-oblivious
settings, but it is not, to date, asymptotically better than the binary
construction.

---

## 10. Open Problems

1. **Cache-oblivious d-ary heap.** A funnel heap matches the optimal I/O
   complexity `Theta((1/B) * log_{M/B}(N/B))` per amortised op, but its
   implementation is complex. Is there a d-ary heap with a fixed structural
   parameter that matches this I/O bound on every machine without knowing
   `B`?

2. **Deterministic O(1) decrease-key for d > 2.** Fibonacci heaps achieve
   `O(1)` amortised decrease-key, but only for the binary-tree-list structure.
   Whether a d-ary structure with constant-amortised decrease-key exists and
   matches the cache properties of the standard d-ary heap is open. The
   strict Fibonacci heap of Brodal, Lagogiannis, and Tarjan (ICALP 2012) is
   a partial answer in the worst-case setting but is not array-implicit.

3. **Tight lower bound including I/Os.** The Aggarwal-Vitter sort bound gives
   a per-op I/O lower bound of `Omega((1/B) * log_{M/B}(N/B))`. The d-ary
   heap I/O cost includes a multiplicative `log_d n / log_d(M/B)` factor.
   Closing the gap for *every* `(M, B, n, d)` configuration remains open.

4. **Optimal `d` under random workloads.** If the push/pop mix is drawn
   from a distribution rather than fixed, the expected-optimal `d` may
   differ from the worst-case `d* = e`. A precise characterisation is not
   in the literature.

5. **d-ary monotone priority queues.** Thorup's `O(m + n * log log n)` SSSP
   bound (J. ACM 1999) uses a custom integer priority queue. Whether a d-ary
   analogue matches both the cache and the integer-key bound is unknown.

---

## 11. Summary

The d-ary heap is a parameterised generalisation of the binary heap. Setting
`d` larger than 2 trades a slightly more expensive sift-down (`(d - 1) * log_d n`
comparisons instead of `2 * log_2 n`) for a strictly cheaper sift-up
(`log_d n` instead of `log_2 n`) and a strictly cheaper build-heap
(`n / (d - 1)` instead of `n`). The shallower tree (height `log_d n`) and the
contiguity of sibling slots make the structure markedly cache-friendly:
choosing `d` so that `d * sizeof(key)` matches the cache-line size produces
the largest measurable speed-up over the binary heap on modern hardware.

The workload-optimal `d` minimises `(alpha + beta * (d - 1)) * log n / log d`;
for balanced workloads the real-valued optimum is `e`, so `d in {2, 3}` is
practically optimal. For Dijkstra's algorithm and other push-heavy graph
algorithms, the optimum is `d ~ E / V`, and the resulting cost
`O((E + V) * log_{E/V} V)` is asymptotically faster than the binary-heap
bound whenever the graph is dense.

The comparison-based lower bound `Omega(log n)` per ordered output still
applies; the d-ary heap merely redistributes that work between push and pop.
For asymptotically faster amortised behaviour one must move to Fibonacci-style
or soft-heap structures, at the cost of giving up the implicit array
representation that makes the d-ary heap so attractive in cache-bound
contexts.

**Key references.**

- Cormen, Leiserson, Rivest, Stein. *Introduction to Algorithms*, 3rd ed.,
  MIT Press, 2009. Chapter 6, Problem 6-2 ("Analysis of d-ary heaps").
- Boost C++ Libraries, `boost::heap::d_ary_heap` documentation,
  https://www.boost.org/doc/libs/release/doc/html/boost/heap/d_ary_heap.html
- Chazelle, B. "The soft heap: an approximate priority queue with optimal
  error rate." *Journal of the ACM* 47(6):1012-1027, 2000.
- Johnson, D. B. "Efficient algorithms for shortest paths in sparse
  networks." *Journal of the ACM* 24(1):1-13, 1977.
- Tarjan, R. E. *Data Structures and Network Algorithms.* SIAM, 1983.
- Aggarwal, A.; Vitter, J. S. "The input/output complexity of sorting and
  related problems." *Communications of the ACM* 31(9):1116-1127, 1988.
- Frigo, M.; Leiserson, C. E.; Prokop, H.; Ramachandran, S. "Cache-oblivious
  algorithms." *FOCS* 1999.
- Kaplan, H.; Zwick, U. "A simpler implementation and analysis of Chazelle's
  soft heaps." *SODA* 2009.
