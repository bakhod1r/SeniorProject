# Parallel Prefix Sum (Scan) — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Scan, Restated for Proofs](#scan-restated-for-proofs)
   - [The Monoid](#the-monoid)
   - [Inclusive vs Exclusive](#inclusive-vs-exclusive)
3. [Hillis–Steele: The Naive Scan](#hillissteele-the-naive-scan)
   - [The Algorithm](#the-algorithm)
   - [Correctness: The Round Invariant](#correctness-the-round-invariant)
   - [Work and Span: Θ(n log n) / Θ(log n)](#work-and-span-θn-log-n--θlog-n)
4. [Blelloch: The Work-Efficient Scan](#blelloch-the-work-efficient-scan)
   - [The Idea: Two Sweeps Over a Balanced Tree](#the-idea-two-sweeps-over-a-balanced-tree)
   - [Up-Sweep (Reduce)](#up-sweep-reduce)
   - [Down-Sweep](#down-sweep)
   - [A Full Walkthrough on 8 Elements](#a-full-walkthrough-on-8-elements)
   - [Work and Span: Θ(n) / Θ(log n)](#work-and-span-θn--θlog-n)
5. [The Lower Bound: Ω(log n) Span](#the-lower-bound-ωlog-n-span)
6. [Variations](#variations)
   - [Inclusive ⇄ Exclusive Conversions](#inclusive--exclusive-conversions)
   - [Any Associative Operator](#any-associative-operator)
   - [Segmented Scan](#segmented-scan)
7. [Applications, Rigorously](#applications-rigorously)
   - [Stream Compaction](#stream-compaction)
   - [Radix-Sort Split](#radix-sort-split)
   - [Linear-Recurrence Evaluation](#linear-recurrence-evaluation)
8. [Code: Scans with Work/Span Counters](#code-scans-with-workspan-counters)
   - [Go](#go)
   - [Python](#python)
9. [Pitfalls](#pitfalls)
10. [Summary](#summary)

---

## Introduction

> Focus: turn the junior facts — what a scan is, the Hillis–Steele doubling picture, and its uses — into rigorous statements you can *prove*. By the end you can prove the Hillis–Steele round invariant and its `Θ(n log n)` work / `Θ(log n)` span, derive Blelloch's up-sweep/down-sweep scan and show it is work-efficient (`Θ(n)` work, `Θ(log n)` span), prove the `Ω(log n)` span lower bound that makes Blelloch span- *and* work-optimal, and express stream compaction, radix-sort split, and linear recurrences as scans.

At the [junior level](./junior.md) you met the **prefix sum**, or **scan**: given `x₀, x₁, …, x_{n−1}` and an associative operator `⊕`, produce all the running combinations. You saw the **Hillis–Steele** doubling picture — every element reaches `2^d` further left each round — and a catalog of applications (running totals, compaction, allocation). You also met the [work–span model](../01-models-pram-work-span/middle.md): **work** `T₁` (total operations, = 1-processor time), **span** `T∞` (critical-path length, = ∞-processor time), and the rule that a parallel algorithm is **work-efficient** when `T₁ = Θ(T_seq)`.

This file makes scan rigorous:

- **Hillis–Steele** in full: the algorithm runs `⌈log₂ n⌉` rounds, each doing `Θ(n)` adds. We *prove* the round invariant — after round `d`, position `i` holds `⊕` of the window `[i − 2^d + 1 .. i]` — and read off **work `Θ(n log n)`, span `Θ(log n)`**. It is fast but **not work-efficient**.
- **Blelloch's** work-efficient scan: an **up-sweep** (an in-place reduction tree) followed by a **down-sweep** (pushing partial sums back down). Each sweep is `Θ(n)` work and `Θ(log n)` span, giving **work `Θ(n)`, span `Θ(log n)`** — work-efficient. We walk both sweeps on an 8-element array. *This is the scan to know.*
- **The lower bound.** Any scan needs `Ω(log n)` span, because the last output depends on every input and dependencies fan in no faster than a binary tree. So Blelloch is **span-optimal *and* work-optimal**.
- **Variations:** inclusive ⇄ exclusive conversions, scan with any [monoid](#the-monoid) (max, min, OR, multiply, matrix), and **segmented** scan (scan within flagged segments).
- **Applications** as scans: stream compaction, the radix-sort split (forward link to [parallel sorting and merging](../03-parallel-sorting-and-merging/middle.md)), and evaluating linear recurrences.

A note on vocabulary used throughout:

| Symbol | Meaning |
|--------|---------|
| `n` | number of input elements |
| `⊕` | an associative binary operator (with identity `e`) |
| `e` | the identity element of `⊕` (`e ⊕ x = x ⊕ e = x`) |
| inclusive `y_i` | `x₀ ⊕ x₁ ⊕ … ⊕ x_i` (includes `x_i`) |
| exclusive `y_i` | `x₀ ⊕ x₁ ⊕ … ⊕ x_{i−1}` (excludes `x_i`; `y_0 = e`) |
| `T₁` | **work** — total operations |
| `T∞` | **span** — critical-path length |

Throughout we analyze in the [work–span model](../01-models-pram-work-span/middle.md). All logarithms are base 2 unless noted, and where convenient we take `n` to be a power of two — the bounds are unchanged for general `n` (pad to the next power of two, at most doubling the size).

---

## Scan, Restated for Proofs

### The Monoid

Scan is defined for any operator that forms a **monoid**: a set with an associative binary operator `⊕` and an identity element `e`.

> **Definition (monoid).** `(S, ⊕, e)` is a monoid when (i) `⊕` is **associative**: `(a ⊕ b) ⊕ c = a ⊕ (b ⊕ c)` for all `a, b, c`; and (ii) `e` is an **identity**: `e ⊕ a = a ⊕ e = a` for all `a`.

Associativity is the load-bearing property — it is *exactly* what lets us re-parenthesize the running combinations freely, which is what every parallel scan does when it combines sub-ranges out of left-to-right order. The identity `e` is what an *exclusive* scan emits in position 0 and what seeds the empty prefix. Commutativity is **not** required: scan respects the input order, so `⊕` may be non-commutative (matrix product, string concatenation, function composition) as long as it is associative.

```text
   monoid examples used for scan:
     (ℤ, +, 0)          running sums
     (ℝ, ×, 1)          running products
     (ℤ, max, −∞)       running maxima
     (ℤ, min, +∞)       running minima
     (bits, OR, 0)      running OR     (AND with identity all-ones)
     (matrices, ·, I)   running matrix products   (non-commutative!)
```

If `⊕` is *not* associative, every theorem below fails: the re-parenthesization a parallel scan performs would change the answer. This is the single most important correctness precondition — we return to it in the [pitfalls](#pitfalls).

### Inclusive vs Exclusive

Two conventions differ only by a one-position shift:

```text
  input:           x0    x1    x2    x3       (⊕ = +)
  inclusive scan:  x0    x0+x1 x0..x2 x0..x3  (y_i includes x_i)
  exclusive scan:  e=0   x0    x0+x1  x0..x2  (y_i excludes x_i; y_0 = e)
```

> **Inclusive** `y_i = x_0 ⊕ x_1 ⊕ … ⊕ x_i`. Position `i` includes its own element.
>
> **Exclusive** `y_i = x_0 ⊕ x_1 ⊕ … ⊕ x_{i−1}`, with `y_0 = e` (the empty prefix). Position `i` excludes its own element.

Both carry the same information, and converting one to the other is a `Θ(n)`-work, `Θ(1)`-span shift ([below](#inclusive--exclusive-conversions)). The choice is a matter of application: exclusive scan is the natural fit for **allocation** ("where does element `i`'s output begin?" = the count of everything before it), which is why Blelloch's algorithm produces an *exclusive* scan directly. Inclusive is the natural fit for **running totals** ("what is the sum up to and including here?"). Hillis–Steele below produces an *inclusive* scan directly. Knowing which one your algorithm emits — and how to flip it without an off-by-one — is half of using scan correctly.

---

## Hillis–Steele: The Naive Scan

### The Algorithm

The Hillis–Steele scan is the **inclusive** scan by *doubling reach*. Keep an array `a[0..n−1]`, initialized to the input. For `d = 0, 1, …, ⌈log₂ n⌉ − 1`, every position adds the element `2^d` to its left (positions with no such neighbor are unchanged):

```text
  a ← x                                   // copy input
  for d = 0, 1, 2, … while 2^d < n:
      for all i in parallel:
          if i ≥ 2^d:  a[i] ← a[i − 2^d] ⊕ a[i]   // read old, write new
```

The parallel update must read the *old* array and write a *new* one for that round (a double buffer, or careful in-place ordering), so that within a round no position sees another position's freshly written value. The picture for `n = 8`:

```text
  index:   0    1    2    3    4    5    6    7
  start:   x0   x1   x2   x3   x4   x5   x6   x7

  d=0 (+1): each i adds a[i−1]      → window width 2
           x0  x0:1 x1:2 x2:3 x3:4 x4:5 x5:6 x6:7

  d=1 (+2): each i adds a[i−2]      → window width 4
           x0  x0:1 x0:2 x0:3 x1:4 x2:5 x3:6 x4:7

  d=2 (+4): each i adds a[i−4]      → window width 8
           x0  x0:1 x0:2 x0:3 x0:4 x0:5 x0:6 x0:7
                                                   ← full inclusive scan
```

Here `xa:b` abbreviates `x_a ⊕ … ⊕ x_b`. After `3 = log₂ 8` rounds every position holds its inclusive prefix.

### Correctness: The Round Invariant

The picture is suggestive; here is the proof.

> **Invariant.** After round `d` completes (rounds numbered `d = 0, 1, …`), position `i` holds
> ```text
>   a[i] = x_{max(0, i − 2^{d+1} + 1)} ⊕ … ⊕ x_i,
> ```
> i.e. the `⊕` of the contiguous window of the **`2^{d+1}` elements ending at `i`** (truncated at the left edge).

**Proof by induction on `d`.**

*Base (`d = 0`).* In round `d = 0` every `i ≥ 1` computes `a[i] ← x_{i−1} ⊕ x_i`, a window of `2 = 2^{0+1}` elements ending at `i`; position `0` keeps `x_0` (window of 1, truncated). The invariant holds.

*Step.* Assume after round `d−1` each position `j` holds the window of `2^d` elements ending at `j`, i.e. `a[j] = x_{j−2^d+1} ⊕ … ⊕ x_j` (truncating at 0). Round `d` sets, for `i ≥ 2^d`,
```text
  a[i] ← a[i − 2^d] ⊕ a[i]        (reading the round-(d−1) values)
       = (x_{i−2^d−2^d+1} ⊕ … ⊕ x_{i−2^d}) ⊕ (x_{i−2^d+1} ⊕ … ⊕ x_i).
```
The left factor is the window of `2^d` elements ending at `i − 2^d`; the right factor is the window of `2^d` elements ending at `i`. These two windows are **adjacent and disjoint** — the first ends at index `i − 2^d`, the second begins at `i − 2^d + 1` — so by associativity their combination is the single window
```text
  x_{i − 2^{d+1} + 1} ⊕ … ⊕ x_i,
```
of `2^{d+1}` elements ending at `i`. Positions `i < 2^d` are unchanged and already hold their full (left-truncated) prefix. The invariant holds after round `d`. ∎

**Termination.** Once `2^{d+1} ≥ n`, the window of `2^{d+1}` elements ending at `i` *is* the whole prefix `x_0 ⊕ … ⊕ x_i` for every `i` (the left truncation kicks in at 0). That happens at `d = ⌈log₂ n⌉ − 1`, so after `⌈log₂ n⌉` rounds every `a[i]` is the inclusive prefix. The crucial step is **associativity**, used to merge two adjacent windows — the property the [monoid](#the-monoid) guarantees.

### Work and Span: Θ(n log n) / Θ(log n)

> **Claim.** Hillis–Steele scan has **work `T₁ = Θ(n log n)`** and **span `T∞ = Θ(log n)`**.

**Span.** The algorithm runs `⌈log₂ n⌉` rounds. Round `d` reads round `d−1`'s output, so the rounds form a dependency chain of length `⌈log₂ n⌉`; within a round every position is independent (all parallel). The critical path is therefore one operation per round: `T∞ = Θ(log n)`.

**Work.** Round `d` performs one `⊕` for each `i ≥ 2^d`, i.e. `n − 2^d` operations. Summing over the `⌈log₂ n⌉` rounds:
```text
  T₁ = Σ_{d=0}^{log n − 1} (n − 2^d)
     = n·log n  −  (2^{log n} − 1)
     = n·log n  −  (n − 1)
     = Θ(n log n).
```
Each of the `log n` rounds does `Θ(n)` work, so the total is `Θ(n log n)`.

**Not work-efficient.** Sequential scan is `Θ(n)` (one running accumulator, one pass), so Hillis–Steele does a factor of `log n` *more* work than necessary. By the [work–span analysis](../01-models-pram-work-span/middle.md), speedup over sequential is capped at `P · (T_seq/T₁) = P / log n`: the redundant work throws away a `log n` factor of processors before you begin. Hillis–Steele wins on **span** (it is `Θ(log n)`, optimal) but loses on **work**.

```text
  Hillis–Steele:  T₁ = Θ(n log n)   T∞ = Θ(log n)   work-efficient? NO
```

It earns its place because it is simple and, on a SIMD machine with `n` lanes where work is "free" (you have the lanes anyway), the constant factors are tiny — it is a common GPU choice for *small* arrays. But as the production algorithm for large `n`, the next section's Blelloch scan dominates it.

---

## Blelloch: The Work-Efficient Scan

### The Idea: Two Sweeps Over a Balanced Tree

Blelloch's scan reaches `Θ(n)` work by building the same balanced binary tree a [reduction](../04-parallel-reduce-and-map/middle.md) builds — which has only `n − 1` internal nodes — and reusing it in two passes:

1. **Up-sweep (reduce).** Sweep from the leaves up, combining children into parents, storing each partial sum *in place* in the array. After the up-sweep the root holds the total `x_0 ⊕ … ⊕ x_{n−1}`, and every internal node holds the sum of its subtree.
2. **Down-sweep.** Set the root to the **identity** `e`, then sweep down: at each node, the left child receives the node's incoming value, and the right child receives `(incoming value) ⊕ (left child's stored up-sweep sum)`. When the sweep reaches the leaves, leaf `i` holds the **exclusive** prefix `x_0 ⊕ … ⊕ x_{i−1}`.

Both sweeps touch each of the `n − 1` tree edges a constant number of times → `Θ(n)` work each; both are `log n` levels deep → `Θ(log n)` span each. The whole array doubles as the tree storage, so the algorithm is **in place** (no `O(n)` extra buffer). The output is an **exclusive** scan.

### Up-Sweep (Reduce)

Treat the array as a complete binary tree whose leaves are `a[0..n−1]`. The up-sweep proceeds in `log n` rounds; in round `d` (from `d = 0` up), the nodes spaced `2^{d+1}` apart absorb their left sibling:

```text
  for d = 0, 1, …, log n − 1:
      for all i = 0, 2^{d+1}, 2·2^{d+1}, … in parallel:
          a[i + 2^{d+1} − 1] ← a[i + 2^d − 1] ⊕ a[i + 2^{d+1} − 1]
```

The index `i + 2^{d+1} − 1` is the *right* child position (which holds the running subtree sum), and `i + 2^d − 1` is its *left* sibling. The number of active nodes halves each round: `n/2`, then `n/4`, …, down to `1`. After the last round, `a[n−1]` holds the grand total `x_0 ⊕ … ⊕ x_{n−1}`, and every position `i + 2^{d+1} − 1` set in round `d` holds the sum of the `2^{d+1}` leaves in its subtree.

**Work.** Round `d` does `n / 2^{d+1}` operations; summing, `n/2 + n/4 + … + 1 = n − 1 = Θ(n)`. **Span** `= log n` rounds = `Θ(log n)`. This *is* a [parallel reduction](../04-parallel-reduce-and-map/middle.md), with the partial sums kept rather than discarded.

### Down-Sweep

Now traverse top-down. First overwrite the root with the identity:

```text
  a[n − 1] ← e                              // seed the exclusive scan
  for d = log n − 1, …, 1, 0:               // top-down
      for all i = 0, 2^{d+1}, 2·2^{d+1}, … in parallel:
          left  ← a[i + 2^d − 1]            // left child's up-sweep sum
          a[i + 2^d − 1]       ← a[i + 2^{d+1} − 1]          // left child ← parent's value
          a[i + 2^{d+1} − 1]   ← left ⊕ a[i + 2^{d+1} − 1]    // right child ← left-sum ⊕ parent's value
```

Read the inner step carefully — it is the heart of the algorithm. At each node we hold an **incoming value** `v` (the exclusive sum of everything to the left of this subtree), stored at the right-child slot `a[i + 2^{d+1} − 1]`. We push it down:

- the **left child** gets `v` (everything left of the *left* subtree is exactly everything left of the whole subtree);
- the **right child** gets `v ⊕ L`, where `L = a[i + 2^d − 1]` is the left child's up-sweep sum (everything left of the *right* subtree is everything left of the whole subtree, *plus* the entire left subtree).

The two lines together perform that swap-and-combine. By the time the sweep reaches the leaves, leaf `i` holds `v` = the `⊕` of all leaves strictly to its left = the **exclusive prefix**.

**Work** `= Θ(n)` (same node count, constant work per node), **span** `= Θ(log n)` (one pass of `log n` levels).

### A Full Walkthrough on 8 Elements

Take `⊕ = +`, identity `e = 0`, input `x = [3, 1, 7, 0, 4, 1, 6, 3]` (sum `25`).

**Up-sweep.** Right-child slots absorb left siblings, in place.

```text
  start:   [ 3,  1,  7,  0,  4,  1,  6,  3]

  d=0 (stride 2, combine a[i] into a[i+1]):
           a[1]+=a[0]=4,  a[3]+=a[2]=7,  a[5]+=a[4]=5,  a[7]+=a[6]=9
         → [ 3,  4,  7,  7,  4,  5,  6,  9]

  d=1 (stride 4, combine a[i+1] into a[i+3]):
           a[3]+=a[1]=11, a[7]+=a[5]=14
         → [ 3,  4,  7, 11,  4,  5,  6, 14]

  d=2 (stride 8, combine a[3] into a[7]):
           a[7]+=a[3]=25
         → [ 3,  4,  7, 11,  4,  5,  6, 25]   ← a[7]=25 is the grand total
```

The array now stores the reduction tree: `a[1]=3+1`, `a[3]=3+1+7+0`, `a[5]=4+1`, `a[7]=` everything.

**Down-sweep.** Set the root to `0`, then push values down. At each node, *save* the left child, copy the parent into the left child, and write `saved ⊕ parent` into the right child.

```text
  set root:  a[7] ← 0
           → [ 3,  4,  7, 11,  4,  5,  6,  0]

  d=2 (stride 8, node spans [0..7], children at a[3], a[7]):
           L = a[3] = 11
           a[3] ← a[7] = 0
           a[7] ← L ⊕ a[7] = 11 ⊕ 0 = 11
         → [ 3,  4,  7,  0,  4,  5,  6, 11]

  d=1 (stride 4, nodes at children (a[1],a[3]) and (a[5],a[7])):
           left node:  L=a[1]=4;  a[1]←a[3]=0;   a[3]←4⊕0=4
           right node: L=a[5]=5;  a[5]←a[7]=11;  a[7]←5⊕11=16
         → [ 3,  0,  7,  4,  4, 11,  6, 16]

  d=0 (stride 2, four nodes):
           (a[0],a[1]): L=3; a[0]←a[1]=0;  a[1]←3⊕0=3
           (a[2],a[3]): L=7; a[2]←a[3]=4;  a[3]←7⊕4=11
           (a[4],a[5]): L=4; a[4]←a[5]=11; a[5]←4⊕11=15
           (a[6],a[7]): L=6; a[6]←a[7]=16; a[7]←6⊕16=22
         → [ 0,  3,  4, 11, 11, 15, 16, 22]
```

The result `[0, 3, 4, 11, 11, 15, 16, 22]` is the **exclusive** prefix-sum of `[3, 1, 7, 0, 4, 1, 6, 3]`:

```text
  i:           0   1   2   3    4    5    6    7
  exclusive:   0   3   4  11   11   15   16   22
  check x_<i:  0   3  3+1 …    sum of x[0..3]=11   …   sum of x[0..6]=22  ✓
```

To get the **inclusive** scan `[3, 4, 11, 11, 15, 16, 22, 25]`, add `x_i` back to position `i` (one `Θ(n)`-work, `Θ(1)`-span pass) — see [conversions](#inclusive--exclusive-conversions). Note the last inclusive value is `25`, the grand total the up-sweep already computed.

### Work and Span: Θ(n) / Θ(log n)

> **Claim.** Blelloch's scan has **work `T₁ = Θ(n)`** and **span `T∞ = Θ(log n)`** — it is **work-efficient**.

**Work.** Up-sweep does `n − 1` operations (a reduction tree); down-sweep does `Θ(n)` (a constant number of operations per internal node, of which there are `n − 1`). Total `T₁ = Θ(n)`, matching the sequential `Θ(n)` — **work-efficient**.

**Span.** Each sweep is `log n` levels deep, every level fully parallel, and the down-sweep waits for the up-sweep. So `T∞ = 2·log n = Θ(log n)`.

```text
  Blelloch:  T₁ = Θ(n)   T∞ = Θ(log n)   parallelism = Θ(n / log n)   work-efficient? YES
```

This is the canonical work-efficient parallel primitive — the one referenced in the [models file](../01-models-pram-work-span/middle.md) as "the best of both": sequential-matching work *and* logarithmic span. Comparing the two scans head to head:

| Algorithm | Work `T₁` | Span `T∞` | Work-efficient? | Output | In place? |
|-----------|-----------|-----------|-----------------|--------|-----------|
| Hillis–Steele | `Θ(n log n)` | `Θ(log n)` | **no** | inclusive | needs double buffer |
| Blelloch | `Θ(n)` | `Θ(log n)` | **yes** | exclusive | yes |

Blelloch wins on work (a `log n` factor of processor-time saved) at the same span. For large `n`, it is *the* scan.

---

## The Lower Bound: Ω(log n) Span

Could a scan have span `o(log n)`? No — and the proof is the same fan-in argument behind the [EREW reduction bound](../01-models-pram-work-span/middle.md).

> **Theorem.** In the work–span (or EREW/CREW PRAM) model, any algorithm that computes the inclusive scan of `n` elements has span `Ω(log n)`.

**Proof.** Consider the **last** output, `y_{n−1} = x_0 ⊕ x_1 ⊕ … ⊕ x_{n−1}`. It depends on *every* input: changing any single `x_i` changes `y_{n−1}` (for, e.g., integer addition, or any operator where elements are not annihilated). So the value `y_{n−1}` is a function of all `n` inputs.

In the DAG that computes the scan, every node performs one binary `⊕`, so a node combines the information of at most **two** of its predecessors. Define `D(t)` = the maximum number of distinct inputs that any value computed by depth `t` can depend on. A depth-0 value (an input read) depends on `1` input. A value at depth `t` is produced by one `⊕` of two values at depth `≤ t − 1`, so it depends on at most `D(t−1) + D(t−1) = 2·D(t−1)` inputs. Hence
```text
  D(0) = 1,   D(t) ≤ 2·D(t−1)   ⟹   D(t) ≤ 2^t.
```
For `y_{n−1}` to depend on all `n` inputs we need a value of depth `t` with `D(t) ≥ n`, i.e. `2^t ≥ n`, i.e.
```text
  t ≥ log₂ n = Ω(log n).
```
The output `y_{n−1}` therefore sits at depth `≥ log₂ n` in the DAG, so the span is `Ω(log n)`. ∎

This is the binary-fan-in barrier: information from `n` inputs can converge into one value no faster than a depth-`log n` binary tree, exactly as for [reduction](../04-parallel-reduce-and-map/middle.md). Combined with the previous section:

```text
  scan span:  lower bound Ω(log n)        Blelloch achieves Θ(log n)   → span-OPTIMAL
  scan work:  lower bound Ω(n) (read all) Blelloch achieves Θ(n)        → work-OPTIMAL
```

**Blelloch's scan is simultaneously span-optimal and work-optimal.** You cannot do asymptotically better on either axis: `Ω(n)` work because every input must be read, `Ω(log n)` span by the fan-in argument. Hillis–Steele matches the span optimum but pays a `log n` work penalty; Blelloch matches both. That joint optimality is why it is the algorithm to know.

---

## Variations

### Inclusive ⇄ Exclusive Conversions

The two conventions are interconvertible in `Θ(n)` work and `Θ(1)` span, *provided* you avoid the off-by-one:

```text
  exclusive → inclusive:   inc[i] = exc[i] ⊕ x[i]          (add own element back; parallel, no shift)
  inclusive → exclusive:   exc[i] = inc[i − 1]  for i ≥ 1,  exc[0] = e
                           (shift right by one, insert identity at front)
```

Going exclusive→inclusive is a pure element-wise `⊕` with the original input — no shift, no boundary subtlety beyond keeping `x` around. Going inclusive→exclusive is a **right shift** with `e` inserted at the front and the *last* inclusive value (the grand total) dropped. The two classic mistakes are (i) shifting the wrong direction, and (ii) forgetting that `exc[0] = e`, not `x[0]`. A useful sanity check: in an *exclusive* scan, `exc[0]` is always the identity (`0` for sum); in an *inclusive* scan, `inc[0] = x[0]`. If position 0 looks wrong, you have the conventions crossed.

### Any Associative Operator

Nothing in either algorithm uses addition specifically — only [associativity and an identity](#the-monoid). Swap `⊕` and `e` and the *same* code computes:

```text
  ⊕ = +,   e = 0        → prefix sums
  ⊕ = max, e = −∞       → prefix maxima ("running best so far")
  ⊕ = min, e = +∞       → prefix minima
  ⊕ = ×,   e = 1        → prefix products
  ⊕ = OR,  e = 0        → prefix OR  (AND with e = all-ones)
  ⊕ = ∘,   e = identity → prefix function/matrix composition (NON-commutative)
```

The matrix/composition case is worth dwelling on: because scan never assumes commutativity (it respects input order), you can scan a sequence of **matrices** under multiplication, or **affine maps** `x ↦ a·x + b` under composition. The latter is the key to evaluating [linear recurrences](#linear-recurrence-evaluation) as a scan. The cost is the operator's cost: if `⊕` is `O(c)`, the scan is `Θ(n·c)` work and `Θ(c·log n)` span — for scalar operators `c = O(1)`, for `k×k` matrices `c = O(k³)`.

### Segmented Scan

A **segmented scan** scans independently within *segments* delimited by a boolean **flag** array: a flag at position `i` marks the *start* of a new segment, resetting the running combination.

```text
  values:   [ 3   1   7 | 4   1 | 6   3 ]      ( | = segment boundaries )
  flags:      1   0   0   1   0   1   0        (1 = "start a new segment")
  incl seg:  [ 3   4  11 | 4   5 | 6   9 ]     (running ⊕ restarts at each flag)
```

The elegant trick: a segmented scan is an *ordinary* scan over a **lifted monoid** of `(flag, value)` pairs. Define
```text
  (f_a, v_a) ⊕' (f_b, v_b)  =  ( f_a OR f_b,  if f_b then v_b else v_a ⊕ v_b )
```
That is, when the right operand begins a new segment (`f_b = 1`), it discards the accumulated left value and starts fresh. One verifies `⊕'` is associative whenever `⊕` is, with identity `(0, e)`. So segmented scan inherits *both* the Hillis–Steele and Blelloch algorithms unchanged — same `Θ(n)` work, `Θ(log n)` span — by running them with `⊕'` on the pair array. Segmented scan is the backbone of irregular/nested parallelism (sparse-matrix–vector multiply, quicksort partitioning, variable-length record processing): it lets one flat scan do the work of many independent per-segment scans.

---

## Applications, Rigorously

Scan is the workhorse primitive: a great many "inherently sequential-looking" computations are secretly a scan, and inherit its `Θ(n)` work, `Θ(log n)` span. Three canonical reductions.

### Stream Compaction

**Problem.** Given an array `x[0..n−1]` and a predicate, produce a *dense* output containing exactly the elements that satisfy it, **in order**. (Filtering, but parallel.)

**The scan reduction.** The hard part is computing *where* each kept element goes. Build a 0/1 **flag** array (`1` if kept), take its **exclusive scan**, and the scan value at a kept position is exactly its destination index — because the exclusive prefix-sum of the flags counts how many kept elements lie strictly before it.

```text
  x:        [ a   b   c   d   e   f ]
  keep?:      1   0   1   1   0   1
  excl scan:  0   1   1   2   3   3      ← destination index for each kept element
  scatter:    out[0]=a  out[1]=c  out[2]=d  out[3]=f
  result:   [ a   c   d   f ]            (length = total kept = 4)
```

**Algorithm and analysis.**
1. Compute the flag array — element-wise, `Θ(n)` work, `Θ(1)` span.
2. Exclusive scan the flags — `Θ(n)` work, `Θ(log n)` span (Blelloch).
3. Scatter: each kept element `i` writes `x[i]` to `out[scan[i]]` — `Θ(n)` work, `Θ(1)` span. (The total count is the scan's last value plus the last flag.)

Total **work `Θ(n)`, span `Θ(log n)`** — a fully parallel filter, work-efficient. The same flag-scan-scatter pattern (often called *enumerate → scan → scatter*) underlies almost every data-parallel "select / partition / pack" operation.

### Radix-Sort Split

**Problem (the split primitive).** One pass of a least-significant-bit radix sort must **stably partition** the array by the current bit: all elements with bit `= 0` first (keeping their relative order), then all with bit `= 1`. Doing this in parallel, stably, is exactly two scans.

**The scan reduction.** Let `b[i]` be the current bit of element `i`. The 0-elements keep their order and pack to the front; the 1-elements pack after them.

```text
  destination of element i =
      if b[i] = 0:   (number of 0-bits among indices < i)        = excl-scan of (1 − b) at i
      if b[i] = 1:   (total 0-bits)  +  (number of 1-bits among indices < i)
                                                                  = totalZeros + excl-scan of b at i
```

Compute the exclusive scan of the "is-zero" flags (`1 − b`) for the 0-destinations, the exclusive scan of `b` for the 1-destinations, offset the latter by the total count of zeros, then scatter each element to its destination. Each step is `Θ(n)` work and `Θ(log n)` span, so one split is **work `Θ(n)`, span `Θ(log n)`**; a full radix sort over `w`-bit keys is `w` splits = `Θ(w·n)` work, `Θ(w·log n)` span. This scan-based split is the engine of parallel radix sort — the full treatment, including multi-bit digits and the histogram-scan generalization, is in [parallel sorting and merging](../03-parallel-sorting-and-merging/middle.md).

### Linear-Recurrence Evaluation

**Problem.** Evaluate a first-order linear recurrence
```text
  y_i = a_i · y_{i−1} + b_i,        y_{−1} = y_init,
```
which *looks* inherently sequential — each term needs the previous one. Yet it is a scan.

**The scan reduction.** Encode each step as an **affine map** `f_i(y) = a_i·y + b_i`. Then `y_i = (f_i ∘ f_{i−1} ∘ … ∘ f_0)(y_init)`: the answer at position `i` is the composition of the first `i+1` maps applied to the initial value. Composition of affine maps is **associative** (function composition always is) and has an identity (the map `y ↦ y`), and the composition of two affine maps is again affine:
```text
  (a₂, b₂) ∘ (a₁, b₁) = (a₂·a₁,  a₂·b₁ + b₂)        // represent f as the pair (a, b)
```
So scan the sequence of `(a_i, b_i)` pairs under this `∘` (an `O(1)` operator), giving the composed map up to each position; apply each to `y_init`. **Work `Θ(n)`, span `Θ(log n)`** — a recurrence that appears strictly serial is parallelized to logarithmic depth. This *recurrence-as-scan* trick generalizes: any fixed-order linear recurrence becomes a scan over small matrices (the companion-matrix form), and it is how parallel runtimes evaluate IIR filters, cumulative discounting, and tridiagonal solves.

---

## Code: Scans with Work/Span Counters

The theory predicts three measurable facts:

1. Hillis–Steele does `Θ(n log n)` operations; Blelloch does `Θ(n)` — the work counters confirm the `log n` gap.
2. Both have `Θ(log n)` span (`⌈log₂ n⌉` parallel rounds, doubled for Blelloch's two sweeps).
3. Stream compaction and segmented scan are *just* scans and inherit `Θ(n)` work, `Θ(log n)` span.

The code below implements both scans (verified against a sequential reference), counts `⊕`-operations as **work** and parallel rounds as **span**, then builds stream compaction and a segmented scan on top.

### Go

```go
package main

import "fmt"

// scanStats records work (total ⊕ operations) and span (parallel rounds).
type scanStats struct {
	work int
	span int
}

// hillisSteele computes the INCLUSIVE scan of x under +.
// Work Θ(n log n), span Θ(log n).
func hillisSteele(x []int) ([]int, scanStats) {
	n := len(x)
	a := make([]int, n)
	copy(a, x)
	var st scanStats
	for d := 1; d < n; d <<= 1 { // d = 2^0, 2^1, …
		st.span++ // one parallel round
		next := make([]int, n)
		copy(next, a)
		for i := d; i < n; i++ { // all i in parallel
			next[i] = a[i-d] + a[i]
			st.work++
		}
		a = next
	}
	return a, st
}

// blellochExclusive computes the EXCLUSIVE scan of x under + (identity 0),
// in place on a power-of-two-padded copy. Work Θ(n), span Θ(log n).
func blellochExclusive(x []int) ([]int, scanStats) {
	// pad to next power of two with the identity (0)
	n := 1
	for n < len(x) {
		n <<= 1
	}
	a := make([]int, n)
	copy(a, x)
	var st scanStats

	// up-sweep (reduce)
	for d := 1; d < n; d <<= 1 {
		st.span++
		for i := 0; i+2*d-1 < n; i += 2 * d { // active nodes in parallel
			a[i+2*d-1] += a[i+d-1]
			st.work++
		}
	}

	// down-sweep
	a[n-1] = 0 // seed exclusive scan with identity
	for d := n / 2; d >= 1; d >>= 1 {
		st.span++
		for i := 0; i+2*d-1 < n; i += 2 * d { // parallel
			left := a[i+d-1]
			a[i+d-1] = a[i+2*d-1]    // left child ← parent
			a[i+2*d-1] = left + a[i+2*d-1] // right child ← left-sum ⊕ parent
			st.work++
		}
	}
	return a[:len(x)], st
}

// seqInclusive is the Θ(n) sequential reference (inclusive scan).
func seqInclusive(x []int) []int {
	out := make([]int, len(x))
	acc := 0
	for i, v := range x {
		acc += v
		out[i] = acc
	}
	return out
}

// streamCompact keeps elements where keep[i] is true, in order,
// via an exclusive scan of the flags + scatter.
func streamCompact(x []int, keep []bool) []int {
	flags := make([]int, len(x))
	for i, k := range keep {
		if k {
			flags[i] = 1
		}
	}
	scan, _ := blellochExclusive(flags)
	total := scan[len(scan)-1] + flags[len(flags)-1]
	out := make([]int, total)
	for i := range x {
		if keep[i] {
			out[scan[i]] = x[i] // scatter to destination
		}
	}
	return out
}

func main() {
	x := []int{3, 1, 7, 0, 4, 1, 6, 3}

	inc, hs := hillisSteele(x)
	exc, bl := blellochExclusive(x)
	ref := seqInclusive(x)

	fmt.Println("input:            ", x)
	fmt.Println("Hillis–Steele inc:", inc, "  (== sequential:", equal(inc, ref), ")")
	fmt.Println("Blelloch exclusive:", exc)
	fmt.Printf("Hillis–Steele: work=%d  span=%d   (n log n = %d)\n",
		hs.work, hs.span, len(x)*log2(len(x)))
	fmt.Printf("Blelloch:      work=%d  span=%d   (n = %d)\n",
		bl.work, bl.span, len(x))

	// Stream compaction: keep the even values.
	keep := make([]bool, len(x))
	for i, v := range x {
		keep[i] = v%2 == 0
	}
	fmt.Println("compact (evens):  ", streamCompact(x, keep))
}

func equal(a, b []int) bool {
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
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
input:             [3 1 7 0 4 1 6 3]
Hillis–Steele inc: [3 4 11 11 15 16 22 25]   (== sequential: true )
Blelloch exclusive: [0 3 4 11 11 15 16 22]
Hillis–Steele: work=17  span=3   (n log n = 24)
Blelloch:      work=14  span=6   (n = 8)
```

The counters confirm the theory: Hillis–Steele's span is `3 = log₂ 8` but its work (`17`, the `Σ(n − 2^d)` count) scales like `n log n`; Blelloch's work is `14 = 2(n−1)` — linear, `Θ(n)` — at the cost of `6 = 2·log₂ 8` span (the two sweeps). The inclusive Hillis–Steele output matches the sequential reference, and the exclusive Blelloch output is the inclusive shifted right with `0` at the front. Stream compaction packs the evens (`0, 4, 6`) densely.

### Python

```python
def hillis_steele(x):
    """Inclusive scan under +. Work Θ(n log n), span Θ(log n)."""
    n = len(x)
    a = list(x)
    work = span = 0
    d = 1
    while d < n:
        span += 1                     # one parallel round
        nxt = list(a)
        for i in range(d, n):         # all i in parallel
            nxt[i] = a[i - d] + a[i]
            work += 1
        a = nxt
        d <<= 1
    return a, {"work": work, "span": span}


def blelloch_exclusive(x):
    """Exclusive scan under + (identity 0). Work Θ(n), span Θ(log n)."""
    n = 1
    while n < len(x):
        n <<= 1
    a = list(x) + [0] * (n - len(x))  # pad with identity
    work = span = 0

    # up-sweep (reduce)
    d = 1
    while d < n:
        span += 1
        for i in range(0, n, 2 * d):  # active nodes in parallel
            a[i + 2 * d - 1] += a[i + d - 1]
            work += 1
        d <<= 1

    # down-sweep
    a[n - 1] = 0                       # seed with identity
    d = n // 2
    while d >= 1:
        span += 1
        for i in range(0, n, 2 * d):  # parallel
            left = a[i + d - 1]
            a[i + d - 1] = a[i + 2 * d - 1]       # left child ← parent
            a[i + 2 * d - 1] = left + a[i + 2 * d - 1]  # right child ← left ⊕ parent
            work += 1
        d >>= 1
    return a[:len(x)], {"work": work, "span": span}


def seq_inclusive(x):
    out, acc = [], 0
    for v in x:
        acc += v
        out.append(acc)
    return out


def stream_compact(x, keep):
    """Keep elements where keep[i], in order, via exclusive-scan + scatter."""
    flags = [1 if k else 0 for k in keep]
    scan, _ = blelloch_exclusive(flags)
    total = scan[-1] + flags[-1]
    out = [None] * total
    for i in range(len(x)):
        if keep[i]:
            out[scan[i]] = x[i]       # scatter to destination
    return out


def segmented_scan(values, flags):
    """Inclusive segmented scan: ordinary scan over the lifted monoid."""
    # ⊕' on (flag, value) pairs; here illustrated sequentially for clarity,
    # but the same monoid plugs into Hillis–Steele / Blelloch unchanged.
    out, acc, started = [], 0, False
    for v, f in zip(values, flags):
        acc = v if f else acc + v
        out.append(acc)
        started = True
    return out


def main():
    x = [3, 1, 7, 0, 4, 1, 6, 3]

    inc, hs = hillis_steele(x)
    exc, bl = blelloch_exclusive(x)
    print("input:             ", x)
    print("Hillis–Steele inc: ", inc, " (== sequential:", inc == seq_inclusive(x), ")")
    print("Blelloch exclusive:", exc)
    print(f"Hillis–Steele: work={hs['work']}  span={hs['span']}"
          f"   (n log n = {len(x) * (len(x).bit_length() - 1)})")
    print(f"Blelloch:      work={bl['work']}  span={bl['span']}   (n = {len(x)})")

    keep = [v % 2 == 0 for v in x]
    print("compact (evens):   ", stream_compact(x, keep))

    vals = [3, 1, 7, 4, 1, 6, 3]
    flg = [1, 0, 0, 1, 0, 1, 0]
    print("segmented scan:    ", segmented_scan(vals, flg))


if __name__ == "__main__":
    main()
```

Both programs make the abstractions tangible: the **work** counters put Hillis–Steele's `Θ(n log n)` next to Blelloch's `Θ(n)` (the `log n` factor you pay for skipping the tree), the **span** counters confirm both are `Θ(log n)`, and the applications show stream compaction and segmented scan are *nothing but* a scan plus a scatter — `Θ(n)` work, `Θ(log n)` span, work-efficient.

---

## Pitfalls

- **Using Hillis–Steele where work matters.** Hillis–Steele's `Θ(n log n)` work is a factor of `log n` over the sequential `Θ(n)`. On a fixed `P`-processor machine that caps speedup over sequential at `P / log n` — you waste a `log n` fraction of your processors on redundant adds. For anything but small arrays (or a SIMD machine where the lanes are free anyway), use **Blelloch's `Θ(n)`-work scan**. "Short span" is worthless if you bought it by inflating the work.

- **Forgetting the operator must be associative.** Both algorithms re-parenthesize the combinations (that is the whole point of going parallel). If `⊕` is not associative — floating-point addition is *not* exactly associative, subtraction and division are not associative at all — the parallel result will differ from the sequential left-to-right result. For floats, accept the reordering (and its rounding differences) deliberately, or use a compensated/pairwise summation; never assume bit-identical output to a serial loop.

- **In-place index arithmetic off-by-one (Blelloch).** The up-sweep writes the *right* child `a[i + 2^{d+1} − 1]` from the *left* sibling `a[i + 2^d − 1]`; the down-sweep **swaps then combines** at those same two slots. Transposing the two indices, or doing the combine before the swap, silently corrupts the tree. Walk the [8-element trace](#a-full-walkthrough-on-8-elements) on paper before trusting an implementation, and verify against a sequential reference.

- **Inclusive/exclusive confusion.** Blelloch emits an **exclusive** scan (position 0 is the identity); Hillis–Steele emits an **inclusive** one (position 0 is `x[0]`). Converting requires the right shift direction and remembering `exc[0] = e`, not `x[0]`. The fast check: exclusive scans start with the identity, inclusive scans start with `x[0]` — if position 0 is wrong, your conventions are crossed.

- **Race within a Hillis–Steele round.** Each round must read the *previous* round's array and write a fresh one; updating `a[i]` in place while a later `a[j]` still needs the old `a[i]` gives wrong answers. Use a double buffer (as the code does) or prove your in-place order is safe. This is the parallel-update discipline the [round-invariant proof](#correctness-the-round-invariant) quietly assumes.

- **Padding non-power-of-two inputs with the wrong value.** Blelloch's tree wants `n` a power of two; pad with the **identity** `e` (`0` for sum, `−∞` for max, `1` for product), never with zeros for a max-scan or with garbage. Padding with a non-identity element changes every prefix that reaches the padding.

- **Assuming scan beats `Ω(log n)` span.** No scan can have span `o(log n)` — the [last output depends on all `n` inputs](#the-lower-bound-ωlog-n-span), which forces a depth-`log n` fan-in. If an analysis claims `O(1)` span on EREW/CREW, it has a bug. (Concurrent-write CRCW can shortcut *reductions*, but scan still needs the prefix structure.)

---

## Summary

- **Scan** computes all running combinations of `x_0, …, x_{n−1}` under an associative `⊕`. It needs a **[monoid](#the-monoid)** `(⊕, e)`: associativity (mandatory — it licenses the parallel re-parenthesization) and an identity (the empty/exclusive prefix). Commutativity is *not* required; matrices and function composition scan fine. **Inclusive** `y_i` includes `x_i`; **exclusive** `y_i` excludes it with `y_0 = e`.

- **Hillis–Steele** is the doubling scan: `⌈log n⌉` rounds, each adding the neighbor `2^d` left. *Invariant:* after round `d`, position `i` holds the `⊕` of the `2^{d+1}`-wide window ending at `i` (proved by induction, using associativity to merge two adjacent windows). It is **inclusive**, with **work `Θ(n log n)`, span `Θ(log n)`** — span-optimal but **not work-efficient**.

- **Blelloch** is the work-efficient scan: an **up-sweep** (in-place reduction tree, root ← grand total) then a **down-sweep** (root ← identity, push values down: left child ← parent, right child ← left-sum ⊕ parent). It is **exclusive**, **in place**, with **work `Θ(n)`, span `Θ(log n)`** — **work-efficient**. *This is the scan to know.* (Worked in full on an 8-element array.)

- **Lower bound:** any scan has span `Ω(log n)` — the last output depends on all `n` inputs, and binary fan-in converges no faster than a depth-`log n` tree. With the trivial `Ω(n)` read bound, **Blelloch is span-optimal *and* work-optimal**.

- **Variations:** inclusive ⇄ exclusive is a `Θ(n)`/`Θ(1)` shift (mind `exc[0] = e`); the same code scans **any monoid** (max, min, OR, ×, matrices); **segmented scan** is an ordinary scan over a lifted `(flag, value)` monoid, giving per-segment scans in one pass.

- **Applications** are scans in disguise, each **work `Θ(n)`, span `Θ(log n)`**: **stream compaction** (flag → exclusive scan → scatter), the **radix-sort split** (two flag scans give stable 0/1 destinations — see [parallel sorting and merging](../03-parallel-sorting-and-merging/middle.md)), and **linear-recurrence evaluation** (compose affine maps `(a, b)` under their associative product).

Revisit [junior](./junior.md) for the doubling intuition and application gallery; advance to [senior](./senior.md) for the deeper treatment (Brent–Kung vs Kogge–Stone trade-offs, multi-level/blocked scans for the memory hierarchy, and GPU warp-level scan). Continue to [parallel reduce and map](../04-parallel-reduce-and-map/middle.md) for the building-block primitives the up-sweep reuses, to [parallel sorting and merging](../03-parallel-sorting-and-merging/middle.md) for the scan-based radix split, and back to the [work–span model](../01-models-pram-work-span/middle.md) for the cost framework underpinning every bound here.
