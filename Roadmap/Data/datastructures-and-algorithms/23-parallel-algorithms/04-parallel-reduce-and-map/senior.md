# Parallel Reduce and Map — Senior Level

## Prerequisites

- [Middle Level](./middle.md) — map as the embarrassingly-parallel `O(1)`-span / `O(n)`-work primitive, reduce as the balanced-tree `O(log n)`-span / `O(n)`-work primitive, **monoids** (associative `⊕` with identity `e`) as the contract for parallel reduce, and the two-level (block-then-combine) decomposition
- [Parallel Prefix Sum (Scan) — Senior](../02-parallel-prefix-sum-scan/senior.md) — scan is reduce's "keep every prefix" sibling; the carry-monoid, segmented-scan, and blocked-multi-level machinery transfer wholesale to reduce
- [Models of Parallel Computation: PRAM and Work–Span — Senior](../01-models-pram-work-span/senior.md) — `T₁`/`T∞`, Brent's theorem, the class `NC¹` (reduce lives here), and the Cook–Dwork–Reischuk `Ω(log n)` EREW lower bound that reduce's single output saturates

## Table of Contents

1. [What Senior-Level Reduce/Map Theory Is About](#what-senior-level-reducemap-theory-is-about)
2. [The Algebra of Reduction: Monoids Are the Exact Requirement](#the-algebra-of-reduction-monoids-are-the-exact-requirement)
3. [Semirings: Map-Reduce as a Generalized Matrix Product](#semirings-map-reduce-as-a-generalized-matrix-product)
4. [The Homomorphism View: Reduce Is a Catamorphism, and the Third Homomorphism Theorem](#the-homomorphism-view-reduce-is-a-catamorphism-and-the-third-homomorphism-theorem)
5. [Reduce Is in NC¹ and the Reduction Tree Is Span-Optimal](#reduce-is-in-nc-and-the-reduction-tree-is-span-optimal)
6. [Segmented and Multi-Reduce: Per-Key Aggregation](#segmented-and-multi-reduce-per-key-aggregation)
7. [All-Reduce: Ring vs Recursive-Halving-Doubling](#all-reduce-ring-vs-recursive-halving-doubling)
8. [GPU and Hardware Reductions: The Bandwidth Roofline](#gpu-and-hardware-reductions-the-bandwidth-roofline)
9. [Numerics: Associativity vs Floating Point in Depth](#numerics-associativity-vs-floating-point-in-depth)
10. [Worked Piece: The (min,+) Semiring Map-Reduce and the Ring All-Reduce Bandwidth Bound](#worked-piece-the-min-semiring-map-reduce-and-the-ring-all-reduce-bandwidth-bound)
11. [Decision Framework](#decision-framework)
12. [Research Pointers](#research-pointers)
13. [Key Takeaways](#key-takeaways)

---

## What Senior-Level Reduce/Map Theory Is About

The middle level establishes reduce and map as *algorithms*: `map(f, x)` applies `f` to every element with span `O(1)` and work `O(n)`; `reduce(⊕, x)` folds an associative `⊕` over a balanced binary tree with span `O(log n)` and work `O(n)`. It establishes the contract — `⊕` must be associative (so the tree may re-parenthesize freely) and ideally have an identity (so empty/ragged subtrees have a value) — i.e., `(S, ⊕, e)` must be a **monoid**. And it gives the production recipe: split into `p` blocks, reduce each block sequentially, then reduce the `p` partials. That is the "here are the two primitives and how to compute them" level.

Senior-level theory makes a stronger claim: **reduce is not one algorithm; it is the image of an algebraic structure, and the structure you pick *is* the algorithm.** Map and reduce together are a single object — a *map-reduce* (a homomorphism from lists to a monoid) — and choosing the monoid, or generalizing it to a *semiring*, instantiates an entire family of algorithms (sum, max, histogram, matrix multiply, shortest paths, reachability, parsing) from one piece of parallel machinery. Six threads run through this view:

1. **Monoids are exactly the requirement, no more and no less.** Associativity is what licenses the tree; identity is what makes the fold total (and lets you pad ragged blocks). A binary operation is parallel-reducible *iff* it is associative — commutativity is a bonus that buys reordering, not a requirement.
2. **Semirings unify map and reduce into one combined operation, and generalize matrix products.** The pair `(⊕, ⊗)` — a reduce-operator and a map-combine-operator obeying the distributive law — turns "multiply then add" into "combine-then-reduce" over *any* semiring: `(min, +)` gives shortest paths, `(∨, ∧)` gives reachability, `(+, ×)` gives ordinary linear algebra. Generalized matrix multiply over a semiring is the master map-reduce.
3. **Reduce is a catamorphism — the unique monoid homomorphism out of a list.** This is the Bird–Meertens (squiggol) view: `reduce` is `fold`, and a fold into a monoid is forced by associativity to be parallelizable. The **third homomorphism theorem** (Gibbons) makes the converse precise: a function expressible as *both* a left fold and a right fold is necessarily a list homomorphism — hence a map-reduce, hence parallelizable.
4. **Reduce sits in `NC¹` and its tree is span-optimal.** The single output depends on all `n` inputs, so the Cook–Dwork–Reischuk `Ω(log n)` fan-in floor applies; the balanced tree matches it. There is no cleverer reduce.
5. **Distributed reduce splits into two primitives with opposite cost profiles.** `all-reduce` (every processor ends with the global result) decomposes into a *reduce-scatter* plus an *all-gather*; the **ring** schedule is *bandwidth*-optimal, while *recursive halving-doubling* (and trees) are *latency*-optimal. The bandwidth-vs-latency tradeoff is the entire design space, and ring all-reduce is the load-bearing primitive of distributed deep-learning gradient averaging.
6. **On real hardware reduce is memory-bound, and floating point is not associative.** The arithmetic is trivial (`n−1` ops); the data movement (`n` reads) dominates, pinning reduce to the memory roofline. And re-associating a float sum changes the answer — pairwise summation has error `O(ε log n)` vs naive `O(ε n)`, and reproducibility requires a *fixed* reduction tree.

The unifying senior stance: **map and reduce are the same homomorphism viewed at two granularities, parameterized by an algebraic structure; pick the monoid/semiring and you have picked the algorithm, its span (`O(log n)`), and — once you account for floating point and bandwidth — its accuracy and its speed.** The work below develops each thread and ties it back to the `NC¹`/work–span theory of [`../01-models-pram-work-span/senior.md`](../01-models-pram-work-span/senior.md) and the scan machinery of [`../02-parallel-prefix-sum-scan/senior.md`](../02-parallel-prefix-sum-scan/senior.md).

---

## The Algebra of Reduction: Monoids Are the Exact Requirement

The middle level *asserted* that `⊕` must be associative. The senior obligation is to see precisely *why* a monoid is the exact contract — neither weaker nor stronger structure will do.

> **Definition (monoid).** A set `S` with a binary operation `⊕ : S × S → S` is a **monoid** `(S, ⊕, e)` when (i) `⊕` is **associative**: `(a ⊕ b) ⊕ c = a ⊕ (b ⊕ c)` for all `a, b, c`, and (ii) there is an **identity** `e`: `e ⊕ a = a ⊕ e = a`. No inverses are required (that would be a *group*); no commutativity is required (that would be a *commutative monoid*).

The two laws map one-to-one onto the two freedoms a parallel reduce needs:

- **Associativity ⟺ re-parenthesization.** A sequential fold computes `((…((x₀ ⊕ x₁) ⊕ x₂) … ) ⊕ x_{n−1})` — a strictly left-leaning tree of depth `n`. A parallel reduce computes a *balanced* tree of depth `log n`. These two expressions are *equal* only because `⊕` is associative; associativity is precisely the law that "any binary tree over the same left-to-right sequence yields the same result." Without it the balanced tree computes a *different* value, and parallel reduce is simply wrong. Associativity is therefore not a convenience — it is the *correctness precondition* of the entire primitive.
- **Identity ⟺ totality on ragged / empty input.** The identity `e` is the value of the *empty* reduction. It lets the blocked recipe pad a short final block, lets a segmented reduce emit a value for an empty segment, lets a tree with a missing leaf substitute `e`, and gives `reduce` a sensible result on an empty array. A *semigroup* (associative but no identity) still parallelizes, but you must special-case emptiness everywhere; the identity buys you a clean, total, branch-free implementation.

> **Commutativity is a *bonus*, not a requirement.** A common misconception is that parallel reduce needs commutativity. It does not. String concatenation is associative but *not* commutative, yet `reduce(++, lines)` parallelizes perfectly — the tree must merely preserve left-to-right *order* of the leaves, which a balanced tree does. What commutativity *additionally* buys is **reordering freedom**: if `⊕` commutes, the reduce may combine partial results *in whatever order they finish*, which is exactly what lets a work-stealing scheduler, an atomic `fetchAdd`, or an out-of-order network all-reduce accumulate results as they arrive rather than in a fixed positional order. So: associativity is mandatory (it licenses the tree); commutativity is optional (it licenses *order-independent accumulation*). Floating-point `+` is commutative but **not** associative — the reverse of what you'd guess — which is the source of every numerical surprise in §9.

The senior reflex this trains is **monoid-spotting**: when you meet a "combine all these into one" loop, ask *what monoid is hiding here?* Sum/product (`(ℝ, +, 0)`, `(ℝ, ×, 1)`), min/max (`(ℝ ∪ {±∞}, min, +∞)`), boolean any/all (`({0,1}, ∨, 0)`, `({0,1}, ∧, 1)`), set union (`(2^U, ∪, ∅)`), the count/min/max/sum/sum-of-squares *tuple* (a product of monoids — how you compute mean and variance in one pass), the **histogram** monoid (pointwise-add count vectors), the **top-k** monoid (merge-and-truncate sorted lists), the **HyperLogLog sketch** (merge registers by max), the **min-by/argmax** monoid (carry the witnessing index). Each is a monoid, so each is a one-pass `O(log n)`-span reduce by *the same machinery* — only the `⊕` changes. This is the reduce analogue of the scan-vector "decompose into scans" skill of [`../02-parallel-prefix-sum-scan/senior.md`](../02-parallel-prefix-sum-scan/senior.md): the structure is fixed, the algebra is the parameter.

---

## Semirings: Map-Reduce as a Generalized Matrix Product

A monoid drives *reduce*. Combining a *map* with a *reduce* — the canonical "transform each element, then fold the results" — is best understood over a richer structure: the **semiring**.

> **Definition (semiring).** A set `S` with two operations and two constants `(S, ⊕, ⊗, 0̄, 1̄)` is a **semiring** when (i) `(S, ⊕, 0̄)` is a *commutative* monoid (the "addition"), (ii) `(S, ⊗, 1̄)` is a monoid (the "multiplication"), (iii) `⊗` **distributes** over `⊕`: `a ⊗ (b ⊕ c) = (a⊗b) ⊕ (a⊗c)`, and (iv) `0̄` annihilates: `a ⊗ 0̄ = 0̄`. (No subtraction — that is the "semi.")

The point is that the *generalized matrix product* is defined over *any* semiring:

```text
   (A ⊗ B)[i][j]  =  ⊕_k  ( A[i][k] ⊗ B[k][j] ).
```

Read this as a map-reduce: for fixed `i, j`, **map** the pairwise products `A[i][k] ⊗ B[k][j]` over all `k` (the "multiply" / map step), then **reduce** them under `⊕` (the "add" / fold step). Distributivity is exactly the law that makes this well-defined and lets the two phases interleave and parallelize. Swapping which semiring you plug in re-purposes one piece of parallel machinery into wildly different algorithms:

| Semiring `(⊕, ⊗, 0̄, 1̄)` | Generalized matrix product computes | The map-reduce reads as |
|---|---|---|
| `(+, ×, 0, 1)` — the reals | ordinary matrix multiply, linear algebra | sum of products |
| `(min, +, +∞, 0)` — the **tropical** semiring | all-pairs shortest paths (one relaxation round) | "min over paths of path-length" |
| `(max, +, −∞, 0)` | longest/critical paths, Viterbi (in log space) | "max over paths of path-score" |
| `(∨, ∧, 0, 1)` — the Boolean semiring | transitive closure / reachability | "is there *any* path" |
| `(max, min, −∞, +∞)` | bottleneck / widest-path | "best worst-edge over paths" |
| `(+, ×) over GF(2)` | parity / linear codes over `F₂` | XOR of ANDs |

The headline: **a single parallel map-reduce-over-a-semiring kernel is shortest paths, reachability, matrix multiply, and Viterbi all at once.** This is why graph algorithms have a *linear-algebraic* formulation — the GraphBLAS standard is built on exactly this idea: express BFS as repeated `(∨, ∧)` matrix–vector products, single-source shortest paths as repeated `(min, +)` products, and inherit the parallel reduce machinery for free. The `(min, +)` (tropical) case is worked end to end in §10.

Two structural notes for the senior reader:

- **The map step is the `⊗`; the reduce step is the `⊕`.** The middle-level slogan "map then reduce" is exactly "apply `⊗` pairwise, then fold under `⊕`." The semiring is the precise algebra of *combined* map-reduce, where the monoid of §2 was the algebra of reduce *alone*.
- **Distributivity is what lets you fuse and reassociate the combined operation.** Just as associativity licensed the reduce tree, distributivity licenses interleaving the map and the reduce (e.g., computing partial inner products on each node and reducing them across nodes — exactly what a distributed semiring matmul does). It is the two-operator generalization of "the tree is free to re-parenthesize."

---

## The Homomorphism View: Reduce Is a Catamorphism, and the Third Homomorphism Theorem

The deepest reframing of map-reduce comes from the **Bird–Meertens formalism** (BMF, "squiggol") — the algebra of programs over lists developed by Richard Bird and Lambert Meertens. It says map and reduce are not ad-hoc loops but the *canonical morphisms* of the list datatype, and it gives a precise theorem for *when* a function is parallelizable.

### Reduce is a fold; map-reduce is a list homomorphism

A **list homomorphism** is a function `h` on lists such that there is an associative `⊕` with
```text
   h(xs ++ ys)  =  h(xs) ⊕ h(ys),        and        h([]) = e  (the identity of ⊕).
```
That is: `h` of a concatenation is the `⊕`-combine of `h` of the parts. This single equation *is* the divide-and-conquer / parallel decomposition: split the list anywhere, recurse on each half, combine with `⊕`. Every list homomorphism factors uniquely as
```text
   h  =  reduce(⊕) ∘ map(f),        where  f(x) = h([x]).
```
This is the **first homomorphism theorem** (the "homomorphism lemma"): *every list homomorphism is a map followed by a reduce.* So "is my function a map-reduce?" is *exactly* "is my function a list homomorphism?" — and being a list homomorphism is *exactly* the property that makes it parallelizable, because the defining equation is the parallel split.

In the language of recursion schemes, `reduce(⊕)` is the **catamorphism** (fold) determined by the monoid `(S, ⊕, e)` — the *unique* structure-preserving map from the free monoid of lists (with `++`) into the target monoid `S`. "Unique" is the operative word: associativity forces the fold to be well-defined regardless of how the list is split, which is precisely why a parallel reduce and a sequential fold must agree.

### The third homomorphism theorem: the parallelizability test

The practical gem is **Gibbons's third homomorphism theorem** (Jeremy Gibbons, 1996): it gives an *operational* test for parallelizability that you can apply without inventing the monoid by hand.

> **Third Homomorphism Theorem (Gibbons, 1996).** A function `h` on lists is a **list homomorphism** (hence a map-reduce, hence parallelizable in `O(log n)` span) **if and only if** it can be computed *both* as a *left* fold (a `foldl`, scanning left-to-right) *and* as a *right* fold (a `foldr`, scanning right-to-left).

The intuition is striking. If you can compute `h` going left-to-right *and* you can compute it going right-to-left, those two sequential phrasings constrain `h` so tightly that an *associative* combine `⊕` is forced to exist — and from it the divide-and-conquer parallel algorithm follows. The theorem converts a *search for a clever monoid* into a *check of two sequential definitions you may already have*:

- If a function has *only* a natural left-fold (it inherently consumes left-to-right and the right-to-left version is impossible), it is a *plausibly sequential* computation — exactly the recurrence-as-scan situation, and you fall back to the affine/matrix monoid trick of [`../02-parallel-prefix-sum-scan/senior.md`](../02-parallel-prefix-sum-scan/senior.md).
- If it admits both directions, you are *guaranteed* a parallel map-reduce exists; the constructive proofs of the theorem even *synthesize* the `⊕` for you from the two folds (e.g., by the "function-level" or "abide"-law constructions).

A canonical example: `maximum-segment-sum` (the maximum sum of a contiguous sub-list) is computable both left-to-right and right-to-left, so by the third homomorphism theorem it is a list homomorphism — and indeed it parallelizes as a reduce over a 4-tuple monoid `(total, best-prefix, best-suffix, best-overall)`, whose combine the theorem essentially dictates. This is the algebraic engine behind "this loop *looks* sequential but is secretly a reduce": the two-folds test certifies parallelizability, and the homomorphism factorization hands you the monoid.

> **The senior reflex.** Confronted with a fold-shaped loop, do not ask "can I parallelize this?" — ask the *two precise questions* the BMF gives you: (1) *Is there an associative `⊕` with `h(xs ++ ys) = h(xs) ⊕ h(ys)`?* (the homomorphism equation), or equivalently (2) *Can I compute `h` both left-to-right and right-to-left?* (the third homomorphism theorem). A "yes" is a constructive `O(log n)`-span map-reduce; a "no — only one direction works" is a sequential recurrence to be attacked with the scan-monoid trick instead. This is the same `NC`-placement skill as the scan file, expressed as an algebraic, checkable criterion rather than a flash of insight.

---

## Reduce Is in NC¹ and the Reduction Tree Is Span-Optimal

The complexity placement of reduce is clean and tight, and it is the reduce-specific instance of the general `NC¹` story from [`../01-models-pram-work-span/senior.md`](../01-models-pram-work-span/senior.md).

**Membership in `NC¹`.** A reduce over an associative `⊕` is a balanced binary tree of fan-in-2 `⊕`-gates: depth `⌈log₂ n⌉`, exactly `n − 1` gates, fan-out 1 (each partial result feeds one parent). Depth `O(log n)`, size `O(n)`, bounded fan-in — so reduce sits squarely in `NC¹`, the same class as prefix sum and integer addition. In work–span terms `T₁ = O(n)`, `T∞ = O(log n)`, parallelism `T₁/T∞ = O(n / log n)`.

**The `Ω(log n)` lower bound is matched.** A reduce produces *one* output that depends on *all* `n` inputs — flipping any single `xᵢ` can change the result (it is maximally sensitive). That is precisely the hypothesis of the **Cook–Dwork–Reischuk** theorem: on an EREW/CREW PRAM, any function depending on all `n` inputs needs `Ω(log n)` steps regardless of processor count, because the "knowledge set" of any memory cell at most doubles per step and must reach size `n`. So the `O(log n)`-depth tree is **span-optimal**, not merely good — there is no cleverer EREW reduce, and throwing more processors at it cannot beat `log n`.

```text
   reduce:   T₁ = O(n)   T∞ = O(log n)   ∈ NC¹   and Ω(log n) span is FORCED on EREW/CREW.
```

> **The fan-in floor in one line.** Each `⊕` combines 2 inputs, so after `t` levels a value can summarize at most `2^t` leaves; to summarize all `n` you need `t ≥ log₂ n`. This is the *fan-in* statement of the same `Ω(log n)` bound — the binary-tree depth is information-theoretically forced by bounded arity. (On a CRCW PRAM the picture shifts exactly as in the models file: *idempotent* reductions like OR/AND collapse to `O(1)` via concurrent writes, but a faithful sum still needs `Ω(log n / log log n)` — the Beame–Håstad shadow of `PARITY ∉ AC⁰`.)

The senior consequence mirrors the scan file's: **do not chase `O(1)`-span reduce on a faithful operator.** The `O(log n)` tree is optimal; spend your effort on *work-efficiency* (keep `T₁ = O(n)`, never the `O(n log n)` of a Hillis–Steele-style step-doubling that is pointless when you only want the final value), on *constants* (block-then-combine to amortize tree overhead), and — on real machines — on *bandwidth* and *numerics*, which are where the actual wins and losses live.

---

## Segmented and Multi-Reduce: Per-Key Aggregation

The single most useful generalization of reduce in data-processing practice is **multi-reduce** (a.k.a. *reduce-by-key*, *segmented reduce*): instead of folding the whole array to one value, fold *each group* to its own value. This is exactly the reduce counterpart of the segmented *scan* of [`../02-parallel-prefix-sum-scan/senior.md`](../02-parallel-prefix-sum-scan/senior.md), and it inherits all of that machinery.

There are two shapes, depending on how groups are laid out:

- **Segmented reduce (contiguous segments).** The array is partitioned into contiguous runs, marked by a per-element **head flag** (the first element of each segment is flagged). You want one `⊕`-reduction per segment. This is a *segmented scan* whose per-segment *total* you keep (the value at each segment's last element), built on the **segmented monoid** `(v_L, f_L) ⊕_seg (v_H, f_H) = (f_H ? v_H : v_L ⊕ v_H, f_L ∨ f_H)` from the scan file. One flat, branch-free, perfectly load-balanced pass reduces *all* segments at once — immune to segment-length skew (one giant group never starves the others). This is the per-row reduce inside CSR sparse-matrix–vector multiply and the per-list reduce in list ranking.
- **Reduce-by-key (arbitrary keys).** Each element carries a key; you want, for each distinct key, the `⊕`-reduction of its values — a parallel `GROUP BY ... aggregate`. When the array is *sorted by key*, equal keys are contiguous and this is exactly segmented reduce (segment boundaries = key changes). When it is *not* sorted, you either sort first (radix/merge sort by key, then segmented reduce) or scatter into per-key accumulators with atomics (good when keys are few and dense — e.g. a histogram). The histogram is the degenerate case: key = bucket index, `⊕ = +`, value = 1.

The crucial senior point is that **multi-reduce is *one* reduce over a *richer monoid*, not a loop of independent reduces.** Wrapping the base monoid in the flag-guarded segmented shell (or in a "tagged-by-key, merge-equal-keys" monoid) keeps the operation associative, so it stays a single `NC¹`, `O(log n)`-span, perfectly load-balanced pass. You never launch one task per group — the irregularity is absorbed into the algebra, and a flat scan/reduce network balances the work regardless of the group-size distribution. This is the engine of the entire **MapReduce / dataflow** family: the `reduce` phase of MapReduce *is* a distributed reduce-by-key, and the shuffle-then-reduce pattern is "sort/partition by key, then segmented reduce per partition." The full pattern catalogue — combiners as local pre-reductions, the shuffle, partitioner design, and the distributed-systems framing — is [`../06-map-reduce-patterns/senior.md`](../06-map-reduce-patterns/senior.md).

> **Combiners are pre-reductions, and they need a *commutative* monoid.** A MapReduce *combiner* is a local reduce on each mapper's output before the shuffle, to shrink network traffic. It is correct *only* because `⊕` is an associative-and-commutative monoid: the framework reduces partial groups in arbitrary order across mappers and reducers, so combining `a ⊕ b` here and `c ⊕ d` there and merging later must equal the global fold. This is the one place reduce genuinely *needs* commutativity (not just associativity) — because the *order in which partial groups arrive across the network is nondeterministic*. (Average is the classic combiner bug: `avg` is not a monoid, so you must carry the `(sum, count)` monoid and divide at the end. See [`../06-map-reduce-patterns/senior.md`](../06-map-reduce-patterns/senior.md).)

---

## All-Reduce: Ring vs Recursive-Halving-Doubling

In *distributed-memory* settings (`p` machines, each holding a slice of the data, no shared memory) the relevant primitive is usually not "reduce to one machine" but **all-reduce**: every one of the `p` processors must end up holding the *same* global `⊕`-reduction of all the data. This is the single most important collective in distributed deep learning — averaging gradient vectors across `p` workers every minibatch is an all-reduce of a vector of `n` floats (often hundreds of millions). The cost model here is BSP/LogP-flavored (see [`../01-models-pram-work-span/senior.md`](../01-models-pram-work-span/senior.md)): each message costs a **latency** `α` (startup) plus a **bandwidth** term `β` per word transferred, so a message of `m` words costs `α + βm`, and `γ` is the per-word compute cost of `⊕`.

The naïve approach — reduce everything to one root, then broadcast — has the root as a bandwidth bottleneck (`(p−1)·n` words funnel through it). The good algorithms decompose all-reduce into two collectives, **`reduce-scatter`** (each processor ends owning the reduced value of *one slice*) followed by **`all-gather`** (each processor collects all the slices). The two classical schedules optimize *opposite* costs.

### Ring all-reduce — bandwidth-optimal

Arrange the `p` processors in a logical **ring**. Split each processor's `n`-element vector into `p` chunks of `n/p`.

- **Reduce-scatter phase (`p − 1` steps).** In step `k`, every processor sends one chunk to its right neighbor and receives one chunk from its left, *accumulating* (`⊕`) the received chunk into its own. After `p − 1` steps, each processor holds the *fully reduced* value of exactly *one* distinct chunk.
- **All-gather phase (`p − 1` steps).** The same ring rotation, now *copying* (no `⊕`) the fully-reduced chunks around until everyone has all `p` of them.

Total: `2(p − 1)` steps, and in *each* step every processor sends and receives exactly `n/p` words. So the **total bytes each processor moves is `2(p−1)·(n/p) ≈ 2n`** — *independent of `p`*. That is bandwidth-optimal: the lower bound for all-reduce is that each processor must send and receive `≈ 2·(p−1)/p · n ≈ 2n` words (you cannot do all-reduce moving less than `~2n` per node), and the ring achieves it. The cost is

```text
   T_ring  =  2(p − 1)·α   +   2·(p−1)/p · n · β   +   (p−1)/p · n · γ.
```

The `β` (bandwidth) term is optimal and *does not grow with `p`*; the price is the `2(p−1)·α` **latency** term, which grows *linearly* in `p`. Ring all-reduce is therefore the right choice for **large vectors** (bandwidth-bound) and **moderate `p`** — which is exactly the deep-learning gradient-averaging regime, and why Baidu's *ring all-reduce* (Patarasuk–Yuan's bandwidth-optimal schedule, popularized for DL by Baidu and then NCCL/Horovod) became the standard.

### Recursive halving-doubling — latency-optimal

Require `p` a power of two and pair processors at *exponentially growing* distances:

- **Reduce-scatter (recursive halving, `log p` steps).** In step `k`, each processor exchanges *half* of its current data with a partner at distance `2^k` and reduces; the exchanged half-size *halves* each step. After `log p` steps each owns one fully-reduced `n/p` slice.
- **All-gather (recursive doubling, `log p` steps).** Mirror it: exchange with the same partners in reverse, *doubling* the data each step until all is gathered.

Total: `2 log p` steps. The latency term is now `2 log p · α` — *logarithmic* in `p`, far better than the ring's linear `2(p−1)·α`. The bandwidth term works out to the *same* `≈ 2n·β` as the ring (it is also bandwidth-optimal for the data moved), but the per-step message sizes and the partner pattern stress the network differently, and for non-power-of-two `p` it needs awkward fix-up steps.

```text
   T_rhd  =  2 log₂ p · α   +   2·(p−1)/p · n · β   +   (p−1)/p · n · γ.
```

### The tradeoff, made explicit

| Schedule | Steps (latency) | Bytes/node (bandwidth) | Best when |
|---|---|---|---|
| **Naïve reduce + broadcast** | `O(log p)` (tree) | `O(p·n)` at the root — **bottleneck** | never, at scale |
| **Ring (Patarasuk–Yuan / Baidu)** | `2(p−1)·α` — **linear in `p`** | `≈ 2n·β` — **optimal, `p`-independent** | large vectors, moderate `p` (DL gradients) |
| **Recursive halving-doubling** | `2 log₂ p · α` — **log in `p`** | `≈ 2n·β` — optimal | small/medium vectors, large `p` (latency-bound) |
| **Tree all-reduce** | `2 log₂ p · α` | up to `O(n log p)` for some layouts | tiny messages (pure latency) |

The senior synthesis: **all-reduce is a `2n`-bandwidth, `Θ(latency × steps)` problem, and you trade steps (latency) against per-step size (bandwidth).** For the *enormous* gradient vectors of distributed training the bandwidth term dominates, so ring (constant `2n` bytes, `p`-independent) wins despite its `O(p)` latency; for *small* reductions across *many* nodes the latency term dominates, so recursive halving-doubling's `O(log p)` steps win. Production libraries (NCCL, NVIDIA's collective library; MPI implementations) **switch schedules by message size and `p`**, and add a hierarchical layer — ring/tree *within* a node over NVLink, a different schedule *across* nodes over the network — because the cost parameters `(α, β)` differ by orders of magnitude between intra-node and inter-node links. The ring-bandwidth derivation is worked in full in §10.

---

## GPU and Hardware Reductions: The Bandwidth Roofline

On a single accelerator the reduce algorithm is unchanged (a tree), but the engineering is dominated by one fact: **reduce is memory-bound, not compute-bound.** It performs `n` reads and `n − 1` trivial `⊕`s and produces *one* output — its *arithmetic intensity* (flops per byte) is essentially zero, so on the roofline model it lives entirely on the *bandwidth-bound* side. The only number that matters is how close you get to peak DRAM bandwidth; a perfect reduce reads each input *once* and is limited purely by `n / bandwidth`.

The standard GPU reduction maps the three-level blocked recipe of [`../02-parallel-prefix-sum-scan/senior.md`](../02-parallel-prefix-sum-scan/senior.md) onto the SIMT hierarchy:

- **Warp-level reduce (shuffle).** The 32 lanes of a warp reduce among themselves in `log₂ 32 = 5` steps using `__shfl_down_sync` / `__reduce_add_sync` — *register-to-register*, no shared memory, no barriers (lanes advance in lockstep). This is a Kogge–Stone-shaped tree living inside one warp, exactly where the work-inflated/min-depth profile is the right call because 32 elements is too small for the work penalty to matter.
- **Block-level reduce.** Combine the per-warp partials in shared memory (one value per warp → a final warp-reduce of the warp totals), yielding one value per thread-block. The classic Mark Harris *Optimizing Parallel Reduction in CUDA* sequence of optimizations — sequential addressing to avoid shared-memory bank conflicts, first-add-during-load to halve idle threads, unrolling the last warp, `__restrict__`/grid-stride loops — exists entirely to push a *bandwidth-bound* kernel closer to peak bandwidth, *not* to save arithmetic.
- **Grid-stride / multi-block.** Each block strides across the array reducing many elements into its registers *before* the tree (so global memory is read exactly once, coalesced), emits one partial per block, and a final small kernel (or a single-pass atomic) reduces the per-block partials. This is Brent's principle: do the cheap *sequential* accumulation per thread where serial is free, the parallel tree only across the few partials.

The recurring engineering decision is **atomics vs tree**:

- **Tree reduction** (block partials → second kernel / shared-memory tree) is deterministic in its *grouping* (you control the exact addition order, which matters for §9 reproducibility), reads memory in a coalesced, bandwidth-optimal pattern, and has no contention. It is the default for a faithful reduce.
- **Atomics** (`atomicAdd` into a single global accumulator) are simpler and can be a single pass, but they serialize on a contended cell (every block hitting one address), and — decisively for floats — they make the **addition order nondeterministic**, so the result is *not bit-reproducible* run to run. Atomics shine when contention is low (a histogram with many buckets, where blocks scatter across many counters) and reproducibility is not required; they are a trap for a single-accumulator float sum.

> **The roofline, in one sentence.** Because reduce's arithmetic intensity is ~0, the entire performance question is "did I read each input exactly once, coalesced, at peak bandwidth?" — which is why the GPU reduce literature is a catalogue of *memory* tricks (coalescing, bank-conflict avoidance, grid-stride single-read, fusing the map into the load so you never materialize the mapped array). At scale you are not minimizing operations; you are minimizing memory passes — the same lesson as the scan file, and the same reason you should call the library (`cub::DeviceReduce`, `thrust::reduce`) rather than hand-roll. The professional level walks the full kernel; see [`./professional.md`](./professional.md).

---

## Numerics: Associativity vs Floating Point in Depth

The contract of §2 was *exact* associativity. Floating-point addition is **not associative** — `(a + b) + c ≠ a + (b + c)` in general, because each `+` rounds to the nearest representable value and the rounding errors depend on the magnitudes being added. This is not a corner case; it is the defining numerical fact of parallel reduce, and the senior must understand both its error theory and its reproducibility consequences.

### The error theory: why the *tree shape* changes the accuracy

Summing `n` floating-point numbers accumulates rounding error, and the bound depends on the *shape* of the summation tree (the order/grouping of additions). Let `ε` be the unit roundoff (`≈ 2⁻⁵³` for double precision):

- **Naïve sequential (left-fold) sum** — a depth-`n` left-leaning tree — has worst-case relative error bounded by `≈ (n − 1)·ε` (a factor of `n` in the worst case, because every partial sum carries forward all prior rounding). Error grows **linearly in `n`**: `O(εn)`.
- **Pairwise (cascade) summation** — the balanced binary tree that a parallel reduce *naturally is* — has worst-case error bounded by `≈ (log₂ n)·ε`. Error grows only **logarithmically in `n`**: `O(ε log n)`.

This is a delightful inversion of the usual story: **the parallel reduce is not only faster than the sequential fold, it is usually *more accurate*,** because the balanced tree keeps the magnitudes of the things being added closer together, so fewer low-order bits are lost. The depth that the lower bound of §5 *forces* on you (`log n`) is the very thing that *improves* the numerics. (This is why even *sequential* numerical libraries implement `sum` as pairwise/cascade summation, not a naïve loop — they emulate the reduce tree precisely for the `O(ε log n)` bound.)

When even `O(ε log n)` is not enough, **compensated summation** recovers the lost low-order bits:

- **Kahan summation** carries a running compensation term `c` that captures the rounding error of each addition and feeds it back into the next, yielding an error bound of `≈ 2ε` *independent of `n`* (plus a tiny `O(nε²)` term). It costs ~4× the additions but is essentially "free" on a bandwidth-bound reduce (the arithmetic is not the bottleneck — see §8). Its parallel form keeps a `(sum, compensation)` pair as the monoid element and combines two compensated partials with a Kahan-merge step — i.e. compensated summation is *itself* an associative-up-to-tiny-error monoid you can reduce in a tree.
- **Pairwise + Kahan** combines both: the `O(log n)` tree depth *and* the compensation, giving the tightest practical bound.

### Reproducibility: the deterministic-tree requirement

The error theory says the parallel reduce is *accurate*; reproducibility is a *different* requirement that the parallel reduce makes *harder*. Because float `+` is not associative, **different reduction trees give bit-different results** — and a parallel reduce's tree shape depends on the processor count, the block size, the scheduling, and (for atomics) the *nondeterministic order in which blocks finish*. So:

- Run the same gradient all-reduce on 8 GPUs vs 16, or with atomics vs a tree, and you get *bit-different* sums. This breaks debugging ("why did the loss diverge only on the 16-GPU run?"), regulatory/audit requirements, and exact test reproducibility.
- The fix is a **deterministic (fixed-tree) reduction**: pin the reduction order — a fixed block size, a fixed combine tree, *no* atomics (or deterministic-atomic emulation) — so the *same* parenthesization is used every run, on every machine, regardless of `p`. The result is then bit-reproducible (though still not equal to the exact real-number sum). Libraries expose this as a "deterministic mode" (e.g. deterministic cuDNN/NCCL reductions), and it trades some performance (you cannot accumulate in arrival order) for run-to-run identical bits.
- For reproducibility *across* differing `p` and platforms, the stronger tool is **reproducible/"exact" summation** — e.g. superaccumulators (a wide fixed-point accumulator that makes the sum associative again because no rounding occurs until the end) or Demmel–Nguyen's pre-rounding reproducible BLAS — which guarantee the *same* result independent of the reduction tree, at extra cost.

> **The senior stance on numerics.** Associativity is a *lie you tell the compiler* (`-ffast-math` / `-fassociative-math`) to license the parallel tree; it is true in `ℝ` and false in IEEE-754. Three consequences: (1) the parallel (pairwise) tree is *more* accurate than the naïve sequential loop — `O(ε log n)` vs `O(ε n)` — so parallelism *helps* accuracy; (2) when you need more, use *Kahan/compensated* summation as a `(sum, comp)` monoid; (3) when you need *bit-reproducibility*, you must *fix the reduction tree* (deterministic mode) or use *exact/reproducible* summation — and you must *forbid the order-dependent atomics* that §8 otherwise tempts you with. Performance, accuracy, and reproducibility are three different axes, and on a non-associative operator you cannot maximize all three at once.

---

## Worked Piece: The (min,+) Semiring Map-Reduce and the Ring All-Reduce Bandwidth Bound

Two end-to-end derivations tie the threads together: the *algebraic* one (a semiring map-reduce that *is* a graph algorithm) and the *systems* one (why ring all-reduce hits the `2n` bandwidth floor).

### Part A — `(min, +)` map-reduce is one round of shortest paths

**The setup.** Let `D` be the `n × n` matrix of current best-known distances between every pair of vertices (`D[i][j] = ∞` if unknown), and `W` the edge-weight matrix. One round of "improve every shortest path by allowing one more intermediate hop" is the generalized matrix product over the **tropical semiring** `(min, +, +∞, 0)`:

```text
   D'[i][j]  =  min_k  ( D[i][k] + W[k][j] ).
```

**Read it as a map-reduce.** Fix `i, j`. The inner expression is:

```text
   map step (the ⊗ = +):     for each k,  pᵢⱼ(k) = D[i][k] + W[k][j]      # n independent adds
   reduce step (the ⊕ = min): D'[i][j]   = REDUCE(min, { pᵢⱼ(k) : k })    # a min-reduce over n values
```

The map (`+`) is embarrassingly parallel — `O(1)` span, `O(n)` work per `(i,j)`. The reduce (`min`) is a balanced min-tree — `O(log n)` span, `O(n)` work per `(i,j)`. `(min, +∞)` is a commutative monoid; `+` distributes over `min` (`a + min(b,c) = min(a+b, a+c)`), so the semiring laws hold and the fusion is legitimate.

**Complexity of one round.** Over all `n²` output cells: work `T₁ = O(n³)` (the `n³` "multiply-add"-analogues of a matmul), span `T∞ = O(log n)` (every cell's `min`-reduce runs in parallel, each `O(log n)` deep). All-pairs shortest paths is then `⌈log₂ n⌉` rounds of *repeated squaring* `D ← D ⊗ D` (each squaring doubles the number of hops allowed), giving total span `O(log² n)` and placing APSP in `NC²` — exactly the `NC²` claim of [`../01-models-pram-work-span/senior.md`](../01-models-pram-work-span/senior.md), here *constructed* as a logarithmic stack of semiring map-reduces.

**Why this is the payoff.** *Nothing in the parallel machinery changed.* Swap `(min, +)` for `(+, ×)` and the identical map-reduce kernel computes ordinary matrix multiply; swap in `(∨, ∧)` and it computes reachability/transitive closure (`D'[i][j] = ∃k: D[i][k] ∧ W[k][j]`), in `(max, +)` it is Viterbi/critical-path. One parallel reduce-over-a-semiring, parameterized by an algebra, is an entire shelf of algorithms — the GraphBLAS thesis made concrete.

### Part B — why ring all-reduce moves exactly `2n` bytes per node

**The claim.** Reducing an `n`-element vector across `p` ring-connected processors costs each node `≈ 2n` words of communication, *independent of `p`* — and this is optimal.

**Reduce-scatter (`p − 1` steps).** Chunk each node's vector into `p` pieces of `n/p`. Index steps `k = 0 … p−2`. In step `k`, node `r` sends one specific chunk to node `r+1` and receives one from `r−1`, adding (`⊕`) the received chunk into its local copy.

```text
   per step, per node:  send n/p words  +  receive n/p words.
   after p−1 steps:      each node owns ONE fully-reduced chunk (the sum across all p nodes
                          of that chunk's position), and has sent (p−1)·(n/p) words.
```

So the reduce-scatter moves `(p−1)·(n/p) ≈ n·(1 − 1/p)` words sent per node — *approaching `n` as `p` grows*, never exceeding it.

**All-gather (`p − 1` steps).** The same ring rotation, now copying (no `⊕`) the `p` fully-reduced chunks around the ring until every node holds all of them. Identical traffic: another `(p−1)·(n/p) ≈ n·(1 − 1/p)` words sent per node.

**Total per node:**

```text
   sent  =  2·(p−1)/p · n  ≈  2n          (and the same received)
   steps =  2(p − 1)                       (latency term 2(p−1)·α)
```

The bandwidth term `2(p−1)/p · n · β → 2n·β` is **flat in `p`** — adding nodes does not increase the bytes any single node must move. **Optimality:** an all-reduce must have every node's final value reflect all inputs, so each node must *receive* the contribution of the other `p−1` nodes' data and *send* its own out; an information-flow argument gives a lower bound of `≈ 2·(p−1)/p · n` words moved per node, which the ring *exactly* achieves. The only thing growing with `p` is the *latency* (`2(p−1)` startups), which is why ring loses to recursive halving-doubling's `2 log₂ p` steps once the vector is small enough that `α`-latency, not `β`-bandwidth, dominates.

**The takeaway, mirroring Part A.** Distributed reduce is a *bandwidth* problem with a hard `2n`-per-node floor; the schedule (ring vs halving-doubling vs tree) only chooses *how the `2n` is paid* — in few large steps (bandwidth-friendly, latency-heavy) or many small ones (latency-friendly). This is the systems-level analogue of the algebraic freedom in Part A: the *cost* is fixed by the problem (`2n` bytes, `log n` fan-in depth); the *schedule* or *algebra* is the parameter you tune.

---

## Decision Framework

When you face a "combine all of these" or "transform-then-combine" problem and must parallelize it:

1. **Find the monoid.** Is the combine *associative*? (Sum, product, min/max, AND/OR, concat, set-union, histogram-add, top-k-merge, sketch-merge, `(sum,count)` for mean, `(count,min,max,sum,sumsq)` for variance.) If yes, it is an `O(log n)`-span, `O(n)`-work reduce — *the same machinery*, only the `⊕` changes. Provide an *identity* so empty/ragged input is total and branch-free. If it is *not* obviously a monoid, apply the next test.
2. **Apply the parallelizability test (third homomorphism theorem).** Can you compute the function *both* left-to-right *and* right-to-left? If yes, a list-homomorphism (map-reduce) provably exists — synthesize the `⊕`. If only *one* direction is natural, it is a *sequential recurrence*: fall back to the affine/matrix scan-monoid trick of [`../02-parallel-prefix-sum-scan/senior.md`](../02-parallel-prefix-sum-scan/senior.md).
3. **Combined map-reduce? Reach for the semiring.** If it is "multiply pairwise then add" — inner products, matrix products, path problems — name the semiring `(⊕, ⊗)`: `(+, ×)` linear algebra, `(min, +)` shortest paths, `(∨, ∧)` reachability, `(max, +)` Viterbi. One generalized-matrix-product kernel serves them all (the GraphBLAS pattern).
4. **Per-group? Use multi-reduce, not a loop of reduces.** For ragged groups attach head flags and do **segmented reduce**; for arbitrary keys, sort-by-key then segmented-reduce, or scatter to dense accumulators (histogram). The irregularity collapses into the algebra and the work load-balances automatically. See [`../06-map-reduce-patterns/senior.md`](../06-map-reduce-patterns/senior.md).
5. **Distributed? Pick the all-reduce schedule by message size and `p`.** Large vectors / moderate `p` (DL gradients) → **ring** (Patarasuk–Yuan / Baidu): `2n` bytes, `p`-independent bandwidth-optimal. Small vectors / large `p` → **recursive halving-doubling**: `2 log p` steps, latency-optimal. Use the library (NCCL/MPI) — it switches schedules and goes hierarchical (intra-node vs inter-node) for you.
6. **On a GPU, it is memory-bound — call the library.** `cub::DeviceReduce` / `thrust::reduce` ship warp-shuffle, grid-stride, coalesced, bank-conflict-free reductions at near-peak bandwidth. Prefer a **tree** over **atomics** for a faithful float sum (atomics serialize on contention and destroy reproducibility); reserve atomics for low-contention scatters like histograms.
7. **Mind the numerics.** Float `+` is *not* associative. The parallel *pairwise* tree is *more* accurate than a naïve loop (`O(ε log n)` vs `O(ε n)`) — a free win. Need more? Use **Kahan/compensated** summation (a `(sum, comp)` monoid). Need **bit-reproducibility** across differing `p`? Fix the reduction tree (deterministic mode), forbid order-dependent atomics, or use exact/reproducible summation.
8. **Don't chase `O(1)` span.** A faithful reduce's output depends on all `n` inputs → `Ω(log n)` span forced on EREW/CREW (Cook–Dwork–Reischuk / fan-in). The `O(log n)` tree is optimal; spend effort on work-efficiency, bandwidth, and numerics instead.

---

## Research Pointers

- **Bird, R. S. (1987).** "An Introduction to the Theory of Lists." The Bird–Meertens formalism (squiggol): map, reduce, and list homomorphisms as the algebra of programs over lists; the first homomorphism theorem (`h = reduce ∘ map`).
- **Meertens, L. (1986).** "Algorithmics — Towards Programming as a Mathematical Activity." The companion foundation of BMF.
- **Gibbons, J. (1996).** "The Third Homomorphism Theorem." *Journal of Functional Programming.* The "computable both left-to-right and right-to-left ⟹ a list homomorphism (hence parallelizable)" theorem, with constructions that synthesize the combine operator.
- **Cole, M. (1995).** "Parallel Programming with List Homomorphisms." The skeleton/BMF view of list homomorphisms as the basis of parallel programming.
- **Blelloch, G. E. (1990).** *Vector Models for Data-Parallel Computing.* MIT Press. `reduce`/`scan`/`map` as unit-cost data-parallel primitives, segmented operations, the scan-vector model (the NESL lineage).
- **Cook, S., Dwork, C., Reischuk, R. (1986).** "Upper and lower time bounds for parallel random access machines without simultaneous writes." The `Ω(log n)` EREW/CREW lower bound that reduce's single all-sensitive output saturates.
- **Patarasuk, P., & Yuan, X. (2009).** "Bandwidth optimal all-reduce algorithms for clusters of workstations." *JPDC.* The bandwidth-optimal **ring all-reduce** — the schedule Baidu and then Horovod/NCCL popularized for distributed deep learning.
- **Thakur, R., Rabenseifner, R., & Gropp, W. (2005).** "Optimization of Collective Communication Operations in MPICH." *IJHPCA.* Recursive halving-doubling, the `α`/`β` cost model, and the message-size-and-`p` schedule switching for all-reduce.
- **Harris, M. (2007).** "Optimizing Parallel Reduction in CUDA." NVIDIA. The canonical GPU reduction optimization sequence (bank conflicts, first-add-during-load, warp unrolling) — all bandwidth, not arithmetic.
- **Kahan, W. (1965).** "Further remarks on reducing truncation errors." *CACM.* Compensated summation — the `O(1)`-error-independent-of-`n` sum.
- **Higham, N. J. (1993/2002).** "The accuracy of floating point summation" / *Accuracy and Stability of Numerical Algorithms.* The `O(ε n)` naïve vs `O(ε log n)` pairwise error analysis.
- **Demmel, J., & Nguyen, H. D. (2013/2015).** "Fast Reproducible Floating-Point Summation." Reproducible/"exact" reductions independent of the summation tree (superaccumulators, pre-rounding).
- **Kepner, J., & Gilbert, J. (2011).** *Graph Algorithms in the Language of Linear Algebra*, and the **GraphBLAS** standard. Semiring map-reduce / generalized matrix products as the unifying engine for BFS, shortest paths, and reachability.

---

## Key Takeaways

- **A monoid is the *exact* requirement for parallel reduce.** Associativity licenses the balanced tree (it is the *correctness* precondition, not a convenience); the identity makes the fold total on empty/ragged input. **Commutativity is a bonus** (it licenses order-independent accumulation), and float `+` is commutative-but-not-associative — the reverse of the naïve guess. The senior reflex is *monoid-spotting*: sum, min/max, histogram, top-k, sketches, `(sum,count)` are all monoids reduced by one machine.
- **Semirings unify map and reduce and generalize the matrix product.** The pair `(⊕, ⊗)` with distributivity makes `D'[i][j] = ⊕_k (A[i][k] ⊗ B[k][j])` a combined map-reduce: `(+, ×)` = linear algebra, `(min, +)` = shortest paths, `(∨, ∧)` = reachability, `(max, +)` = Viterbi. One kernel, an algebra as the parameter — the GraphBLAS idea.
- **Reduce is a catamorphism, and the third homomorphism theorem is the parallelizability test.** By Bird–Meertens, every list homomorphism factors as `reduce ∘ map`; by Gibbons (1996), a function computable *both* left-to-right *and* right-to-left *is* a list homomorphism — hence a map-reduce, hence `O(log n)`-span — and the theorem even synthesizes the combine `⊕`. "Both directions" replaces "find the clever monoid" with a checkable criterion.
- **Reduce is in `NC¹` and the tree is span-optimal.** `T₁ = O(n)`, `T∞ = O(log n)`; the single all-sensitive output forces `Ω(log n)` on EREW/CREW (Cook–Dwork–Reischuk / fan-in floor). Don't chase `O(1)` span — invest in work-efficiency, bandwidth, and numerics.
- **Multi-reduce (reduce-by-key / segmented reduce) is one reduce over a richer monoid**, not a loop of reduces — perfectly load-balanced regardless of group-size skew; it is the `reduce` phase of MapReduce, where *combiners* are local pre-reductions that need a commutative monoid. See [`../06-map-reduce-patterns/senior.md`](../06-map-reduce-patterns/senior.md).
- **Distributed all-reduce is a `2n`-bytes-per-node bandwidth problem with a latency-vs-bandwidth schedule choice.** **Ring** (Patarasuk–Yuan / Baidu) is bandwidth-optimal (`2n` bytes, `p`-independent, `2(p−1)` steps) — the core of DL gradient averaging; **recursive halving-doubling** is latency-optimal (`2 log p` steps). Libraries switch by message size and `p` and go hierarchical.
- **On hardware, reduce is memory-bound (roofline) and floating point is not associative.** GPU reductions (warp shuffle → block → grid-stride) are a catalogue of *bandwidth* tricks; prefer **tree over atomics** for faithful, reproducible sums. The parallel *pairwise* tree is *more* accurate (`O(ε log n)` vs naïve `O(ε n)`); use **Kahan** for tighter bounds and a **fixed reduction tree** for bit-reproducibility. Accuracy, speed, and reproducibility are three separate axes you cannot all maximize at once.

---

> **See also:** [`./middle.md`](./middle.md) for map (span 1), reduce (span log n), the monoid contract, and the two-level recipe · [`./professional.md`](./professional.md) for the full GPU reduction implementation and production all-reduce engineering · [`../02-parallel-prefix-sum-scan/senior.md`](../02-parallel-prefix-sum-scan/senior.md) for scan — reduce's "keep every prefix" sibling — and the segmented/blocked machinery · [`../06-map-reduce-patterns/senior.md`](../06-map-reduce-patterns/senior.md) for reduce-by-key, combiners, the shuffle, and the distributed MapReduce framing · [`../01-models-pram-work-span/senior.md`](../01-models-pram-work-span/senior.md) for `NC¹`/`NC²`, work–span, and the Cook–Dwork–Reischuk lower bound
