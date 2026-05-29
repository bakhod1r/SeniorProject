# Counting Sort — Mathematical Foundations and Complexity Theory

## Table of Contents

1. [Formal Definition](#formal-definition)
2. [Correctness Proof — Loop Invariants](#correctness-proof)
3. [Proof of Stability](#proof-of-stability)
4. [Lower Bound Context — Why Counting Sort Beats Ω(n log n)](#lower-bound-context)
5. [I/O and Cache-Oblivious Analysis](#cache-oblivious-analysis)
6. [Parallel Work-Span Analysis](#parallel-work-span-analysis)
7. [Comparison with Alternatives](#comparison-with-alternatives)
8. [Summary](#summary)

---

## Formal Definition

```text
Definition (Counting Sort). Let A[0..n-1] be an array of n integer keys
drawn from the universe U = {0, 1, ..., k-1}. Counting Sort is the
algorithm CS(A, k) -> B that produces B[0..n-1] satisfying:

  (i)  B is a permutation of A (multiset equality).
  (ii) For all 0 <= i < j < n: B[i] <= B[j]  (sorted ascending).
  (iii) Stability: for all i < j with A[i] == A[j], the element at A[i]
        appears at an index strictly less than that of A[j] in B.

The algorithm uses an auxiliary count array C[0..k-1] and an output array
B[0..n-1], runs in three straight-line passes, and performs zero
comparisons between input keys.
```

The pseudocode:

```text
CS(A, k):
  C <- zero array of length k
  B <- uninitialised array of length n
  for i in 0..n-1:       C[A[i]] += 1                # Phase 1 (tally)
  for v in 1..k-1:       C[v]   += C[v-1]            # Phase 2 (prefix sum)
  for i in n-1..0 step -1:                            # Phase 3 (placement)
    v <- A[i]
    C[v] -= 1
    B[C[v]] <- A[i]
  return B
```

---

## Correctness Proof — Loop Invariants

We prove correctness by establishing invariants for each phase.

### Phase 1 — Tally Invariant

```text
Invariant P1(i): At the start of iteration i (0 <= i <= n) of Phase 1,
                 for every v in [0, k):
                 C[v] == |{j in [0, i) : A[j] == v}|.

Base case (i=0):  C is all zeros and the set on the right is empty. P1(0) holds.

Inductive step:   Assume P1(i) for some i < n.
                  Iteration i executes C[A[i]] += 1.
                  Let w = A[i]. After the increment:
                    - For v != w: C[v] unchanged; the right-hand-side set
                      gains no member because we required A[j] == v != w.
                    - For v == w: C[w] increases by 1; the set gains element
                      A[i] = w.
                  Hence P1(i+1) holds.

Termination:      Loop runs exactly n iterations and terminates.

Postcondition:    P1(n) holds: for every v, C[v] = |{j in [0, n) : A[j] == v}|
                  = number of occurrences of v in A.
```

### Phase 2 — Prefix Sum Invariant

```text
Invariant P2(v): At the start of iteration v (1 <= v <= k) of Phase 2,
                 for every u < v:
                 C[u] == |{j in [0, n) : A[j] <= u}|.

Base case (v=1):  C[0] still equals (occurrences of 0 in A) = |{j: A[j] <= 0}|.

Inductive step:   Assume P2(v).
                  Iteration v executes C[v] += C[v-1].
                  Before: C[v] = (occurrences of v in A);
                          C[v-1] = |{j: A[j] <= v-1}| by P2(v).
                  After:  C[v] = (occurrences of v) + |{j: A[j] <= v-1}|
                              = |{j: A[j] == v}| + |{j: A[j] <= v-1}|
                              = |{j: A[j] <= v}|.
                  Other entries unchanged. P2(v+1) holds.

Termination:      Loop runs k-1 iterations and terminates.

Postcondition:    P2(k) holds: for every v in [0, k):
                  C[v] = |{j: A[j] <= v}|.
```

### Phase 3 — Placement Invariant

After Phase 2, define `T[v] = |{j: A[j] <= v}|`. Note `T[v] - T[v-1]` = number of `v`s in `A`.

```text
Invariant P3(i): Just before iteration i (n-1 >= i >= 0) of Phase 3,
                 for every v in [0, k):
                 C[v] == T[v] - |{j in (i, n) : A[j] == v}|.

Base case (i=n-1): The set on the right is empty (j > n-1 impossible).
                   So C[v] = T[v], which is what Phase 2 left.

Inductive step:    Assume P3(i+1). Iteration (i+1) executes:
                     v <- A[i+1]
                     C[v] -= 1
                     B[C[v]] <- A[i+1]
                   Let w = A[i+1].
                   For u != w: C[u] unchanged; the set
                     {j in (i+1, n) : A[j] == u} unchanged when moving to i.
                   For u == w: C[w] decreases by 1; the set
                     {j in (i, n) : A[j] == w} = {j in (i+1, n) : A[j] == w} ∪ {i+1}
                     gains exactly one element.
                   Both sides change by 1 in the same direction. P3(i) holds.

Termination:       Loop runs n iterations (from i=n-1 down to i=0) and terminates.

Postcondition:     P3(-1) holds: for every v,
                   C[v] = T[v] - |{j in (-1, n) : A[j] == v}|
                        = T[v] - (occurrences of v)
                        = T[v-1] (or 0 if v=0).

  At every iteration where the algorithm wrote B[C[v]] <- A[i+1] with w=v=A[i+1],
  C[v] was decreased BEFORE the write. So the write happened at index
  C[v]_old - 1 in B. By P3, C[v]_old = T[v] - |{j > i+1 : A[j] == v}|,
  so the write went to position T[v] - 1 - |{j > i+1 : A[j] == v}|.

  As i decreases from n-1 to 0, the rightmost occurrence of each v lands
  at position T[v] - 1; the next at T[v] - 2; etc.
  Hence B[T[v-1] .. T[v] - 1] is filled with exactly the occurrences of v.
```

### Sortedness and Permutation

Phase 3's postcondition shows every occurrence of value `v` lands in the range `[T[v-1], T[v])`. Because `T` is non-decreasing, these ranges are disjoint and their union is `[0, n)`. Therefore:

- (i) `B` is a permutation of `A` (each element written exactly once, indices cover `[0, n)`).
- (ii) `B` is sorted: any two entries `B[p] = u`, `B[q] = w` with `p < q` satisfy `u <= w`, because they fall into adjacent / nested ranges with `u <= w`.

**Q.E.D. — Counting Sort correctly sorts A in O(n + k) time.**

---

## Proof of Stability

```text
Claim: Counting Sort with right-to-left iteration in Phase 3 is stable.

Stability statement: For every pair (i, j) with i < j and A[i] == A[j],
                     the output position of A[i] is strictly less than
                     that of A[j].

Proof:  Let v = A[i] = A[j].
        In Phase 3, iteration j runs BEFORE iteration i (because we go
        from index n-1 down to 0 and j > i).

        Let C_j denote the value of C[v] right BEFORE iteration j executes
        its decrement. By invariant P3, after iteration j:
          C[v] becomes C_j - 1, and A[j] is written to B[C_j - 1].

        Between iteration j and iteration i, we may execute more
        decrement+write steps for value v, each at strictly smaller indices.
        Let p = number of such steps. Then right before iteration i:
          C[v] = C_j - 1 - p.

        Iteration i decrements C[v] to C_j - 2 - p and writes A[i] to
        position C_j - 2 - p.

        Compare: A[i] -> position C_j - 2 - p,
                 A[j] -> position C_j - 1.
        Since p >= 0:  C_j - 2 - p <= C_j - 2 < C_j - 1.
        So A[i]'s output position is strictly less than A[j]'s.

        Q.E.D.
```

### Counter-Example: Left-to-Right Loses Stability

If Phase 3 ran from `i = 0` upward, the leftmost equal element would land at the rightmost slot of value `v` and the rightmost at the leftmost slot — reversing relative order. The output is still sorted, but not stable. This is the formal reason **right-to-left iteration is a correctness requirement, not an optimisation**, when Counting Sort serves as the inner pass of Radix Sort.

---

## Lower Bound Context

### The Comparison-Model Lower Bound

```text
Theorem (Ω(n log n) for comparison sorts):
  Any deterministic comparison-based sorting algorithm has worst-case
  running time Ω(n log n) on inputs of n distinct keys.

Proof sketch (decision tree):
  A comparison sort can be modelled as a binary decision tree whose
  internal nodes are key comparisons and whose leaves are output
  permutations. For n distinct keys there are n! possible orderings,
  so the tree must have at least n! leaves.
  A binary tree with L leaves has depth >= log2(L).
  Therefore depth >= log2(n!) = Θ(n log n).
  The depth equals the worst-case number of comparisons.
  Q.E.D.
```

### Why Counting Sort Is Not Bounded by Ω(n log n)

Counting Sort never compares two input keys. Its decision is "increment `C[v]`" where `v = A[i]` — a constant-time read of the key followed by a constant-time array access by index. The decision tree model does not apply because the algorithm is not in the comparison model; it is in the **RAM model with O(1) array access**.

```text
Formally, Counting Sort lives in the Word-RAM model with word size
w >= log2(max(n, k)) bits. Its running time is O(n + k) word-RAM
operations, each of which is O(1). The comparison-model lower bound
says nothing about word-RAM algorithms that use keys as addresses.
```

### Distribution-Sort Lower Bound

There is a related lower bound that **does** apply: any algorithm that allocates one slot per possible key must use Ω(k) memory. This is why Counting Sort uses O(n + k) space — the `k` term is unavoidable in the model where keys are used as indices.

---

## Cache-Oblivious Analysis

### Naive I/O Complexity

```text
Model:  External-Memory model (Aggarwal-Vitter)
        N = problem size in elements, M = cache size, B = block size.

Counting Sort cache-oblivious I/Os:
  Phase 1 (tally):  read A linearly -> O(N/B) reads;
                    write C at scattered positions -> O(N/B + k/B) writes
                    when C fits in cache, else O(N) when C is larger.

  Phase 2 (scan):   scan C once -> O(k/B).

  Phase 3 (place):  read A in reverse -> O(N/B);
                    write B at positions dictated by C -> O(N/B + k/B)
                    when both arrays fit in M; else O(N) random I/Os.

Total when C and B fit in M:  O(N/B + k/B).
Total when k > M:             O(N) -- one I/O per element.
```

The breakdown: Counting Sort is I/O-optimal as long as the count array `C` fits in cache. When `C` spills out, each `C[A[i]]++` operation in Phase 1 misses cache and pays a full block transfer — O(1) per element rather than O(1/B). This is the I/O-complexity reason Radix Sort is preferred for large `k`.

### Comparison with Sorting Lower Bound

```text
External-memory comparison-sort lower bound (Aggarwal-Vitter):
  Sorting N elements requires Omega((N/B) * log_{M/B}(N/B)) I/Os.

Counting Sort I/Os when C fits in M: O(N/B + k/B).
For k <= O(N), this is O(N/B), which beats the comparison-sort lower
bound by a factor of log_{M/B}(N/B). Linear-time I/O behaviour.
```

This is the I/O analogue of Counting Sort's RAM-model linear-time advantage: in both models, it strictly beats comparison sorts when `k = O(n)` (or `k = O(N)`).

---

## Parallel Work-Span Analysis

```text
Parallel Counting Sort (PRAM CREW model, p processors):

Phase 1 (parallel tally):
  Partition A into p slices of size n/p each.
  Each processor builds a local count array of size k.
  Work:  W1 = O(n + p*k)
  Span:  S1 = O(n/p + k)        -- per-processor pass + local-array init

Phase 2 (combine + prefix sum):
  Sum p local count arrays column-wise.
  Then run a work-efficient parallel prefix sum (Blelloch scan).
  Work:  W2 = O(p*k + k) = O(p*k)
  Span:  S2 = O(log p + log k)

Phase 3 (parallel scatter):
  Each processor scatters its slice to disjoint output ranges using
  per-processor offsets derived from the global prefix sum.
  Work:  W3 = O(n + p*k)        -- compute per-processor offsets + scatter
  Span:  S3 = O(n/p + k)

Totals:
  Total work:  W = O(n + p*k)
  Total span:  S = O(n/p + k + log p)
  Parallelism (W/S) = O((n + p*k) / (n/p + k + log p))

When k is constant and n >> p:
  W ~ O(n), S ~ O(n/p), parallelism ~ O(p) -- linear speedup.

When k > n/p:
  Span is dominated by the k term in Phase 1 and Phase 3 (each thread
  must process its k-sized local count array). Diminishing returns.
```

### Span-Optimal Variants

Using **segmented parallel prefix sums** (one segment per output slot for value `v`), the span of Phase 3 can be reduced to `O(log n + log k)`. This is the regime GPU implementations operate in: thousands of threads, tiny `k` per pass (8-bit or 4-bit radix), span ≈ log n.

```text
GPU Counting Sort (segmented scan, p = O(n) threads, k = 256):
  W = O(n)
  S = O(log n)
  Parallelism = O(n / log n)

This is span-optimal -- you cannot sort n elements in less than
Omega(log n) span on a PRAM, because the final output position of any
element depends on a count summed over the whole input.
```

---

## Comparison with Alternatives

| Attribute | Counting Sort | Merge Sort | Quick Sort | Radix Sort (LSD) |
|-----------|--------------|------------|------------|------------------|
| Worst-case time | Θ(n + k) | Θ(n log n) | Θ(n²) (vanilla) | Θ(d · (n + b)) |
| Average time | Θ(n + k) | Θ(n log n) | Θ(n log n) | Θ(d · (n + b)) |
| Auxiliary space | Θ(n + k) | Θ(n) | Θ(log n) | Θ(n + b) |
| Cache I/Os (C in M) | O(N/B + k/B) | O((N/B) log_{M/B}(N/B)) | O((N/B) log_{M/B}(N/B)) | O(d · N/B) |
| Comparisons | 0 | Θ(n log n) | Θ(n log n) avg | 0 |
| Deterministic | Yes | Yes | No (randomised) | Yes |
| Stable | Yes (right-to-left) | Yes | Typically no | Yes (inherits Counting Sort stability) |
| Parallel span | O(log n + k) | O(log² n) | O(log² n) typical | O(d log n) |
| Beats Ω(n log n) | Yes (RAM model) | No | No | Yes (RAM model) |

### When Each Wins (Formal)

- **Counting Sort:** k = O(n) and word size `w = O(log n)`. Strict linear time.
- **Merge Sort:** general orderable keys with comparison function in O(1). Worst-case O(n log n).
- **Quick Sort:** randomised, average O(n log n), excellent constant factors and cache behaviour.
- **Radix Sort:** keys are `d`-digit base-`b` integers with `b = O(n)` per pass. Total `O(d(n + b))` = `O(n)` when `d = O(1)`.

---

## Summary

At professional level, Counting Sort is the worked example for several deep ideas:

1. **The comparison-model lower bound is about the model, not about sorting.** Counting Sort proves it constructively: a non-comparison algorithm trivially beats Ω(n log n) by using keys as array indices.
2. **Stability is provable, not assumed.** The right-to-left placement loop preserves the relative order of equal keys through an inductive argument on the count array — and this is exactly the property that makes Radix Sort correct.
3. **I/O-complexity tells when Counting Sort actually wins.** It is I/O-optimal as long as the count array fits in cache. Beyond that point, Radix Sort's repeated small-cache-friendly passes dominate.
4. **Parallelism is span-optimal.** The PRAM work-span analysis gives W = O(n + pk), S = O(n/p + k + log p), with linear parallelism when k = O(n). GPU implementations push the span down to O(log n) with segmented scans.
5. **Correctness is proven by three short loop invariants** — one per phase. The proofs are clean, finitistic, and serve as the simplest illustration of the loop-invariant proof technique for sorting algorithms.

Counting Sort's significance in complexity theory is not its algorithmic novelty (it predates Quick Sort) but its role as the canonical separator between the comparison model and the word-RAM model. Every formal treatment of sorting devotes a chapter to it for that reason.
