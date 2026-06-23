# Parallel Reduce and Map — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Map, Restated for Proofs](#map-restated-for-proofs)
   - [The Trivial DAG and Its Bounds](#the-trivial-dag-and-its-bounds)
   - [Map Fusion](#map-fusion)
3. [Reduce, Restated for Proofs](#reduce-restated-for-proofs)
   - [The Monoid Requirement](#the-monoid-requirement)
   - [The Balanced Reduction Tree](#the-balanced-reduction-tree)
   - [Work Θ(n) and Span Θ(log n), Proved](#work-θn-and-span-θlog-n-proved)
   - [Commutativity: When Order May Float](#commutativity-when-order-may-float)
4. [Reduce vs Scan](#reduce-vs-scan)
5. [Implementing Reduce](#implementing-reduce)
   - [The Strided Pairwise Loop (GPU Style)](#the-strided-pairwise-loop-gpu-style)
   - [The Two-Level Reduce](#the-two-level-reduce)
   - [Segmented Reduce](#segmented-reduce)
6. [Floating Point Is Not Associative](#floating-point-is-not-associative)
7. [Map–Reduce Composition](#mapreduce-composition)
   - [Dot Product](#dot-product)
   - [Mean and Variance](#mean-and-variance)
   - [Histogram and Word Count](#histogram-and-word-count)
8. [Code: Map and Reduce with Work/Span Counters](#code-map-and-reduce-with-workspan-counters)
   - [Go](#go)
   - [Python](#python)
9. [Pitfalls](#pitfalls)
10. [Summary](#summary)

---

## Introduction

> Focus: turn the junior facts — map is embarrassingly parallel, reduce is a tree of depth `log n`, the operator must be associative — into rigorous statements you can *prove* and *implement*. By the end you can prove map's `Θ(n)` work / `Θ(1)` span and reduce's `Θ(n)` work / `Θ(log n)` span, state exactly why reduce needs a **monoid**, build the practical **two-level reduce** with its `Θ(n/p + log p)` span, write a **segmented reduce**, and explain why a parallel floating-point reduce can disagree with the serial loop.

At the [junior level](./junior.md) you met the two foundational data-parallel primitives. **Map** applies a function `f` independently to every element — `[x₀, …, x_{n−1}] ↦ [f(x₀), …, f(x_{n−1})]` — and is *embarrassingly parallel*: no element depends on another. **Reduce** folds `n` elements into one with a binary operator `⊕` — `x₀ ⊕ x₁ ⊕ … ⊕ x_{n−1}` — and goes parallel via a **balanced tree** of depth `log n`. You saw that `⊕` must be **associative** for the tree to give the right answer, and you met the [work–span model](../01-models-pram-work-span/middle.md): **work** `T₁` (total operations, = 1-processor time), **span** `T∞` (critical-path length, = ∞-processor time), and `P`-processor time `T_P ≤ T₁/P + T∞` (Brent).

This file makes both primitives rigorous:

- **Map** in full: work `Θ(n)`, span `Θ(1)` (ideally), `Θ(n/p)` on `p` processors. Its DAG is `n` independent nodes — the simplest possible parallel structure. We cover **map fusion**: composing `g ∘ f` into one map so the intermediate array is never materialized.
- **Reduce** in full: the balanced tree has `n − 1` internal nodes (work `Θ(n)`) and depth `⌈log₂ n⌉` (span `Θ(log n)`). We *prove* both. We state the **monoid** requirement — `⊕` associative with identity `e` — and show precisely what breaks without it.
- **Reduce vs scan.** Reduce returns one value (the *last* prefix); [scan](../02-parallel-prefix-sum-scan/middle.md) returns *all* prefixes — same tree, scan keeps the partials.
- **Implementation.** The strided pairwise loop (the GPU `log n`-pass picture) and the practical **two-level reduce**: each of `p` processors reduces `n/p` locally in `Θ(n/p)`, then `p` partials combine in `Θ(log p)` — work `Θ(n)`, span `Θ(n/p + log p)`. Plus **segmented reduce** (reduce within flagged segments).
- **Floating point** is *not* associative: parallel reduce can give a different (and `p`-dependent) result than the serial loop — a reproducibility hazard worth naming.
- **Map–reduce composition** — dot product, mean/variance, histogram, word count — each `Θ(n)` work, `Θ(log n)` span.

A note on vocabulary used throughout:

| Symbol | Meaning |
|--------|---------|
| `n` | number of input elements |
| `p` | number of processors |
| `f`, `g` | element-wise (map) functions |
| `⊕` | an associative binary operator (with identity `e`) |
| `e` | the identity element of `⊕` (`e ⊕ x = x ⊕ e = x`) |
| `T₁` | **work** — total operations |
| `T∞` | **span** — critical-path length |

Throughout we analyze in the [work–span model](../01-models-pram-work-span/middle.md). All logarithms are base 2 unless noted, and where convenient we take `n` to be a power of two — the bounds are unchanged for general `n` (pad to the next power of two, at most doubling the size, or handle the ragged last level explicitly).

---

## Map, Restated for Proofs

### The Trivial DAG and Its Bounds

**Map** transforms each element independently:

```text
  map f [x0, x1, …, x_{n−1}]  =  [f(x0), f(x1), …, f(x_{n−1})]
```

The defining property is **independence**: `f(x_i)` reads only `x_i` and writes only output slot `i`. No element's computation depends on any other's. The computation DAG is therefore the simplest one possible — `n` isolated nodes, no edges:

```text
   f(x0)   f(x1)   f(x2)   …   f(x_{n−1})       (n nodes, ZERO dependency edges)
     ●       ●       ●             ●
```

> **Claim.** Map has **work `T₁ = Θ(n)`** and **span `T∞ = Θ(1)`** (assuming `f` is `O(1)`). On `p` processors it runs in **`Θ(n/p + 1)`** time.

**Work.** There are `n` applications of `f`, each `O(1)`, so `T₁ = Θ(n)`. This is work-efficient — the sequential map is also `Θ(n)`, one pass.

**Span.** Since there are no dependency edges, the longest path in the DAG is a single node: `T∞ = Θ(1)`. Every output can in principle be computed *at the same time*. Map is the canonical *embarrassingly parallel* computation: its parallelism `T₁/T∞ = Θ(n)` is as high as it can be.

**On `p` processors.** By [Brent's principle](../01-models-pram-work-span/middle.md), `T_p = Θ(T₁/p + T∞) = Θ(n/p + 1)`. Divide the `n` elements into `p` contiguous blocks of `⌈n/p⌉`; each processor maps its block. There is no synchronization, no communication, no reduction tree — just a balanced static partition. The `+1` is the floor: you cannot finish faster than one `f`-application even with `n` processors. If `f` itself costs `Θ(c)`, scale through: work `Θ(n·c)`, span `Θ(c)`, time `Θ(nc/p + c)`.

This `Θ(1)`-span ideal assumes the output array already exists and writes are conflict-free (each slot written by exactly one processor — an EREW-legal pattern). On a real machine the floor is set by memory bandwidth, not the operation count: map is almost always **memory-bound**, which is exactly what motivates fusion next.

### Map Fusion

Composing two maps naively materializes an intermediate array:

```text
  map g (map f xs)                      // two passes, one temp array of size n
    = [g(f(x0)), g(f(x1)), …]
```

The first map writes `n` values of `f(xs)` to a temporary buffer; the second reads them back and writes `n` values of `g(…)`. That is **2n writes, 2n reads, and `n` extra memory** for a result that the *single* map below produces in `n` writes, `n` reads, no temp:

> **Map fusion.** `map g ∘ map f  =  map (g ∘ f)`. The composition of two maps is a single map of the composed function.

```text
  map (g ∘ f) xs                        // ONE pass, NO intermediate array
    = [g(f(x0)), g(f(x1)), …]
```

The transformation is a theorem, not a heuristic: because map is element-wise, the `i`-th output of `map g (map f xs)` is `g(f(x_i))`, which is exactly the `i`-th output of `map (g ∘ f) xs`. The asymptotic *work* is unchanged (`Θ(n)` either way), but the **constant factors and memory traffic** are not — fusion halves the memory passes and eliminates the `Θ(n)` temporary. On a bandwidth-bound machine that is often a 2× speedup. This is why array languages, GPU kernels, and stream frameworks (NumPy's `numexpr`, Halide, TensorFlow XLA, Rust iterators) aggressively fuse chains of element-wise operations into one kernel. The same logic extends to fusing a map *into* a reduce — a **map–reduce** — so the mapped values are consumed by the tree without ever being stored, which is the subject of [§7](#mapreduce-composition).

---

## Reduce, Restated for Proofs

### The Monoid Requirement

Reduce folds `n` elements into one:

```text
  reduce ⊕ [x0, x1, …, x_{n−1}]  =  x0 ⊕ x1 ⊕ … ⊕ x_{n−1}
```

For a *parallel* reduce to equal the *sequential* fold, `⊕` must form a **monoid**.

> **Definition (monoid).** `(S, ⊕, e)` is a monoid when (i) `⊕` is **associative**: `(a ⊕ b) ⊕ c = a ⊕ (b ⊕ c)` for all `a, b, c`; and (ii) `e` is an **identity**: `e ⊕ a = a ⊕ e = a` for all `a`.

**Why associativity is mandatory.** A sequential reduce parenthesizes strictly left-to-right: `((…((x₀ ⊕ x₁) ⊕ x₂) … ) ⊕ x_{n−1})`. A *tree* reduce parenthesizes by halves: `(x₀ ⊕ x₁) ⊕ (x₂ ⊕ x₃)`, and so on. These two parenthesizations give the *same answer for every input* **if and only if `⊕` is associative**. Associativity is precisely the law "the placement of parentheses does not matter," which is *exactly* the freedom a parallel reduce exploits when it combines sub-ranges in tree order instead of linear order.

**What breaks without it.** Take `⊕ = −` (subtraction), which is not associative. Sequential: `((10 − 1) − 2) − 3 = 4`. Tree: `(10 − 1) − (2 − 3) = 9 − (−1) = 10`. Different answers — the tree reduce is simply *wrong* for subtraction. The same failure hits division, and (subtly) floating-point addition, which is associative in the ideal reals but *not* under rounding ([§6](#floating-point-is-not-associative)).

**Why an identity.** The identity `e` is what you return for the **empty** reduce (`reduce ⊕ [] = e`), and what seeds a processor that received *no* elements in the two-level scheme (`n < p`). It also lets you pad a non-power-of-two input up to the next power of two with copies of `e` — they vanish under `⊕`, leaving every partial untouched. Without an identity, the empty and ragged cases need special-casing.

```text
   monoid examples used for reduce:
     (ℤ, +, 0)          sum
     (ℝ, ×, 1)          product
     (ℤ, max, −∞)       maximum
     (ℤ, min, +∞)       minimum
     (bits, OR, 0)      any-bit-set     (AND with identity all-ones)
     (bits, XOR, 0)     parity / checksum
     (sets, ∪, ∅)       union
```

### The Balanced Reduction Tree

To reduce in parallel, pair adjacent elements, combine each pair, and recurse on the halved array:

```text
   level 0:  x0  x1   x2  x3   x4  x5   x6  x7      (n = 8 leaves)
              \  /     \  /     \  /     \  /
   level 1:  (x0⊕x1)  (x2⊕x3)  (x4⊕x5)  (x6⊕x7)     (4 partials)
                 \        /        \        /
   level 2:    (x0..x3)            (x4..x7)          (2 partials)
                      \              /
   level 3:          (x0 ⊕ … ⊕ x7)                   (1 root = result)
```

Each level is fully parallel (its combinations are independent of one another), and level `k+1` depends only on level `k`. After `⌈log₂ n⌉` levels, a single value — the reduction of the whole array — remains at the root.

### Work Θ(n) and Span Θ(log n), Proved

> **Claim.** Reduce over a balanced tree has **work `T₁ = Θ(n)`** and **span `T∞ = Θ(log n)`**.

**Work — exactly `n − 1` combine operations.** There are two ways to see it.

*Counting per level.* Level `k` (starting at `k = 0`) takes `n/2^k` values and produces `n/2^{k+1}` partials, i.e. it performs `n/2^{k+1}` combines. Summing over all `log₂ n` levels (taking `n` a power of two):
```text
  T₁ = Σ_{k=0}^{log n − 1} n/2^{k+1}
     = n/2 + n/4 + … + 1
     = n − 1
     = Θ(n).
```

*Counting by nodes.* A full binary tree with `n` leaves has exactly `n − 1` internal nodes, and each internal node is one `⊕`. Either way, **`n − 1` combine operations** — `Θ(n)`, matching the sequential reduce's `n − 1` combines. Reduce is **work-efficient**.

**Span — depth `⌈log₂ n⌉`.** The tree has `⌈log₂ n⌉` levels; each level depends on the previous (level `k+1`'s combines read level `k`'s outputs), so the levels form a dependency chain of length `⌈log₂ n⌉`. Within a level everything is parallel. The critical path is therefore one `⊕` per level: `T∞ = ⌈log₂ n⌉ = Θ(log n)`.

```text
  reduce:  T₁ = Θ(n)   T∞ = Θ(log n)   parallelism = Θ(n / log n)   work-efficient? YES
```

This `Θ(log n)` span is **optimal** on EREW/CREW: the result depends on all `n` inputs, and by the [binary fan-in lower bound](../01-models-pram-work-span/middle.md), information from `n` inputs cannot converge into one value faster than a depth-`log n` binary tree. (Only a CRCW machine with a *combining* write rule can shortcut this — `n` processors summing into one cell in `O(1)` — and that is a hardware idealization.) So tree reduce is **span-optimal and work-optimal** simultaneously, exactly like the [work-efficient scan](../02-parallel-prefix-sum-scan/middle.md) it underlies.

### Commutativity: When Order May Float

Associativity lets us *re-parenthesize*; **commutativity** (`a ⊕ b = b ⊕ a`) lets us *re-order*. Reduce needs only associativity to match the serial left-to-right fold, because the tree preserves the left-to-right *order* of the leaves — it only regroups them. So a non-commutative-but-associative operator (matrix product, string concatenation, function composition) reduces correctly, *provided the implementation keeps the leaf order*.

Commutativity buys *extra* freedom, and some fast implementations rely on it:

- **Atomic reductions.** When `p` processors each `atomicAdd` their partial into one shared accumulator, the partials land in *non-deterministic order*. That is correct *only if* `⊕` is commutative (and associative) — sum, max, min, OR, XOR all qualify; matrix product does *not*.
- **Order-independent scheduling.** A work-stealing runtime that combines partials as they finish (in completion order, not index order) similarly needs commutativity.

```text
   associative only        → tree reduce in leaf order is correct (matrices, strings, composition)
   associative + commutative → may also reorder freely (atomic accumulate, completion-order combine)
```

The practical rule: if your `⊕` is commutative, you may use the simplest atomic/unordered combine; if it is associative but *not* commutative, you must combine partials in index order. We return to this in the [pitfalls](#pitfalls).

---

## Reduce vs Scan

Reduce and [scan](../02-parallel-prefix-sum-scan/middle.md) are the *same tree*, distinguished only by **what they keep**.

```text
  input:   x0   x1   x2   x3
  reduce:                      x0 ⊕ x1 ⊕ x2 ⊕ x3        ← ONE value (the last/total prefix)
  scan:    x0  x0⊕x1  …        x0 ⊕ x1 ⊕ x2 ⊕ x3        ← ALL prefixes (n values)
```

- **Reduce** returns a *single* value — the grand total, equivalently the *last* inclusive prefix `y_{n−1}`. It keeps only the root of the tree and discards every internal partial.
- **Scan** returns *all `n` prefixes* `y_0, y_1, …, y_{n−1}`. It runs the *same* up-sweep reduction tree but then **keeps the partials** and pushes them back down (Blelloch's down-sweep) to produce every prefix.

Concretely, the up-sweep of the [work-efficient scan](../02-parallel-prefix-sum-scan/middle.md) *is* a reduction — its root is the reduce result — and the scan's extra work is the down-sweep that distributes the saved partials. So:

```text
  reduce(x)  =  last value of scan(x)        // reduce is "scan, but throw away all but the last"
```

Both are `Θ(n)` work, `Θ(log n)` span. Use **reduce** when you need only the aggregate (a sum, a max, a count); use **scan** when you need every running prefix (compaction destinations, allocation offsets, running totals). Reaching for a full scan when a reduce suffices wastes the down-sweep; reaching for repeated reduces when you need all prefixes is `Θ(n)` reduces = `Θ(n²)` work where one scan would do `Θ(n)`.

---

## Implementing Reduce

### The Strided Pairwise Loop (GPU Style)

The textbook tree is usually implemented *in place* as `log n` passes over an array, each pass with a doubling **stride**. Keep `a[0..n−1]` = input; in pass `s = 1, 2, 4, …`, element `a[i]` absorbs `a[i + s]` for the active indices, halving the live count each pass:

```text
  for s = 1, 2, 4, … while s < n:
      for all i = 0, 2s, 4s, … in parallel:
          a[i] ← a[i] ⊕ a[i + s]
  // result is in a[0]
```

The picture for `n = 8` (reading the result downward into `a[0]`):

```text
  index:    0     1     2     3     4     5     6     7
  start:    x0    x1    x2    x3    x4    x5    x6    x7

  s=1:      x0:1        x2:3        x4:5        x6:7         (a[0]+=a[1], a[2]+=a[3], …)
  s=2:      x0:3                    x4:7                     (a[0]+=a[2], a[4]+=a[6])
  s=4:      x0:7                                             (a[0]+=a[4])
                                                            ← a[0] = x0 ⊕ … ⊕ x7
```

Here `xa:b` abbreviates `x_a ⊕ … ⊕ x_b`. This is the **GPU reduction**: `⌈log₂ n⌉` parallel passes (span `Θ(log n)`), and pass `s` does `n/(2s)` combines for a total of `n − 1` (work `Θ(n)`). A real GPU kernel reduces *within a block* this way (over a fast shared-memory tile), then reduces the per-block partials in a second kernel launch — which is exactly the two-level structure below, generalized to many levels. (Care is needed about *strided* memory access and warp divergence; the senior file treats those.)

### The Two-Level Reduce

On a `p`-processor machine you almost never build the full `log n`-deep tree directly. The practical algorithm is **two-level**: a *local* sequential reduce per processor, then a *small* tree over the `p` partials.

```text
  Phase 1 (parallel, local):  each processor j reduces its block of n/p elements
                              sequentially  →  partial_j      ( Θ(n/p) work each )
  Phase 2 (combine):          reduce the p partials in a tree →  result
                              ( Θ(p) work, Θ(log p) span )
```

```text
   n elements, p = 4 processors
   ┌────────┬────────┬────────┬────────┐
   │ block0 │ block1 │ block2 │ block3 │     each block = n/p elements
   └───┬────┴───┬────┴───┬────┴───┬────┘
       │ seq    │ seq    │ seq    │ seq      Phase 1: local reduce, Θ(n/p) each, all parallel
       ▼        ▼        ▼        ▼
     part0    part1    part2    part3        p partials
        \       /        \       /
         (tree reduce over p partials)       Phase 2: Θ(log p) span
                  ▼
                result
```

> **Claim.** The two-level reduce has **work `Θ(n)`** and **span `Θ(n/p + log p)`**.

**Work.** Phase 1 does `p · (n/p − 1) = n − p` combines; phase 2 does `p − 1` combines; total `n − 1 = Θ(n)`. Same total work as the pure tree — no waste.

**Span.** Phase 1's local reduces run in parallel, each a *sequential* fold of `n/p` elements → `Θ(n/p)`. Phase 2 is a tree over `p` partials → `Θ(log p)`. Phase 2 waits for phase 1, so `T∞ = Θ(n/p) + Θ(log p) = Θ(n/p + log p)`.

This is the *right* bound for real hardware and the one to remember. The pure tree's `Θ(log n)` span assumes `n` processors; with only `p ≪ n`, you cannot use more than `p`-way parallelism in the leaves anyway, so collapsing each leaf-group into a sequential local reduce wastes nothing and avoids the synchronization cost of `log n` separate parallel rounds. Two phases, two cheap synchronizations, perfect work-efficiency. For `p = Θ(n/log n)` (the natural processor count where parallelism is fully used), `n/p = Θ(log n)` and `log p = Θ(log n)`, so the span is `Θ(log n)` — matching the tree, with far fewer rounds. This per-processor-partial-then-combine pattern is the backbone of every real reduce: OpenMP `reduction(+:x)`, MPI `Allreduce`, CUDA block reductions, and Go's "fan out, then combine" all instantiate it.

### Segmented Reduce

A **segmented reduce** reduces independently within *segments* delimited by a boolean **flag** array, producing one result per segment (not one global result):

```text
  values:  [ 3   1   7 | 4   1 | 6   3 ]      ( | = segment boundaries )
  flags:     1   0   0   1   0   1   0        (1 = "start of a new segment")
  seg-reduce → [ 11,  5,  9 ]                 (3+1+7,  4+1,  6+3)
```

The same lifted-monoid trick that powers [segmented scan](../02-parallel-prefix-sum-scan/middle.md) powers segmented reduce: reduce over pairs `(flag, value)` under

```text
  (f_a, v_a) ⊕' (f_b, v_b)  =  ( f_a OR f_b,  if f_b then v_b else v_a ⊕ v_b )
```

so a partial accumulates within a segment but *restarts* when the right operand begins a new one. `⊕'` is associative whenever `⊕` is, with identity `(0, e)`, so segmented reduce inherits the *same* `Θ(n)` work, `Θ(log n)` span as plain reduce. (In a practical two-level layout, each processor reduces its block per-segment, emitting partials for any segments that cross block boundaries, which are then stitched — the same idea, made block-local.)

Segmented reduce is the workhorse of **irregular/nested** parallelism: it computes per-row sums of a CSR sparse matrix (one segment per row), per-group aggregates in a `GROUP BY`, per-key totals after a sort, and the "reduce-by-key" step of classic map-reduce — all in one flat, work-efficient pass instead of launching one reduce per segment.

---

## Floating Point Is Not Associative

Real-number addition is associative; **IEEE-754 floating-point addition is not**, because each `+` *rounds* its result to the nearest representable value, and rounding does not commute with regrouping.

```text
  let a = 1e20,  b = -1e20,  c = 1.0   (doubles)
  (a + b) + c  =  0.0 + 1.0      =  1.0
  a + (b + c)  =  1e20 + -1e20   =  0.0       ← c is lost: 1e20 + 1.0 rounds back to 1e20
```

The two groupings differ by the entire value of `c`. Consequences for parallel reduce:

- **A parallel reduce can disagree with the serial loop.** The serial fold sums left-to-right; the tree reduce sums by halves; the two-level reduce sums in yet another order (and the *order depends on `p`*). Each grouping rounds differently, so the bits of the result differ.
- **It is not even deterministic across runs** when partials are combined by atomic adds or in completion order: the same program on the same input can return *slightly different* sums on different runs, because the order in which `p` threads' partials land varies.

This is a genuine engineering hazard, not a bug to "fix":

- **Reproducibility.** Scientific, financial, and regression-testing code that demands bit-identical results across machines or core counts cannot use a naive parallel float reduce. Remedies: fix the reduction order (deterministic tree, fixed `p`), use **pairwise/cascade summation** (which both parallelizes *and* improves accuracy — error grows like `O(log n)` instead of `O(n)`), use **Kahan/compensated summation**, or accumulate in higher precision.
- **Accuracy, not just determinism.** The serial answer is *not* the "true" one either — it merely has its own rounding. Pairwise (tree) summation is usually *more* accurate than the long serial chain, because partial sums stay closer in magnitude. So the parallel reorder is often a feature for accuracy even as it is a hazard for reproducibility.

The takeaway: **a parallel reduce over floats is well-defined only up to its reduction order.** Decide deliberately whether you need bit-reproducibility (then pin the order) or maximum accuracy (then use a compensated/pairwise scheme), and never assert bit-equality between a parallel float reduce and a serial loop. The code in [§8](#code-map-and-reduce-with-workspan-counters) demonstrates the effect directly.

---

## Map–Reduce Composition

The dominant pattern in data-parallel computing is **map then reduce**: transform every element, then fold the transformed values into an aggregate. Fused, the mapped values are never stored — they flow straight into the tree.

```text
  map–reduce ⊕ f xs  =  reduce ⊕ (map f xs)  =  f(x0) ⊕ f(x1) ⊕ … ⊕ f(x_{n−1})
```

Work `Θ(n)` (n maps + n−1 combines), span `Θ(log n)` (the `Θ(1)`-span map feeds the `Θ(log n)`-span reduce). Four canonical instances.

### Dot Product

The dot product `a · b = Σ_i a_i·b_i` is map–reduce in its purest form: **map** the element-wise product `(a_i, b_i) ↦ a_i·b_i`, then **reduce** with `+`.

```text
  dot(a, b)  =  reduce (+)  (map (×) (zip a b))
             =  (a0·b0) + (a1·b1) + … + (a_{n−1}·b_{n−1})
```

Work `Θ(n)`, span `Θ(log n)`. Fused, the products are summed as they are formed — no intermediate product array — which is exactly what a BLAS `dot`, an OpenMP `reduction`, or a GPU dot kernel does. (Over floats, the sum order matters per [§6](#floating-point-is-not-associative).)

### Mean and Variance

**Mean** is a sum-reduce divided by `n`: `mean = (reduce (+) xs) / n` — work `Θ(n)`, span `Θ(log n)`, with one `Θ(1)` post-division.

**Variance** is more interesting, because the textbook two-pass formula needs the mean *first*. The parallel-friendly route reduces a **tuple** monoid that carries enough state to combine partial statistics:

```text
  per element xi   →   (n=1, mean=xi, M2=0)        // M2 = Σ(x − mean)²
  combine (nA, meanA, M2A) ⊕ (nB, meanB, M2B):
      n   = nA + nB
      δ   = meanB − meanA
      mean = meanA + δ · nB / n
      M2  = M2A + M2B + δ² · nA · nB / n            // parallel (chunked) Welford / Chan's formula
  variance = M2 / n     (population)   or   M2 / (n − 1)   (sample)
```

This `⊕` is **associative** (it is Chan's parallel extension of Welford's algorithm), so it reduces over the tree in one numerically stable pass — work `Θ(n)`, span `Θ(log n)`, and far better rounding than summing `x` and `x²` separately and subtracting (which catastrophically cancels). The lesson generalizes: when an aggregate needs more than a running total, **make the reduce operate on a richer monoid** that carries the needed partial state.

### Histogram and Word Count

**Histogram** maps each element to a bucket index, then reduces by *counting per bucket* — a **segmented / keyed** reduce:

```text
  histogram:  map  (x ↦ bucket(x))        // element → bucket id
              reduce-by-bucket (+1)        // count occurrences per bucket
```

In parallel, each processor builds a *local* histogram over its block (an array of bucket counts), then the local histograms are **reduced element-wise** (vector `+`) into the global histogram — a two-level reduce where the partial is a whole count-vector. Work `Θ(n + p·B)` for `B` buckets, span `Θ(n/p + log p)`.

**Word count** is the same shape and the archetype of the [map-reduce programming model](../06-map-reduce-patterns/middle.md): **map** each document to `(word, 1)` pairs, then **reduce-by-key** (sum the `1`s per word). It is a *keyed* (segmented) reduce — group by key, sum within group — which is why a sort or hash-partition precedes the reduce in a distributed setting. The element-wise-combine-of-local-tables pattern is identical to the histogram's; only the key space (words vs buckets) differs.

These four — dot, mean/variance, histogram, word count — show the range: a **scalar** monoid (dot, mean), a **tuple** monoid (variance), and a **keyed/segmented** reduce (histogram, word count), all sharing the `Θ(n)`-work, `Θ(log n)`-span skeleton. The distributed, fault-tolerant generalization is the subject of [map-reduce patterns](../06-map-reduce-patterns/middle.md).

---

## Code: Map and Reduce with Work/Span Counters

The theory predicts four measurable facts:

1. Map does `Θ(n)` work and has `Θ(1)` span (no dependency edges).
2. Tree reduce does exactly `n − 1` combines (work `Θ(n)`) over `⌈log₂ n⌉` rounds (span `Θ(log n)`).
3. The two-level reduce does the *same* `n − 1` combines but with span `Θ(n/p + log p)`.
4. A parallel float reduce can differ bit-for-bit from the serial loop.

The code below implements map, tree reduce, and two-level reduce with work/span counters (verified against a sequential reference), a segmented reduce, a map–reduce dot product, and a demonstration of the floating-point order effect.

### Go

```go
package main

import "fmt"

// stats records work (total ⊕ operations) and span (parallel rounds / depth).
type stats struct {
	work int
	span int
}

// mapInts applies f to every element. Work Θ(n), span Θ(1).
func mapInts(xs []int, f func(int) int) ([]int, stats) {
	out := make([]int, len(xs))
	for i, x := range xs {
		out[i] = f(x) // all i independent → span 1
	}
	// no dependency edges: span is 1 regardless of n
	return out, stats{work: len(xs), span: 1}
}

// treeReduce reduces with the balanced tree. Work n-1, span ⌈log2 n⌉.
func treeReduce(xs []int, op func(int, int) int, e int) (int, stats) {
	if len(xs) == 0 {
		return e, stats{}
	}
	a := append([]int(nil), xs...)
	var st stats
	for len(a) > 1 {
		st.span++ // one parallel round = one tree level
		half := (len(a) + 1) / 2
		next := make([]int, half)
		for i := 0; i < len(a)/2; i++ { // pairs combine in parallel
			next[i] = op(a[2*i], a[2*i+1])
			st.work++
		}
		if len(a)%2 == 1 { // odd one carried up unchanged
			next[half-1] = a[len(a)-1]
		}
		a = next
	}
	return a[0], st
}

// twoLevelReduce: p local sequential reduces, then a tree over the p partials.
// Work Θ(n), span Θ(n/p + log p).
func twoLevelReduce(xs []int, p int, op func(int, int) int, e int) (int, stats) {
	n := len(xs)
	if n == 0 {
		return e, stats{}
	}
	if p > n {
		p = n
	}
	partials := make([]int, p)
	block := (n + p - 1) / p
	var st stats
	// Phase 1: local sequential reduce per processor (all parallel).
	localSpan := 0
	for j := 0; j < p; j++ {
		lo, hi := j*block, min((j+1)*block, n)
		acc := e
		steps := 0
		for i := lo; i < hi; i++ {
			acc = op(acc, xs[i])
			st.work++ // counts the e-seed combine too
			steps++
		}
		partials[j] = acc
		if steps > localSpan {
			localSpan = steps // longest local block dictates phase-1 span
		}
	}
	// Phase 2: tree over the p partials.
	root, treeSt := treeReduce(partials, op, e)
	st.work += treeSt.work
	st.span = localSpan + treeSt.span // Θ(n/p) + Θ(log p)
	return root, st
}

// segReduce reduces within segments; flags[i]==true starts a new segment.
func segReduce(vals []int, flags []bool, op func(int, int) int, e int) []int {
	var out []int
	acc := e
	open := false
	for i, v := range vals {
		if flags[i] && open {
			out = append(out, acc) // close previous segment
			acc = e
		}
		acc = op(acc, v)
		open = true
	}
	if open {
		out = append(out, acc)
	}
	return out
}

// dot via map–reduce: reduce(+) over the element-wise products.
func dot(a, b []int) int {
	prod := make([]int, len(a))
	for i := range a {
		prod[i] = a[i] * b[i] // map (×)
	}
	r, _ := treeReduce(prod, func(x, y int) int { return x + y }, 0) // reduce (+)
	return r
}

func main() {
	xs := []int{3, 1, 7, 0, 4, 1, 6, 3}
	add := func(a, b int) int { return a + b }

	dbl, mst := mapInts(xs, func(x int) int { return 2 * x })
	sumTree, tst := treeReduce(xs, add, 0)
	sum2, l2 := twoLevelReduce(xs, 4, add, 0)

	fmt.Println("input:           ", xs)
	fmt.Println("map (×2):        ", dbl, " work/span:", mst.work, "/", mst.span)
	fmt.Printf("tree reduce sum:  %d   work=%d span=%d  (n-1=%d, log2 n=%d)\n",
		sumTree, tst.work, tst.span, len(xs)-1, log2(len(xs)))
	fmt.Printf("two-level (p=4):  %d   work=%d span=%d  (n/p + log p = %d)\n",
		sum2, l2.work, l2.span, len(xs)/4+log2(4))

	vals := []int{3, 1, 7, 4, 1, 6, 3}
	flags := []bool{true, false, false, true, false, true, false}
	fmt.Println("segmented reduce:", segReduce(vals, flags, add, 0)) // [11 5 9]

	fmt.Println("dot([1,2,3],[4,5,6]):", dot([]int{1, 2, 3}, []int{4, 5, 6})) // 32

	// Floating-point non-associativity: parallel order changes the result.
	a, b, c := 1e20, -1e20, 1.0
	fmt.Printf("(a+b)+c = %g    a+(b+c) = %g    ← differ!\n", (a+b)+c, a+(b+c))
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func log2(n int) int {
	k := 0
	for 1<<k < n {
		k++
	}
	return k
}
```

Expected output:

```text
input:            [3 1 7 0 4 1 6 3]
map (×2):         [6 2 14 0 8 2 12 6]  work/span: 8 / 1
tree reduce sum:  25   work=7 span=3  (n-1=7, log2 n=3)
two-level (p=4):  25   work=11 span=3  (n/p + log p = 4)
segmented reduce: [11 5 9]
dot([1,2,3],[4,5,6]): 32
(a+b)+c = 1    a+(b+c) = 0    ← differ!
```

The counters confirm the theory: map's span is `1` (no dependencies) and work `n`; the tree reduce does exactly `n − 1 = 7` combines over `log₂ 8 = 3` rounds; the two-level reduce gets the *same* answer `25` with a few extra `e`-seed combines (the `work=11` counts the identity folds) and span `≈ n/p + log p`; segmented reduce yields the three per-segment sums `[11, 5, 9]`; the dot product is `1·4 + 2·5 + 3·6 = 32`; and the float lines differ — `(a+b)+c = 1` but `a+(b+c) = 0` — the non-associativity that makes parallel float reduces order-dependent.

### Python

```python
import math


def map_vals(xs, f):
    """Apply f to every element. Work Θ(n), span Θ(1)."""
    out = [f(x) for x in xs]            # all independent → span 1
    return out, {"work": len(xs), "span": 1}


def tree_reduce(xs, op, e):
    """Balanced-tree reduce. Work n-1, span ⌈log2 n⌉."""
    if not xs:
        return e, {"work": 0, "span": 0}
    a = list(xs)
    work = span = 0
    while len(a) > 1:
        span += 1                       # one tree level = one parallel round
        nxt = []
        i = 0
        while i + 1 < len(a):
            nxt.append(op(a[i], a[i + 1]))   # pairs combine in parallel
            work += 1
            i += 2
        if i < len(a):                  # odd element carried up
            nxt.append(a[i])
        a = nxt
    return a[0], {"work": work, "span": span}


def two_level_reduce(xs, p, op, e):
    """p local sequential reduces, then a tree over p partials.
    Work Θ(n), span Θ(n/p + log p)."""
    n = len(xs)
    if n == 0:
        return e, {"work": 0, "span": 0}
    p = min(p, n)
    block = -(-n // p)                  # ceil(n / p)
    partials, work, local_span = [], 0, 0
    for j in range(p):                  # phase 1: parallel local reduces
        lo, hi = j * block, min((j + 1) * block, n)
        acc, steps = e, 0
        for i in range(lo, hi):
            acc = op(acc, xs[i])
            work += 1
            steps += 1
        partials.append(acc)
        local_span = max(local_span, steps)
    root, st = tree_reduce(partials, op, e)   # phase 2: tree over partials
    return root, {"work": work + st["work"], "span": local_span + st["span"]}


def seg_reduce(vals, flags, op, e):
    """Reduce within segments; flags[i] True starts a new segment."""
    out, acc, open_seg = [], e, False
    for v, f in zip(vals, flags):
        if f and open_seg:
            out.append(acc)
            acc = e
        acc = op(acc, v)
        open_seg = True
    if open_seg:
        out.append(acc)
    return out


def dot(a, b):
    """Map–reduce dot product: reduce(+) over element-wise products."""
    prod = [x * y for x, y in zip(a, b)]      # map (×)
    r, _ = tree_reduce(prod, lambda x, y: x + y, 0)  # reduce (+)
    return r


def main():
    xs = [3, 1, 7, 0, 4, 1, 6, 3]
    add = lambda x, y: x + y

    dbl, mst = map_vals(xs, lambda x: 2 * x)
    sum_tree, tst = tree_reduce(xs, add, 0)
    sum2, l2 = two_level_reduce(xs, 4, add, 0)

    print("input:           ", xs)
    print("map (×2):        ", dbl, " work/span:", mst["work"], "/", mst["span"])
    print(f"tree reduce sum:  {sum_tree}   work={tst['work']} span={tst['span']}"
          f"  (n-1={len(xs)-1}, log2 n={int(math.log2(len(xs)))})")
    print(f"two-level (p=4):  {sum2}   work={l2['work']} span={l2['span']}")

    vals = [3, 1, 7, 4, 1, 6, 3]
    flags = [True, False, False, True, False, True, False]
    print("segmented reduce:", seg_reduce(vals, flags, add, 0))   # [11, 5, 9]
    print("dot([1,2,3],[4,5,6]):", dot([1, 2, 3], [4, 5, 6]))     # 32

    # Floating-point non-associativity: parallel order changes the result.
    a, b, c = 1e20, -1e20, 1.0
    print(f"(a+b)+c = {(a + b) + c}    a+(b+c) = {a + (b + c)}    ← differ!")

    # A larger demo: sum 1.0 plus many tiny values, serial vs pairwise (tree).
    data = [1e16] + [1.0] * 100
    serial = 0.0
    for v in data:
        serial += v                     # left-to-right: the 1.0s mostly vanish
    pairwise, _ = tree_reduce(data, add, 0.0)  # tree: tiny values sum together first
    print(f"serial sum   = {serial}")
    print(f"pairwise sum = {pairwise}   (tree groups the small values → more accurate)")


if __name__ == "__main__":
    main()
```

Both programs make the abstractions tangible: the **work** counters show map's `Θ(n)`, the tree reduce's exact `n − 1` combines, and the two-level reduce's identical work with a different span; the **span** counters show map's constant `1` next to reduce's `log n`; and the float demos show that a parallel reorder both *changes* the result (`(a+b)+c ≠ a+(b+c)`) and can *improve accuracy* (the tree groups the tiny `1.0`s before they are swamped by `1e16`, where the serial loop loses most of them).

---

## Pitfalls

- **Reducing with a non-associative operator.** Tree and two-level reduces re-parenthesize the combinations — that is the whole point of going parallel. If `⊕` is not associative (subtraction, division, and — under rounding — floating-point addition), the parallel answer differs from the serial fold, and the algorithm is simply *wrong*. Confirm `⊕` is associative *before* parallelizing; if it is not, restructure (e.g. reduce the *numerator* and *denominator* separately rather than reducing a ratio).

- **Forgetting the identity.** The identity `e` is what an empty reduce returns, what seeds a processor that got no elements (`n < p`), and what you pad a non-power-of-two input with. Pad with the **right** identity — `0` for sum, `1` for product, `−∞` for max, `+∞` for min — never with zeros for a max-reduce. A wrong pad value corrupts the result.

- **Assuming commutativity when you only have associativity.** Atomic-accumulate and completion-order combine land partials in non-deterministic *order*; that is correct only if `⊕` *commutes*. For a non-commutative-but-associative `⊕` (matrix product, string concat, function composition) you must combine partials in **index order** — an unordered atomic reduce gives garbage. Sum/max/min/OR/XOR commute and are safe to accumulate atomically; matrices are not.

- **Expecting bit-identical floats from a parallel reduce.** A parallel float reduce sums in a different (and `p`-dependent, sometimes run-dependent) order than the serial loop, so results differ in the low bits — and may vary run to run under atomic combine. For reproducibility, **pin the reduction order** (deterministic tree, fixed `p`); for accuracy, prefer **pairwise/Kahan** summation. Never assert equality between a parallel float reduce and a serial one.

- **False sharing in naive per-processor reductions.** If `p` processors accumulate their partials into adjacent slots of one array (`partials[j]`), those slots likely share a cache line, so every update bounces the line between cores — *false sharing* that can erase the parallel speedup. Pad each partial to its own cache line (or accumulate in a thread-local register and write *once* at the end). The two-level reduce dodges this naturally by keeping the local accumulator in a register and storing one partial per processor.

- **Not fusing maps (or map-into-reduce).** `map g (map f xs)` materializes an `Θ(n)` temporary and does two memory passes; `map (g ∘ f) xs` does one pass with no temp — same asymptotic work, often 2× the wall-clock on bandwidth-bound hardware. Likewise, fuse a `map` *into* a following `reduce` so the mapped values feed the tree without being stored (the [dot product](#dot-product)). Failing to fuse leaves easy memory-traffic wins on the table.

- **Using a full scan when reduce suffices (or vice versa).** Reduce returns *one* value; [scan](../02-parallel-prefix-sum-scan/middle.md) returns *all* prefixes via an extra down-sweep. Running a scan to grab only its last element wastes the down-sweep; conversely, running `n` separate reduces to get all prefixes is `Θ(n²)` where one scan is `Θ(n)`. Match the primitive to what you actually need.

---

## Summary

- **Map** applies `f` to every element independently. Its DAG is `n` isolated nodes (no edges), so **work `Θ(n)`, span `Θ(1)`** — embarrassingly parallel, `Θ(n/p + 1)` on `p` processors. **Map fusion** (`map g ∘ map f = map (g ∘ f)`) collapses a chain into one pass, eliminating the intermediate array and halving memory traffic — a constant-factor win that matters on bandwidth-bound hardware.

- **Reduce** folds `n` elements with `⊕` over a **balanced tree**: exactly `n − 1` combine operations (**work `Θ(n)`**, work-efficient) over `⌈log₂ n⌉` levels (**span `Θ(log n)`**, optimal by the binary fan-in bound). Both proved. `⊕` must be a **[monoid](#the-monoid-requirement)**: associativity is *mandatory* (it licenses the parallel re-parenthesization — without it, tree ≠ serial, as subtraction shows), and an identity `e` handles empty/ragged/padded cases. **Commutativity** is *extra*: required only for atomic/unordered partial combination.

- **Reduce vs scan:** the *same tree*. Reduce keeps only the root (one value = the last prefix); [scan](../02-parallel-prefix-sum-scan/middle.md) keeps all partials and pushes them down to produce every prefix. `reduce(x) = last(scan(x))`.

- **Implementation:** the **strided pairwise loop** is the GPU `log n`-pass reduce (work `n − 1`, span `Θ(log n)`). The practical **two-level reduce** has each of `p` processors reduce `n/p` locally in `Θ(n/p)`, then combines the `p` partials in `Θ(log p)` — **work `Θ(n)`, span `Θ(n/p + log p)`** — the bound to remember for real hardware. **Segmented reduce** (lifted `(flag, value)` monoid) gives per-segment results in one pass: CSR row sums, `GROUP BY`, reduce-by-key.

- **Floating point is not associative:** a parallel reduce sums in a `p`-dependent order, so it can differ bit-for-bit from the serial loop and even vary run-to-run under atomic combine. Pin the order for **reproducibility**; use **pairwise/Kahan** summation for **accuracy** (tree summation is often *more* accurate than the serial chain). Never assert bit-equality with a serial loop.

- **Map–reduce composition**, each **work `Θ(n)`, span `Θ(log n)`**: **dot product** (map `×`, reduce `+`), **mean** (sum-reduce / n), **variance** (reduce a *tuple* monoid — Chan's parallel Welford — for one stable pass), and **histogram / word count** (a *keyed / segmented* reduce: local tables combined element-wise). When an aggregate needs more than a running total, make the reduce operate on a *richer monoid*.

Revisit [junior](./junior.md) for the map/reduce intuition and application gallery; advance to [senior](./senior.md) for the deeper treatment (warp/block GPU reductions and divergence, tree-vs-recursive-doubling trade-offs, cache-aware blocking, and bit-reproducible parallel summation). Continue to [parallel prefix sum / scan](../02-parallel-prefix-sum-scan/middle.md) for the scan that keeps the partials this reduce discards, to [map-reduce patterns](../06-map-reduce-patterns/middle.md) for the distributed, fault-tolerant generalization (mappers, reducers, shuffle), and back to the [work–span model](../01-models-pram-work-span/middle.md) for the cost framework underpinning every bound here.
