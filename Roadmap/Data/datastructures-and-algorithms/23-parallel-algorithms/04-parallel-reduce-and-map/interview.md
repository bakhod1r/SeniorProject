# Parallel Reduce and Map — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [Reduce in Practice: Two-Level & Trees](#reduce-in-practice-two-level--trees)
3. [Generalizations: Semirings & All-Reduce](#generalizations-semirings--all-reduce)
4. [Gotcha / Trick Questions](#gotcha--trick-questions)
5. [Rapid-Fire Q&A](#rapid-fire-qa)
6. [Common Mistakes](#common-mistakes)
7. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: What are `map` and `reduce`, and what are their work/span? *(Easy)*

**Answer**: They are the two foundational data-parallel primitives.

- **`map(f, a)`** applies a pure function `f` independently to every element: `out[i] = f(a[i])`. Every output depends on exactly one input and nothing else, so all `n` calls run at once: **work `Θ(n)`, span `Θ(1)`** (assuming `f` is `O(1)`). This is the textbook **embarrassingly parallel** pattern.
- **`reduce(⊕, a)`** combines all elements into a single value `a₀ ⊕ a₁ ⊕ … ⊕ a_{n-1}` using an associative operator `⊕`. Done as a balanced tree: **work `Θ(n)`, span `Θ(log n)`**, parallelism `Θ(n/log n)`.

Together they are *the* MapReduce kernel: map transforms in parallel, reduce aggregates in a tree. See [../06-map-reduce-patterns/interview.md](../06-map-reduce-patterns/interview.md).

### Q2: Why is `map` "embarrassingly parallel" — span `Θ(1)`? *(Easy)*

**Answer**: Because the outputs are **mutually independent**. `out[i] = f(a[i])` reads only `a[i]` and writes only `out[i]`; there is **no dependency edge** between any two map tasks, so the DAG is `n` isolated nodes. The critical path is a single node — span `Θ(1)` — and with `n` processors the whole map finishes in one step. "Embarrassingly parallel" means there is no coordination to design: just hand each processor a slice. The only real-world limits are **memory bandwidth** and load imbalance if `f`'s cost varies — not any inherent dependency.

### Q3: How do you reduce in parallel, and why is the span `Θ(log n)`? *(Medium)*

**Answer**: Pair up adjacent elements and combine them, then recurse on the `n/2` partial results — a **balanced binary tree** of `⊕` operations:

```
a:    [3, 1, 7, 0, 4, 2, 6, 5]
      ⊕  ⊕  ⊕  ⊕         level 1 → [4, 7, 6, 11]
      ⊕     ⊕               level 2 → [11, 17]
      ⊕                      level 3 → [28]
```

Each level halves the number of live values, so there are `Θ(log n)` levels — the **span**. The levels do `n/2 + n/4 + … + 1 = n − 1` combines total, so **work `Θ(n)`** — work-efficient, matching the serial loop. The `Θ(log n)` span is also a **lower bound**: the single output depends on all `n` inputs, and constant-fan-in gates can gather `n` items only through a tree of depth `Ω(log n)`.

### Q4: Why must `⊕` be associative, and why do you also want an identity (a monoid)? *(Medium)*

**Answer**: The serial reduce computes `((…((a₀ ⊕ a₁) ⊕ a₂) … ) ⊕ a_{n-1})` — a strictly **left-leaning** parenthesization. The parallel tree computes a **balanced** parenthesization, e.g. `(a₀ ⊕ a₁) ⊕ (a₂ ⊕ a₃)`. For these to give the **same answer regardless of grouping**, `⊕` must be **associative** — that *is* the definition of associativity (re-parenthesization invariance). Without it, the tree returns a different (and schedule-dependent) result.

The **identity** element `e` (with `a ⊕ e = e ⊕ a = a`) makes `⊕` a **monoid** and is needed for the practical edge cases: reducing an **empty** range must return *something* (it returns `e`), and padding a non-power-of-two array or seeding an empty per-processor partial uses `e` harmlessly. Associative operator + identity = **monoid**, and "is this a monoid?" is the single question that decides whether a reduction is even well-defined.

---

## Reduce in Practice: Two-Level & Trees

### Q5: Reduce and scan share the same `(work, span)` — what's the difference? *(Medium)*

**Answer**: Both are `(Θ(n) work, Θ(log n) span)` over the **same balanced tree**. The difference is the output:

- **Reduce** returns **one** value — the grand total. It needs only the **up-sweep** (leaves → root).
- **Scan** returns **all `n` prefixes**. It needs the up-sweep **plus** a down-sweep to push partial totals back down to every position.

So scan ≈ "a reduce that remembers its partial sums and redistributes them." If you only need the total, never pay for the down-sweep. See [../02-parallel-prefix-sum-scan/interview.md](../02-parallel-prefix-sum-scan/interview.md).

### Q6: Describe the two-level reduce — the pattern real code actually uses. *(Hard)*

**Answer**: Pure `Θ(log n)`-depth tree reduce assumes `n` processors; real machines have `P ≪ n`. The practical pattern splits into **two levels**:

1. **Local phase** — partition the `n` elements into `P` contiguous chunks of `n/P`. Each processor reduces its chunk **serially** (often the fastest, most cache-friendly, vectorizable code). This costs span `Θ(n/P)`.
2. **Combine phase** — combine the `P` partial results with a **tree** reduce. This costs span `Θ(log P)`.

Total span `Θ(n/P + log P)`, work `Θ(n)`. This is exactly Brent's decomposition: `T_P ≈ T₁/P + T∞`. The serial inner loop dominates wall-clock; the `log P` tree is negligible. **Every production reduction** — OpenMP `reduction`, CUDA block-then-grid reduce, Spark's `reduce` — is this two-level shape: reduce locally, then combine across workers. See [../01-models-pram-work-span/interview.md](../01-models-pram-work-span/interview.md).

### Q7: Walk a small reduce and show how the tree shape is free to vary. *(Medium)*

**Answer**: Reduce `[8, 3, 5, 1]` with `+`. Two valid trees:

```
balanced:  (8+3) + (5+1) = 11 + 6  = 17
left-lean: ((8+3)+5)+1    = ((11)+5)+1 = 17
```

Both give `17` **because `+` on integers is associative** — every grouping collapses to the same value, so a scheduler may pick whichever tree balances load best. This freedom is the whole point: the runtime reorders the combine tree for performance, and associativity guarantees correctness is untouched. (Swap in floating-point `+` and the two trees can give *different* roundings — see Q11.)

---

## Generalizations: Semirings & All-Reduce

### Q8: How do semirings generalize map-reduce (e.g. for shortest paths)? *(Hard)*

**Answer**: A **semiring** is a set with two monoids: an additive `⊕` (the *reduce* operator) and a multiplicative `⊗` (the *map/combine* operator), where `⊗` distributes over `⊕`. Generalized matrix product becomes `C[i][j] = ⊕_k (A[i][k] ⊗ B[k][j])` — a **map** of `⊗` over pairs followed by a **reduce** with `⊕`.

Picking the semiring reprograms the same kernel:

- **`(+, ×)`** → ordinary linear-algebra matrix multiply.
- **`(min, +)`** (the **tropical** semiring) → the matrix "product" computes **shortest-path** combinations; repeated squaring of the adjacency matrix is all-pairs shortest paths.
- **`(OR, AND)`** → boolean reachability / transitive closure.

This is why graph engines (GraphBLAS) express BFS, shortest paths, and PageRank as semiring matrix–vector products: one parallel map-reduce skeleton, swap the `(⊕, ⊗)`. **Reduce-by-key** is the same idea grouped by key — map to `(key, value)` pairs, then reduce values per key with a monoid.

### Q9: What is all-reduce, and how do ring vs tree implementations differ? *(Hard)*

**Answer**: **All-reduce** combines a value from **every** processor with an associative `⊕` (e.g. sum) and delivers the **same result to all** of them — logically a reduce followed by a broadcast. Two classic schemes for `P` nodes each holding `N` bytes:

- **Tree all-reduce** — reduce up a tree to the root (`log P` steps), then broadcast down (`log P` steps): **`Θ(log P)` latency**, but the root is a bandwidth bottleneck and most links idle. **Latency-optimal** — best when `N` is small.
- **Ring all-reduce** — arrange nodes in a ring; do `P−1` reduce-scatter steps then `P−1` all-gather steps, each node always sending/receiving a `1/P` slice. Total data moved per node is `≈ 2N(P−1)/P ≈ 2N`, **independent of `P`** and saturating every link → **bandwidth-optimal**. Latency is `Θ(P)` steps, so it wins for **large `N`**.

**Why it matters**: data-parallel ML training averages gradients across all GPUs every step — a sum-all-reduce over huge tensors. Ring all-reduce (NCCL, Horovod) is the default precisely because gradients are large, so bandwidth, not latency, dominates. Real libraries use hybrids (ring within a node, tree across nodes).

---

## Gotcha / Trick Questions

### Q10: "Commutativity or associativity — which does parallel reduce actually need?" *(Medium)*

**Answer**: **Associativity is required; commutativity is only a bonus.** The tree re-parenthesizes but, in an ordered reduce, never swaps operand order — so a balanced tree gives the serial answer whenever `⊕` is associative, even if non-commutative (matrix multiply, string concatenation, function composition all reduce fine). Commutativity becomes useful only when the schedule **also reorders** elements — e.g. combining partials as they arrive out of order, or using an **atomic** accumulator where threads add in nondeterministic order. There you need *both*. The crisp rule: **ordered reduce needs associativity; unordered/atomic reduce needs associativity + commutativity.** Candidates who answer "commutativity" have it backwards.

### Q11: "Is a parallel sum of floats deterministic — same result every run?" *(Hard)*

**Answer**: **No.** Floating-point `+` is **not associative** (`(a+b)+c ≠ a+(b+c)` because each add rounds), yet parallel reduce re-associates the sum into a tree whose **shape depends on `P`, block size, and scheduling**. Different groupings round differently, so a parallel float sum can differ from the serial sum **and vary run-to-run** if the tree changes.

Fixes when you need reproducibility: **pin a fixed reduction-tree shape** (deterministic order independent of thread count — what reproducible-BLAS and deterministic ML modes do); use **compensated (Kahan) summation** or a **higher-precision accumulator** to bound the error; or pre-sort by magnitude. With **integers**, `+` *is* associative, so integer reduce is fully deterministic. This is the classic "my GPU sum doesn't match the CPU" bug — it's non-associativity, not a coding error.

### Q12: "Map has span 1, so it's always the cheap part — right?" *(Medium)*

**Answer**: **Span `Θ(1)` does not mean free.** Map does `Θ(n)` *work*, and on bounded `P` the work law floors its time at `Θ(n/P)`. In practice map is usually **memory-bandwidth-bound**: you stream `n` elements through the cores, and once the bus saturates, adding processors stops helping (see [../01-models-pram-work-span/interview.md](../01-models-pram-work-span/interview.md)). Map also suffers **load imbalance** when `f`'s cost varies per element — a fixed equal partition leaves some workers idle, which is why irregular maps use dynamic/guided scheduling. So map is *dependency-free*, not *cost-free*; its span is trivial, its work and bandwidth are not.

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | `map` work & span? | `Θ(n)` work, `Θ(1)` span (embarrassingly parallel) |
| 2 | `reduce` work & span? | `Θ(n)` work, `Θ(log n)` span |
| 3 | Why map span `Θ(1)`? | Outputs independent — no dependency edges |
| 4 | Required property of `⊕`? | **Associative** (re-parenthesization invariance) |
| 5 | Why need an identity? | Empty ranges, padding, empty partials → a **monoid** |
| 6 | Reduce span lower bound? | `Ω(log n)` — bounded fan-in over `n` inputs |
| 7 | Reduce vs scan? | One total vs all `n` prefixes; reduce = up-sweep only |
| 8 | Two-level reduce span? | `Θ(n/P + log P)` (local serial + tree combine) |
| 9 | Parallelism of reduce? | `Θ(n / log n)` |
| 10 | Tropical semiring `(min,+)`? | Shortest-path matrix products |
| 11 | Reduce-by-key? | Group by key, reduce values per key with a monoid |
| 12 | All-reduce = ? | Reduce to all — combine + broadcast to every node |
| 13 | Ring all-reduce optimizes? | **Bandwidth** (`≈2N`/node, `Θ(P)` latency) |
| 14 | Tree all-reduce optimizes? | **Latency** (`Θ(log P)` steps) |
| 15 | All-reduce in ML training? | Averaging gradients across GPUs each step |
| 16 | Ordered reduce needs? | Associativity only |
| 17 | Unordered/atomic reduce needs? | Associativity **+** commutativity |
| 18 | Parallel float sum deterministic? | **No** — `+` non-associative in FP |

---

## Common Mistakes

1. **Answering "commutativity" for what reduce needs.** It needs **associativity**; commutativity is a bonus for unordered/atomic combining only.
2. **Forgetting the identity.** Empty ranges, non-power-of-two padding, and empty per-processor partials all need a well-defined `e` — that's why it must be a **monoid**, not just an associative operator.
3. **Treating `map` as cost-free.** Span `Θ(1)`, yes — but `Θ(n)` work, usually bandwidth-bound, and prone to load imbalance with variable-cost `f`.
4. **Skipping the two-level pattern.** Real reduces are local-serial + tree-combine (`Θ(n/P + log P)`), not a pure `log n` tree assuming `n` processors.
5. **Expecting bit-identical parallel float sums.** Re-association + non-associative rounding → nondeterminism; pin the tree or use Kahan. Integers are exact.
6. **Confusing reduce with scan.** Reduce is the up-sweep only (one value); scan adds a down-sweep (all prefixes).
7. **Defaulting to tree all-reduce for large tensors.** For big gradients, **ring** all-reduce is bandwidth-optimal; tree wins only for small messages.

---

## Tips & Summary

- **Open with the pair**: "`map` is embarrassingly parallel — `Θ(n)` work, `Θ(1)` span; `reduce` combines via an associative tree — `Θ(n)` work, `Θ(log n)` span." Two sentences that frame everything.
- **Make the monoid explicit**: associativity lets the tree re-parenthesize; the identity covers empty/padded cases. "Is this a monoid?" decides whether the reduction is even well-defined.
- **Lead with the two-level pattern** for any "how would you implement it" question: reduce locally per worker (`Θ(n/P)`), combine across workers with a tree (`Θ(log P)`). That's what every real runtime does.
- **Have the generalizations ready**: semirings (`(min,+)` → shortest paths, GraphBLAS), reduce-by-key, and all-reduce. They show you see map-reduce as a *skeleton*, not one function.
- **Nail the all-reduce trade-off**: ring = bandwidth-optimal (`≈2N`/node), tree = latency-optimal (`Θ(log P)`); ML gradient averaging uses ring because tensors are large.
- **Name the FP gotcha and the commutativity trap**: parallel float sum is **nondeterministic** (non-associative rounding); ordered reduce needs **associativity**, not commutativity. These two separate senior candidates from juniors.

**Related:** [Models, PRAM & Work–Span — Interview](../01-models-pram-work-span/interview.md) · [Parallel Prefix-Sum / Scan — Interview](../02-parallel-prefix-sum-scan/interview.md) · [Map-Reduce Patterns — Interview](../06-map-reduce-patterns/interview.md) · [Parallel Reduce and Map — Middle](./middle.md)
