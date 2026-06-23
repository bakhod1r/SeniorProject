# Parallel Prefix Sum (Scan) — Senior Level

## Prerequisites

- [Middle Level](./middle.md) — the two algorithms (Hillis–Steele's `O(n log n)`-work / `O(log n)`-span step-doubling, Blelloch's work-efficient up-sweep/down-sweep), inclusive vs exclusive scan, the standard applications (stream compaction, radix sort), and the `Ω(log n)` span floor
- [Models of Parallel Computation: PRAM and Work–Span — Senior](../01-models-pram-work-span/senior.md) — `T₁`/`T∞`, Brent's theorem, the class `NC` (scan is in `NC¹`), and the Cook–Dwork–Reischuk `Ω(log n)` EREW lower bound that scan's last output saturates
- [Parallel Sorting and Merging — Senior](../03-parallel-sorting-and-merging/senior.md) — radix sort and partition built on scan, the consumer of every primitive below

## Table of Contents

1. [What Senior-Level Scan Theory Is About](#what-senior-level-scan-theory-is-about)
2. [Scan as a Fundamental Primitive: Blelloch's Scan-Vector Model](#scan-as-a-fundamental-primitive-blellochs-scan-vector-model)
3. [The Carry-Lookahead Connection: Scan Is Binary Addition](#the-carry-lookahead-connection-scan-is-binary-addition)
4. [Parallel-Prefix Networks: Kogge–Stone vs Brent–Kung vs Sklansky vs Ladner–Fischer](#parallel-prefix-networks-koggestone-vs-brentkung-vs-sklansky-vs-ladnerfischer)
5. [Segmented Scan: The Regroup-by-Segment Pattern](#segmented-scan-the-regroup-by-segment-pattern)
6. [Recurrences as Scans: Parallelizing the "Sequential-Looking" Loop](#recurrences-as-scans-parallelizing-the-sequential-looking-loop)
7. [Blocked Multi-Level Scan for Real Hardware](#blocked-multi-level-scan-for-real-hardware)
8. [GPU Scan Engineering: A Sketch](#gpu-scan-engineering-a-sketch)
9. [Worked Piece: The Affine-Recurrence-as-Scan Derivation](#worked-piece-the-affine-recurrence-as-scan-derivation)
10. [Decision Framework](#decision-framework)
11. [Research Pointers](#research-pointers)
12. [Key Takeaways](#key-takeaways)

---

## What Senior-Level Scan Theory Is About

The middle level establishes scan as an *algorithm*: given `x₀, …, x_{n-1}` and an associative `⊕`, compute every prefix `yᵢ = x₀ ⊕ ⋯ ⊕ xᵢ`. It shows two ways to do it — Hillis–Steele (1986), which doubles the stride each round at `O(n log n)` work and `O(log n)` span, and Blelloch (1990), which sweeps a balanced tree up then down at `O(n)` work and `O(log n)` span — and lists the applications (compaction, radix-sort digit counting, line-of-sight). That is the "here is the primitive and here is how to compute it" level.

Senior-level scan theory makes a stronger claim: **scan is not one algorithm among many; it is a unit-cost primitive around which an entire class of algorithms is designed, and it is *the same object* that hardware designers have spent fifty years optimizing as the carry chain of a binary adder.** Five threads run through this view:

1. **Scan is a primitive of algorithm design, not just a subroutine.** Blelloch's scan-vector model treats `scan` (and `reduce`, `permute`) as `O(1)`-depth building blocks and asks what you can express in `O(log n)` total span by *composing* them. Surprisingly much: quicksort, sparse matrix–vector multiply, graph contraction, regular-expression matching, and lexical analysis all reduce to a constant number of scans. The senior reflex is to *recognize the scan* hiding inside a problem, the way a sequential programmer recognizes a hash table.
2. **Scan is binary addition.** Propagating a carry through an `n`-bit adder is *exactly* a scan over the (generate, propagate) monoid. Every parallel-prefix adder network in every modern CPU — Kogge–Stone, Brent–Kung, Sklansky, Ladner–Fischer — is a hardware realization of a scan algorithm, and the depth/size/fan-out tradeoffs the chip designers agonize over are the *same* work/span/contention tradeoffs the software scan exposes. This is one theory, told in two vocabularies.
3. **Segmented scan generalizes scan to ragged data.** Carrying a "segment-boundary" flag alongside each element lets a *single* scan operate independently on many variable-length segments at once. This "regroup by segment" pattern is what turns quicksort partition, CSR sparse matrix–vector multiply, and many graph primitives into flat, branch-free, perfectly-load-balanced scans.
4. **Any first-order linear recurrence is a scan.** A loop that *looks* hopelessly sequential — `xᵢ = aᵢ·x_{i−1} + bᵢ` — is a scan over the affine-composition monoid, hence parallelizable in `O(log n)` span. This is the single most useful "trick" in the toolbox: it dissolves the apparent data dependency that makes recurrences look serial, and it generalizes (via companion matrices) to higher-order recurrences.
5. **Real hardware forces a blocked, multi-level scan.** The flat PRAM algorithm assumes `n` processors and free communication. On a GPU you have thousands of cores arranged in a memory hierarchy, so the production recipe is *scan blocks → scan the block sums → add the per-block offset back* — a three-level decomposition that is a direct application of Brent's principle.

The unifying senior stance: **scan is the cheapest non-trivial dependency the parallel model allows, and almost every "this can't be parallelized" loop is a scan over the right monoid.** The work below develops each thread and ties it back to the `NC¹`/work–span theory of [`../01-models-pram-work-span/senior.md`](../01-models-pram-work-span/senior.md).

---

## Scan as a Fundamental Primitive: Blelloch's Scan-Vector Model

The deepest reframing in Guy Blelloch's 1990 monograph *Vector Models for Data-Parallel Computing* is to elevate `scan` from a procedure to an **assumed unit-cost primitive**, on the same footing as elementwise vector operations. You then design and analyze algorithms in a model where:

- elementwise vector ops (`+`, `×`, comparisons) cost `O(1)` depth,
- `reduce` (combine all `n` with `⊕`) costs `O(1)` depth,
- `scan` (all prefixes under `⊕`) costs `O(1)` depth,
- `permute` / gather / scatter costs `O(1)` depth,

each charging `O(n)` *work*. The justification is exactly the `NC¹` result from the prerequisites: scan has `O(log n)` true span, so treating it as unit-depth inflates the depth measure by at most a `log` factor, which the model accepts as the price of a clean abstraction. The payoff is that **algorithm depth becomes "how many scans deep is the dependency chain?"** — a much coarser, more tractable question than tracking individual operations.

> **Why this is legitimate.** Charging scan `O(1)` depth is not cheating because scan is genuinely in `NC¹` (Ladner–Fischer / Brent–Kung give `O(log n)` depth, `O(n)` size; see the prerequisites). A scan-vector algorithm with `d` "scan-steps" of depth and `W` total work translates to a real PRAM algorithm of span `O(d · log n)` and work `O(W)`. So `O(1)`-scan-depth `⟹` `O(log n)` real span; `O(log n)`-scan-depth `⟹` `O(log² n)` real span. The abstraction tracks `NC` membership faithfully, losing at most a log per level.

### What composes out of a constant number of scans

The striking content of the model is *how much* lives at `O(1)` scan-depth — i.e., is computable with a constant number of scans plus elementwise work, hence `O(log n)` span and `O(n)` (or `O(n log n)`) work:

- **Stream compaction / filter.** Flags → exclusive scan gives target indices → scatter. One scan. (The middle-level workhorse.)
- **Quicksort partition.** Two segmented scans split a segment around its pivot (developed below).
- **Sparse matrix–vector multiply (CSR).** One segmented scan over the products, segmented by row (developed below).
- **Line-of-sight / running max, polynomial evaluation, sequence of bank balances.** Direct scans over `max`, Horner, or affine monoids.
- **Lexical analysis and regular-expression matching.** A DFA run over a string is a scan over the *transition-function-composition* monoid — each character is a function `state → state`, and function composition is associative, so the whole run is one scan (this is the recurrence pattern of §6 in disguise).
- **Radix sort.** A constant number of scans per digit (counting + scatter), the basis of the fastest GPU sorts; see [`../03-parallel-sorting-and-merging/senior.md`](../03-parallel-sorting-and-merging/senior.md).

The senior skill the model trains is **decomposition into scans**: when you meet a problem, ask "what monoid makes this a scan, and how many scans deep is the answer?" If the answer is a constant, the problem is in `NC¹`-ish territory and parallelizes beautifully. This is the constructive counterpart to the `NC`/`P`-completeness *classification* of the models file — scan-composition is the main tool for *placing* a problem in `NC`.

### Why scan, specifically, is the right primitive

One might ask why `scan` rather than just `reduce` is elevated to primitive status. The answer is that `reduce` collapses `n` values to one — it *destroys* per-position information — whereas `scan` preserves a result *at every position*, which is exactly what downstream gather/scatter steps need. Compaction needs the target *index* of each kept element (a scan), not merely the *count* of kept elements (a reduce). Radix sort needs the *rank* of each key within its bucket (a scan), not the bucket sizes alone. The general pattern is **scan-then-scatter**: a scan computes, in parallel, *where each element must go*, and a scatter moves it there in one step. Reduce cannot drive a scatter because it has thrown away the per-element offsets. This is the structural reason scan — not reduce — is the load-bearing primitive of data-parallel algorithm design: it is the cheapest operation that produces a *parallel address-computation* for an irregular data movement.

---

## The Carry-Lookahead Connection: Scan Is Binary Addition

The connection that turns "scan is a useful trick" into "scan is fundamental" is this: **adding two `n`-bit integers is a scan over the carry.** Hardware designers discovered the work-efficient and the low-depth scan networks *decades before* the parallel-algorithms community formalized them, because the carry chain is the latency-critical path of every arithmetic unit.

### Addition as a carry recurrence

Adding `A = a_{n-1}…a₀` and `B = b_{n-1}…b₀` produces sum bits `sᵢ = aᵢ ⊕ bᵢ ⊕ cᵢ` where `cᵢ` is the carry *into* position `i`. The carries obey the recurrence

```text
   c₀ = 0,
   c_{i+1} = (aᵢ ∧ bᵢ)  ∨  ((aᵢ ⊕ bᵢ) ∧ cᵢ).
```

Read literally this is sequential — `c_{i+1}` needs `cᵢ` — and ripple-carry addition is exactly that `O(n)`-depth loop. The parallelization comes from naming two per-position signals:

- **generate** `gᵢ = aᵢ ∧ bᵢ` — position `i` *makes* a carry no matter what arrives;
- **propagate** `pᵢ = aᵢ ⊕ bᵢ` — position `i` *passes through* whatever carry arrives.

Then `c_{i+1} = gᵢ ∨ (pᵢ ∧ cᵢ)`, which is the affine/Horner recurrence of §6 over Booleans.

### The carry monoid

Define the combine on (generate, propagate) pairs for a *block* of bit positions:

```text
   (g_L, p_L) • (g_H, p_H)  =  ( g_H ∨ (p_H ∧ g_L),   p_H ∧ p_L ).
```

Reading: a block formed by putting block `H` *above* block `L` generates a carry if `H` generates one, or if `H` propagates and `L` generates; it propagates only if *both* propagate. This operator is **associative** (a short Boolean check), and it has identity `(0, 1)` ("generates nothing, propagates everything"). So `(G, P)` over a range is a *monoid*, and the prefix `(G, P)` values — the carry-out of every prefix of bit positions — are exactly the **scan** of the per-bit `(gᵢ, pᵢ)` under `•`. The carry into position `i` is the generate-component of the prefix scan up to `i−1`.

> **The headline.** Binary addition = compute `(gᵢ, pᵢ)` elementwise (`O(1)` depth) → **scan** them under the carry monoid `•` (`O(log n)` depth) → compute `sᵢ = pᵢ ⊕ cᵢ` elementwise (`O(1)` depth). The entire latency of an adder is the *depth of the scan*. This is why a `64`-bit add is not `64` gate-delays but `O(log 64) = 6`-ish: the carry is computed by a parallel-prefix network, not rippled.

Every fast adder in every CPU is therefore a *hardware scan circuit*, and the named adder families below are *named scan networks*. The software scan and the hardware adder are the same `NC¹` object — the prefix computation over an associative operator — and the entire design-tradeoff literature of one field transfers verbatim to the other.

> **A note on why the monoid is exactly this.** The carry monoid is the *unique* associative summary of a block of bit positions sufficient to compute carries: to know a block's effect on an incoming carry you need only two bits — does it generate a carry on its own (`G`), and would it pass an incoming carry through (`P`)? Nothing finer is required, and nothing coarser suffices. This is the general shape of *every* recurrence-as-scan reduction (§6): the monoid element is the smallest associative summary of a contiguous run that lets you resume the recurrence from either side. For the affine recurrence it is the pair `(a, b)`; for the DFA it is the transition function; for the carry it is `(G, P)`. Finding that minimal summary *is* the act of parallelizing the loop.

---

## Parallel-Prefix Networks: Kogge–Stone vs Brent–Kung vs Sklansky vs Ladner–Fischer

A parallel-prefix network is a fixed circuit (DAG of `•`-operators) that computes all `n` prefixes. Four classical topologies span the design space, and each corresponds to a software scan strategy. The metrics that matter in hardware are **depth** (logic levels = latency = span), **size** (number of `•` operators = work = area/power), and **fan-out** (how many places a single node's output must drive = wire load = the hidden third cost the PRAM ignores).

### Kogge–Stone (1973) — the Hillis–Steele network

Kogge–Stone is the *step-doubling* network: at level `t` (for `t = 0, 1, …, log n − 1`) every position `i` combines with position `i − 2ᵗ`. It is **identical to the Hillis–Steele software scan**.

```text
   depth  = log₂ n        (minimum possible)
   size   = n log₂ n − (n − 1)  =  Θ(n log n)   operators
   fan-out = 2            (bounded, constant)
```

It hits the *minimum* depth `log n` and keeps fan-out constant — every node drives at most two successors — which makes it the lowest-latency, most wire-regular adder. The price is `Θ(n log n)` operators: it is **not work-efficient**. In a chip that means large area and high switching power; in software it means `Θ(n log n)` total work, a `log n` factor over the sequential `O(n)`. Kogge–Stone is the high-performance, area-hungry choice — the network you reach for when latency dominates and transistors are cheap.

### Brent–Kung (1982) — the Blelloch network

Brent–Kung is the *tree* network: an up-sweep (reduce) builds partial combines on the way up, then a down-sweep distributes them. It is **identical to Blelloch's work-efficient up-sweep/down-sweep scan**.

```text
   depth  = 2 log₂ n − 1   (twice Kogge–Stone, minus one)
   size   = 2n − 2 − log₂ n =  Θ(n)   operators   (work-efficient!)
   fan-out = O(1)          (bounded)
```

Brent–Kung trades depth for size: it uses only `Θ(n)` operators — a constant factor over the sequential lower bound, so **work-efficient** — at the cost of roughly *double* the depth of Kogge–Stone (the up-sweep *and* the down-sweep each cost `log n`). In hardware this is the small-area, low-power adder; in software it is Blelloch's `O(n)`-work scan, the right default whenever total work (energy, memory bandwidth) is the binding constraint rather than raw latency.

### Sklansky (1960) — minimum-depth, high fan-out

Sklansky (conditional-sum) also achieves the minimum depth `log n` with **work `Θ(n log n)`-ish** but via a divide-and-conquer recursion that produces *unbounded fan-out*: a single node at the top of the recursion must drive `Θ(n)` successors. That high fan-out is invisible in the PRAM (which charges nothing for a value being read by many processors — a CREW assumption) but is *real* and *costly* in silicon, where driving `n` loads needs buffer trees that add back the very depth Sklansky saved. Sklansky is the cautionary tale: **minimum logical depth is not minimum latency once fan-out is priced.**

### Ladner–Fischer (1980) — the parameterized family

Ladner and Fischer's 1980 paper *"Parallel Prefix Computation"* is the theoretical capstone: it gives a *parameterized* construction `LF(n, k)` that **continuously trades depth against size**, proving you can get depth `log n + k` with size bounded by roughly `(1 + 1/2^k)·2n`. Setting `k = 0` recovers a minimum-depth network; growing `k` walks toward the work-efficient end. Critically, Ladner–Fischer proved the family is *optimal* in the depth–size tradeoff for the prefix problem — you cannot have both minimum depth *and* `O(n)` size simultaneously; the product is bounded below. This is the prefix-network analogue of the Brodal–Fagerberg curve in external memory: a provably-optimal continuous frontier, with the named networks sitting at its endpoints and interior points.

### The comparison table

| Network | = Software scan | Depth (span) | Size (work) | Fan-out | When to use |
|---|---|---|---|---|---|
| **Kogge–Stone (1973)** | Hillis–Steele | `log n` (min) | `Θ(n log n)` | `2` (bounded) | latency-critical, area/work cheap |
| **Sklansky (1960)** | recursive doubling | `log n` (min) | `Θ(n log n)` | `O(n)` (unbounded) | min logical depth — *but watch fan-out* |
| **Brent–Kung (1982)** | Blelloch up/down-sweep | `2 log n − 1` | `Θ(n)` (efficient) | `O(1)` (bounded) | work/energy-critical, latency slack |
| **Ladner–Fischer (1980)** | parameterized scan | `log n + k` | `≈ (1+2^{−k})·2n` | bounded | tune the depth–size point you need |

The senior lesson mirrors the models file exactly: **Kogge–Stone/Hillis–Steele is low-span but work-inflated; Brent–Kung/Blelloch is work-efficient but higher-span.** On a real machine, work-efficiency usually wins (memory bandwidth and energy are scarcer than latency), which is why production GPU scans are built on the Brent–Kung skeleton — *but* the hybrid networks (Han–Carlson interleaves Brent–Kung and Kogge–Stone) exist precisely because the right answer is often a point *between* the endpoints, exactly as Ladner–Fischer predicts.

> **The fan-out cost the PRAM cannot see.** The single most important senior insight from the hardware view is that *fan-out is a real cost the work–span model omits.* The PRAM (in its CREW form) lets any value be read by arbitrarily many processors at unit cost — so Sklansky's `O(n)`-fan-out node looks free in software analysis. In silicon, a node driving `n` loads has capacitance proportional to `n`, so its real delay grows with fan-out, and the buffer tree you insert to fix it adds back `Θ(log n)` of the depth Sklansky "saved." This is why the *PRAM-optimal* (minimum-span) network is *not* the hardware-optimal one: Kogge–Stone and Brent–Kung win in practice precisely because they keep fan-out bounded. The same caution applies to software on real memory systems — a value broadcast to thousands of cores is a bandwidth event, not a free read — which is why the blocked scan of §7 broadcasts each block offset to only the threads of one block, never globally.

---

## Segmented Scan: The Regroup-by-Segment Pattern

A *segmented* scan computes independent scans over many contiguous segments of one flat array in a single pass. You carry, alongside each value, a **head flag** marking the first element of each segment; the scan resets the running accumulator at every flagged position. The magic is that this is *still one scan over one (bigger) monoid* — no branching, no load imbalance, no per-segment kernel launch.

### The segmented monoid

Pair each value with its flag and combine pairs by:

```text
   (v_L, f_L) ⊕_seg (v_H, f_H)  =  ( f_H ? v_H : (v_L ⊕ v_H),   f_L ∨ f_H ).
```

Reading: if the right operand starts a new segment (`f_H` set), discard the left accumulator and keep `v_H`; otherwise combine normally. The flag component ORs so that a combined block "remembers" it contains a boundary. This operator is **associative** (the standard check), so segmented scan is an *ordinary* scan over `⊕_seg` — and therefore inherits *everything*: `NC¹` membership, `O(log n)` span, the Brent–Kung/Kogge–Stone networks, the blocked multi-level decomposition. Segmentation is "free" in the sense that it changes only the monoid, not the machinery.

This is the load-balancing breakthrough. A naïve "one thread per segment" approach is catastrophic when segment lengths vary by orders of magnitude (one giant row in a sparse matrix starves all the others). Segmented scan flattens *all* segments into one array and lets the scan network balance the work perfectly regardless of the segment-length distribution — the irregularity is absorbed into a flag bit.

> **Why associativity survives.** It is worth seeing *why* `⊕_seg` stays associative despite the conditional. The flag component is an OR-scan (trivially associative), and the value component is a *guarded* combine that "forgets" its left argument exactly at a boundary. Checking `((u,e) ⊕_seg (v,f)) ⊕_seg (w,g) = (u,e) ⊕_seg ((v,f) ⊕_seg (w,g))` is a four-case split on `(f, g)`; in every case the result's value is `w` if `g` is set, else `v ⊕ w` if `f` is set, else `u ⊕ v ⊕ w`, and the flag is `e ∨ f ∨ g` — independent of association order. The lesson generalizes: to *segment* any scan, wrap its monoid in this flag-guarded shell and associativity is preserved automatically. You never re-derive the scan machinery; you only swap the monoid.

### Application 1 — Quicksort partition

Partition a segment around a pivot: compute flags `is_less = (xᵢ < pivot)`. A segmented exclusive scan of `is_less` (segmented so each recursive sublist is independent) yields, for each "less" element, its destination index within the left part; symmetrically for the "greater" part. One pass partitions *every* sublist at the current recursion level simultaneously. Quicksort becomes `O(log n)` levels of *segmented* scans rather than a tree of independent recursive calls — turning recursion depth into the dependency chain and exposing all sublists' work to the scan at once. This is Blelloch's data-parallel quicksort.

### Application 2 — Sparse matrix–vector multiply (CSR via segmented scan)

A sparse matrix in CSR (compressed sparse row) stores nonzeros row by row in a flat `values[]` array, with `row_ptr[]` marking where each row begins. To compute `y = M·x`:

```text
   1. products[k] = values[k] * x[ col_idx[k] ]      # elementwise, O(1) depth
   2. flags[k] = 1 at each row start (from row_ptr)   # head flags
   3. seg_sum = SEGMENTED-INCLUSIVE-SCAN(products, flags, +)
   4. y[r] = seg_sum at the LAST element of row r      # the per-segment total
```

The segmented `+`-scan sums each row's products **independently in one flat pass**, with perfect load balance even when row lengths range from `1` to `10⁶`. This is the canonical irregular-to-regular transformation: a ragged, branch-heavy nested loop (`for each row: for each nonzero`) becomes one flat scan plus elementwise work. It is the basis of the fastest GPU SpMV kernels precisely because it never branches on row length and never leaves a thread idle.

### Application 3 — Graph and tree primitives

The same pattern drives parallel graph contraction, list ranking (a list is a degenerate recurrence — see §6), Euler-tour-tree computations (subtree sizes, depths via segmented scans over the tour), and connected-components label propagation. The recurring move is identical: **express the irregular structure as segments of a flat array, attach head flags, and let one segmented scan do the per-segment reduction.** Whenever you catch yourself writing "for each group, independently reduce the group," reach for segmented scan.

---

## Recurrences as Scans: Parallelizing the "Sequential-Looking" Loop

The most practically transformative result in this file: **a loop with a carried dependency is usually a scan over a cleverly chosen monoid, and is therefore parallelizable in `O(log n)` span** — even though it *looks* irreducibly serial because each iteration reads the previous one's output.

### First-order linear recurrences

Consider any first-order linear recurrence

```text
   xᵢ = aᵢ · x_{i−1} + bᵢ,        x_{−1} given (often 0).
```

Each step applies the **affine map** `fᵢ(t) = aᵢ·t + bᵢ`. The key fact: *composition of affine maps is affine, and affine maps form a monoid under composition.* Composing `f(t)=a·t+b` after `g(t)=a'·t+b'`:

```text
   (f ∘ g)(t)  =  a·(a'·t + b') + b  =  (a·a')·t + (a·b' + b).
```

So an affine map is represented by its coefficient pair `(a, b)`, and the composition operator is

```text
   (a, b) ⊙ (a', b')  =  ( a·a',   a·b' + b ).
```

This `⊙` is **associative** (composition always is) with identity `(1, 0)` (the identity map). Therefore the running composition `f_i ∘ f_{i−1} ∘ ⋯ ∘ f_0` is a **scan** of the `(aᵢ, bᵢ)` pairs under `⊙`, and applying each prefix-composed map to the initial `x_{−1}` yields every `xᵢ`. The "sequential" recurrence is an `O(log n)`-span scan over the affine monoid. The full derivation is in §9.

This single observation parallelizes an enormous family of loops that programmers reflexively believe are serial:

- **Prefix sum itself** (`aᵢ = 1`, so `bᵢ = xᵢ`): the additive scan is the degenerate affine case.
- **Running products, exponential moving averages, IIR filters** of order 1.
- **Polynomial evaluation by Horner's rule**, `pᵢ = pᵢ₋₁·z + cᵢ`.
- **Recurrence relations in dynamic programming** whose transition is linear.
- **Cumulative interest / bank-balance simulations**, `balanceᵢ = rateᵢ·balanceᵢ₋₁ + depositᵢ`.
- **Tridiagonal linear systems** (cyclic reduction is the scan structure on the elimination recurrence).
- **The carry chain of a binary adder** — exactly the `c_{i+1} = gᵢ ∨ (pᵢ ∧ cᵢ)` Boolean affine recurrence of §3, closing the loop: the adder is a recurrence-as-scan, and the recurrence-as-scan is an adder.

### Higher-order recurrences via companion matrices

A linear recurrence of order `k`, e.g. Fibonacci `xᵢ = xᵢ₋₁ + xᵢ₋₂`, does not fit a scalar affine map — but it fits a *matrix* one. Stack the last `k` values into a state vector and write the step as a constant matrix–vector product:

```text
   ⎡ xᵢ   ⎤   ⎡ 1  1 ⎤ ⎡ xᵢ₋₁ ⎤
   ⎢      ⎥ = ⎢      ⎥ ⎢      ⎥        ⟹   vᵢ = Aᵢ · vᵢ₋₁ + cᵢ.
   ⎣ xᵢ₋₁ ⎦   ⎣ 1  0 ⎦ ⎣ xᵢ₋₂ ⎦
```

Now the monoid is **matrix multiplication of `k×k` companion matrices** (for the homogeneous part) or affine-on-vectors `(Aᵢ, cᵢ) ⊙ (A'ᵢ, c'ᵢ) = (Aᵢ A'ᵢ, Aᵢ c'ᵢ + cᵢ)` (for the inhomogeneous part). Matrix multiply is associative, so *any* order-`k` linear recurrence is a scan over `k×k` matrices, with span `O(log n)` and work `O(n · k^ω)` (where `k^ω` is the matrix-multiply cost, often a small constant). This is why "compute the `n`-th term of a linear recurrence" is in `NC` — it is a scan over a fixed-size matrix monoid.

> **The senior reflex.** When you see a loop `state = f(state, input[i])` and `f` is *associative in the right algebra*, the loop is a scan and the dependency is illusory. Affine maps, matrix products, `min`/`max`, DFA transition composition, and (segmented) reductions all qualify. The "I must do these in order" intuition is wrong whenever the per-step operator composes associatively; the scan recovers the parallelism the sequential phrasing hid. This is the constructive engine behind much of `NC` membership (see [`../01-models-pram-work-span/senior.md`](../01-models-pram-work-span/senior.md)) — most "obviously sequential but actually in `NC`" results are a recurrence-as-scan in disguise.

---

## Blocked Multi-Level Scan for Real Hardware

The flat PRAM scan assumes `n` processors. A real machine has `p ≪ n` cores (or a GPU's grid of thread-blocks, each with limited fast memory), so the production algorithm is a **blocked, multi-level scan** that is a textbook application of *Brent's principle*: simulate the `n`-processor algorithm with `p` processors at the same work by giving each processor a contiguous block of `n/p` elements.

### The three-level recipe

```text
SCAN-BLOCKED(x[0..n-1], ⊕):

  # Level 1 — local scan within each block (embarrassingly parallel, no comms)
  Partition x into B blocks of n/B elements.
  In parallel, each block does a SEQUENTIAL (or warp) scan of its n/B elements,
    producing local prefixes; record each block's TOTAL (its reduce) in block_sums[b].

  # Level 2 — scan the block sums (recursion / a small parallel scan)
  block_offsets = EXCLUSIVE-SCAN(block_sums, ⊕)
    # the prefix ⊕ of everything in earlier blocks; recurse if B is large

  # Level 3 — add the block offset back into each local result (parallel, no comms)
  In parallel, each block b adds block_offsets[b] to every one of its local prefixes.
```

The structure is *scan within blocks → scan across block totals → broadcast the offset back*. Level 1 and level 3 are perfectly parallel and communication-free; level 2 operates on only `B` values and is the recursion (when `B` itself is large, scan it the same way, giving `O(log_B n)` levels — typically two or three in practice).

The decomposition is itself an instance of the recurrence-as-scan idea at a coarser grain: the block offsets satisfy `offset[b] = offset[b−1] ⊕ block_sum[b−1]`, a plain scan recurrence over the `B` block totals. So the algorithm *recursively scans a scan*, each level shrinking the problem by the block factor `B` — which is exactly why the level count is `log_B n` rather than `log₂ n`, and why a large `B` (more work absorbed sequentially per block) flattens the recursion depth, just as a large merge fan-in flattens external merge sort.

### Why this is optimal: Brent's principle in action

The work is `O(n)`: level 1 does `O(n/B)` per block × `B` blocks `= O(n)`; level 2 does `O(B)`; level 3 does `O(n)`. With `p = B` processors each handling a block of `n/p`, Brent's theorem gives

```text
   T_p = O(n/p + log p),
```

the same shape as the worked piece in [`../01-models-pram-work-span/senior.md`](../01-models-pram-work-span/senior.md): linear, work-efficient speedup up to `p = n/log n`, then the `log p` span term dominates. Crucially, the *local* scans in level 1 are done **sequentially** (a simple `O(n/B)` loop), which is the cheapest possible way to scan a block and avoids the `log` factor of a parallel scan on data that fits one core. **You only pay parallel-scan overhead at the level where you actually have parallelism to exploit** — within a warp and across blocks — and run the trivial sequential scan everywhere else. This blend of sequential-where-serial-is-free and parallel-where-it-pays is the entire engineering art of fast scan, and it is exactly Brent's `n/p`-per-processor principle made concrete.

The same two/three-level decomposition is what a GPU does, mapped onto its hierarchy: **warp scan → block scan → grid-level scan of block sums**, which the next section sketches.

---

## GPU Scan Engineering: A Sketch

The full GPU treatment is the [professional level](./professional.md); here is the senior-level map of *what* matters and *why*, so the blocked recipe above lands on real silicon.

- **Three levels onto three hardware tiers.** A grid-wide scan is *warp scan* (32 lanes, using `__shfl`-based shuffles — register-to-register, no shared memory) → *block scan* (combine warp totals in shared memory, then add warp offsets back) → *grid scan* (scan the per-block totals, then add block offsets back). This is the §7 recipe with `B` chosen to match warp and block sizes — Brent's principle aligned to the SIMT hierarchy.
- **Bank-conflict-free Blelloch.** The naïve shared-memory up-sweep/down-sweep (Brent–Kung) suffers shared-memory *bank conflicts*: the stride-`2ᵗ` access pattern makes many threads hit the same memory bank, serializing accesses. The standard fix (Harris–Sengupta–Owens, the GPU Gems 3 scan) adds a *padding offset* `CONFLICT_FREE_OFFSET(i) = i >> LOG_NUM_BANKS` to every index, spreading accesses across banks. This is a pure memory-layout trick that recovers the theoretical `O(n)`-work, `O(log n)`-depth behavior on real hardware where the PRAM's "free memory access" is false.
- **Warp-synchronous primitives.** Modern GPUs expose `__shfl_up_sync` and warp-level intrinsics that do an intra-warp scan in `log₂ 32 = 5` shuffle steps with *no* shared memory and *no* explicit barriers (lanes in a warp advance in lockstep). This is a Kogge–Stone network living inside one warp — low-depth and fan-out-2, exactly where Kogge–Stone's "work-inflated but minimum-depth" profile is the right call because 32 elements is too small for the work penalty to matter.
- **Single-pass scan: decoupled look-back.** The textbook approach scans block sums in a *separate* kernel pass (re-reading the data). The state-of-the-art (Merrill–Garland's *decoupled look-back*, used in CUB) fuses everything into **one pass**: each block computes its local sum, publishes it, and *looks back* at predecessor blocks' published prefixes to obtain its offset without a global barrier — turning the three-level scan into a single sweep over memory, which is bandwidth-optimal (`2n` data movement, the `scan(n)` floor).
- **Use the library.** In practice you call **CUB** (`cub::DeviceScan`) or **Thrust** (`thrust::inclusive_scan` / `exclusive_scan`), which ship the decoupled-look-back, bank-conflict-free, warp-optimized implementation. Rolling your own is a learning exercise, not a production decision — the library is within a few percent of memory bandwidth and handles every edge case.
- **Scan is memory-bound, not compute-bound.** The decisive performance fact about scan on modern hardware is that the arithmetic (`n−1` additions) is trivial relative to the data movement (`2n` reads + writes). Scan's *arithmetic intensity* is essentially zero, so the only number that matters is how close you get to peak memory bandwidth — which is why single-pass decoupled look-back (`2n` traffic) beats a classic two-pass scan (`~4n` traffic) by nearly 2× despite doing the *same* additions. This re-frames every "which network?" decision: at scale you are not minimizing operations, you are minimizing memory passes, and the work-efficient (`Θ(n)`-work) Brent–Kung skeleton wins because the work-inflated Kogge–Stone would *touch memory more times*. The lower bound that bites here is not the `Ω(log n)` span but the `2n` bandwidth floor — the `scan(n) = Θ(n/B)` I/O floor of the external-memory model applied to device DRAM.

The throughline: every GPU optimization is *re-pricing a cost the PRAM ignored* — shared-memory bank conflicts, warp lockstep, kernel-launch and barrier overhead, memory bandwidth — exactly as BSP/LogP re-price communication in the models file. The *algorithm* is unchanged (blocked Brent–Kung scan); the engineering is making the idealized analysis survive contact with the hardware.

---

## Worked Piece: The Affine-Recurrence-as-Scan Derivation

To make the recurrence-as-scan claim concrete, derive the parallelization of `xᵢ = aᵢ·x_{i−1} + bᵢ` end to end, then read off its work, span, and `NC` membership — the way the models file's worked piece tracks prefix sum through the theory.

### Step 1 — Represent each step as an affine map

Define `fᵢ(t) = aᵢ · t + bᵢ`. Then `xᵢ = fᵢ(x_{i−1})`, and unrolling,

```text
   xᵢ = fᵢ( fᵢ₋₁( … f₀(x_{−1}) … ) )  =  (fᵢ ∘ fᵢ₋₁ ∘ ⋯ ∘ f₀)(x_{−1}).
```

So *every* `xᵢ` is obtained by applying the **prefix-composed** map `Fᵢ = fᵢ ∘ ⋯ ∘ f₀` to the single initial value `x_{−1}`. If we can compute all the `Fᵢ` in parallel, one elementwise application finishes the job.

### Step 2 — The maps form a monoid; the prefixes are a scan

Represent map `f(t) = a·t + b` by its pair `(a, b)`. Composition is

```text
   (a, b) ⊙ (a', b')  =  ( a·a',  a·b' + b ),        identity = (1, 0).
```

Associativity is inherited from function composition (no computation needed — composition is *always* associative). Therefore `(A_i, B_i) := (aᵢ, bᵢ) ⊙ ⋯ ⊙ (a₀, b₀)` is precisely the **inclusive scan** of the input pairs under `⊙`, and `Fᵢ(t) = A_i·t + B_i`.

### Step 3 — Recover the answer

Apply each prefix map to the initial value:

```text
   xᵢ = A_i · x_{−1} + B_i.
```

If `x_{−1} = 0` (the common case), this is just `xᵢ = B_i` — the second component of the scan *is* the answer, and the first component `A_i` (the running product of the `aᵢ`) comes along for free.

### Step 4 — A tiny trace

Take `a = (2, 3, 1)`, `b = (1, 0, 5)`, `x_{−1} = 0`, so the recurrence is `x₀ = 2·0+1`, `x₁ = 3·x₀+0`, `x₂ = 1·x₁+5`. Sequentially: `x₀ = 1`, `x₁ = 3`, `x₂ = 8`.

Now via the scan of pairs under `⊙` (combining left-to-right, newest map applied last):

```text
   prefix 0:  (2, 1)
   prefix 1:  (3, 0) ⊙ (2, 1) = (3·2, 3·1 + 0) = (6, 3)
   prefix 2:  (1, 5) ⊙ (6, 3) = (1·6, 1·3 + 5) = (6, 8)
```

The `B`-components are `(1, 3, 8)` — exactly `(x₀, x₁, x₂)`. The scan reproduces the sequential recurrence, and it does so with all prefixes available after `O(log n)` parallel `⊙`-combines instead of `n` sequential steps.

### Step 5 — Read off the complexity

- **Work** `T₁ = O(n)`: `n` elementwise pair constructions + an `O(n)`-work scan (Blelloch/Brent–Kung) + `n` elementwise applications. Work-efficient — only a constant factor over the sequential `n`-step loop.
- **Span** `T∞ = O(log n)`: dominated by the scan; the elementwise steps are `O(1)` depth.
- **`NC` membership:** scan over a fixed-arity associative operator is in `NC¹` (the carry-monoid / Ladner–Fischer result). The affine monoid has constant-size elements, so the affine recurrence — and by Step "higher-order" any fixed-order linear recurrence (companion-matrix monoid) — is in `NC¹`. The loop that *looked* `Θ(n)`-span is actually `O(log n)`-span.
- **The lower bound is matched:** `x_{n−1}` depends on all `n` inputs (every `aᵢ, bᵢ` can change it), so by Cook–Dwork–Reischuk it requires `Ω(log n)` span on EREW/CREW — the scan is span-*optimal*, not merely fast. The recurrence has the *same* intrinsic parallelism as plain prefix sum, no more and no less.

### A caveat on numerics

One honest senior footnote: the affine-composition scan is *not* numerically identical to the sequential recurrence in floating point. Re-associating `(a·a')·t + (a·b' + b)` reorders the operations, so rounding differs, and worse, the product `A_i = a₀·a₁·⋯·aᵢ` can *overflow or underflow* even when every individual `xᵢ` stays bounded (e.g. an IIR filter with `|aᵢ| < 1` whose running product decays to denormals while the true state is fine). The parallel scan is exact only in exact arithmetic. The practical mitigations — blocked recurrence solvers that keep block sizes small enough that `A_block` stays in range, or computing in log-space for products — are why production parallel recurrence solvers (e.g. parallel tridiagonal and parallel IIR) are blocked rather than a single flat affine scan. The math says "it's a scan"; the floating-point engineering says "scan it in bounded blocks."

This is the template for "parallelize a sequential loop": **find the per-step operator, prove it composes associatively, scan it.** The affine case covers a vast swath of real loops; the matrix generalization covers the rest of the linear ones; and the DFA/segmented cases (lexing, SpMV) are the same idea with a different monoid.

---

## Decision Framework

When you face a problem that *might* be a scan, or you must choose how to realize one:

1. **Is there a hidden scan?** If the problem is "for each `i`, combine everything up to `i`," or "run this loop with a carried dependency," ask *what monoid makes this associative*: `+`/`×`/`min`/`max` (plain scan), `(a,b)`-affine (first-order linear recurrence), `k×k` matrices (order-`k` recurrence), function composition (DFA / lexing), or the segmented variant (per-group reduction). If you find the monoid, you have an `O(log n)`-span algorithm.
2. **Segmented?** If the data is ragged — variable-length rows, groups, sublists — do *not* launch one task per group. Attach head flags and use **segmented scan**; the irregularity collapses into a flag bit and the load balances automatically (SpMV, partition, list ranking).
3. **Work-efficient or low-span network?** Default to **Brent–Kung / Blelloch** (`Θ(n)` work, `2 log n` depth) — on real machines memory bandwidth and energy dominate latency, so work-efficiency wins. Reach for **Kogge–Stone / Hillis–Steele** (`Θ(n log n)` work, `log n` depth) only at small scales (a warp) or when latency is genuinely the binding constraint and work is cheap. For a tuned middle point, the **Ladner–Fischer / Han–Carlson** hybrids interpolate.
4. **Blocked for the real machine.** Never run a flat `n`-processor scan. Decompose into **scan blocks → scan block sums → add offsets back** (Brent's principle): sequential scan within blocks (cheapest), parallel scan only across the `p` block totals. This gives `O(n/p + log p)` and is the shape of every CPU and GPU production scan.
5. **On a GPU, use the library.** `cub::DeviceScan` / `thrust::inclusive_scan` ship the decoupled-look-back, bank-conflict-free, warp-shuffle implementation at near-bandwidth. Hand-roll only to learn; see [`./professional.md`](./professional.md) for what the library is doing.
6. **Mind the lower bound.** If your output's last element depends on all `n` inputs (it usually does for a true scan), `Ω(log n)` span is *forced* on EREW/CREW (Cook–Dwork–Reischuk). Do not chase `O(1)` span — the `O(log n)`-depth network is already optimal. Spend effort on work-efficiency and constants, not on a span that cannot exist.

---

## Research Pointers

- **Ladner, R. E., & Fischer, M. J. (1980).** "Parallel Prefix Computation." *JACM* 27(4). The foundational theory: the parameterized depth–size tradeoff family and its optimality for the prefix problem.
- **Hillis, W. D., & Steele, G. L. (1986).** "Data Parallel Algorithms." *CACM* 29(12). The step-doubling (`O(n log n)`-work) scan, in the Connection Machine context.
- **Blelloch, G. E. (1990).** *Vector Models for Data-Parallel Computing.* MIT Press. The scan-vector model, the work-efficient up/down-sweep scan, segmented scan, and scan-based quicksort / line-of-sight / SpMV.
- **Blelloch, G. E. (1989/1990).** "Scans as Primitive Parallel Operations." *IEEE Trans. Computers* 38(11). The argument for scan as a unit-cost primitive of algorithm design.
- **Kogge, P. M., & Stone, H. S. (1973).** "A Parallel Algorithm for the Efficient Solution of a General Class of Recurrence Equations." *IEEE Trans. Computers* C-22(8). The minimum-depth recurrence-solving network — and the recurrence-as-scan view, decades early.
- **Brent, R. P., & Kung, H. T. (1982).** "A Regular Layout for Parallel Adders." *IEEE Trans. Computers* C-31(3). The work-efficient (`Θ(n)`-size) prefix network — the hardware Blelloch scan.
- **Sklansky, J. (1960).** "Conditional-Sum Addition Logic." *IRE Trans. Electronic Computers* EC-9(2). The minimum-depth, high-fan-out conditional-sum adder.
- **Han, T., & Carlson, D. A. (1987).** "Fast Area-Efficient VLSI Adders." *IEEE Symp. Computer Arithmetic.* The Kogge–Stone/Brent–Kung hybrid that interpolates the tradeoff.
- **Sengupta, S., Harris, M., Zhang, Y., & Owens, J. D. (2007).** "Scan Primitives for GPU Computing." *Graphics Hardware.* Segmented scan on GPUs and the bank-conflict-free Blelloch implementation.
- **Merrill, D., & Garland, M. (2016).** "Single-pass Parallel Prefix Scan with Decoupled Look-back." NVIDIA tech report. The one-pass, bandwidth-optimal scan behind CUB.
- **Harris, M., Sengupta, S., & Owens, J. D. (2007).** "Parallel Prefix Sum (Scan) with CUDA." *GPU Gems 3*, ch. 39. The canonical pedagogical GPU scan, padding trick included.

---

## Key Takeaways

- **Scan is a fundamental primitive, not a subroutine.** Blelloch's scan-vector model charges `scan`/`reduce`/`permute` `O(1)` depth (justified by `NC¹` membership) and asks what composes from a constant number of them — and the answer is *enormous*: compaction, quicksort, SpMV, lexing, radix sort. The senior reflex is to *recognize the scan* hiding in a problem.
- **Binary addition is a scan over the (generate, propagate) carry monoid.** Every fast adder — Kogge–Stone, Brent–Kung, Sklansky, Ladner–Fischer — is a hardware scan network, and the hardware depth/size/fan-out tradeoffs are *the same theory* as the software work/span tradeoff. One object, two vocabularies.
- **The prefix-network tradeoff is provably continuous (Ladner–Fischer 1980).** **Kogge–Stone/Hillis–Steele** = min depth `log n`, work `Θ(n log n)`, fan-out 2. **Brent–Kung/Blelloch** = depth `2 log n`, work `Θ(n)` (efficient), fan-out `O(1)`. **Sklansky** = min depth but unbounded fan-out (a trap once wires are priced). You cannot have min depth *and* `O(n)` size at once; pick your point.
- **Segmented scan turns ragged data into one flat, perfectly load-balanced scan.** A head flag and the segmented monoid `⊕_seg` make per-segment reductions a single ordinary scan — the basis of quicksort partition, CSR SpMV, and graph primitives, immune to segment-length skew.
- **Any first-order linear recurrence `xᵢ = aᵢ·x_{i−1} + bᵢ` is a scan over the affine monoid `(a,b) ⊙ (a',b') = (aa', ab'+b)`**, hence `O(log n)` span and in `NC¹`. Higher-order recurrences scan over `k×k` companion matrices. The "must run in order" intuition is wrong whenever the per-step operator composes associatively — this is the constructive engine behind much of `NC`.
- **Real hardware forces a blocked, multi-level scan** (scan blocks → scan block sums → add offsets back), a direct application of Brent's principle giving `O(n/p + log p)`: sequential scan where serial is free, parallel scan only where parallelism exists. GPU scan adds bank-conflict-free layout, warp shuffles, and single-pass decoupled look-back — all *re-pricing costs the PRAM ignored*. In production, call CUB/Thrust; see [`./professional.md`](./professional.md).

---

> **See also:** [`./middle.md`](./middle.md) for Hillis–Steele, Blelloch up/down-sweep, applications, and the `Ω(log n)` floor · [`./professional.md`](./professional.md) for the full GPU scan implementation (bank-conflict-free Blelloch, warp scans, decoupled look-back, CUB/Thrust) · [`../01-models-pram-work-span/senior.md`](../01-models-pram-work-span/senior.md) for `NC¹`, work–span, Brent's theorem, and the Cook–Dwork–Reischuk lower bound · [`../03-parallel-sorting-and-merging/senior.md`](../03-parallel-sorting-and-merging/senior.md) for radix sort and partition built on scan
