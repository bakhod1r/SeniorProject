# Linear Search — Professional Level

## Table of Contents

1. [Formal Definition](#formal-definition)
2. [Correctness Proof](#correctness-proof)
3. [Expected Comparisons — Probabilistic Analysis](#expected-comparisons-probabilistic-analysis)
4. [Lower Bound for Unordered Search](#lower-bound-for-unordered-search)
5. [Cache-Aware Complexity (External Memory Model)](#cache-aware-complexity-external-memory-model)
6. [Parallel Complexity (PRAM)](#parallel-complexity-pram)
7. [Information-Theoretic Bound](#information-theoretic-bound)
8. [Comparison to Other Search Algorithms](#comparison-to-other-search-algorithms)
9. [Summary](#summary)

---

## Formal Definition

**Input:**
- An array A of n elements (1-indexed for the proof; 0-indexed for code).
- A target value t.
- A comparison predicate `eq: U × U → {0, 1}` where U is the universe of values.

**Output:**
- An index i ∈ {1, …, n} such that `eq(A[i], t) = 1`, **and** for all j < i, `eq(A[j], t) = 0`.
- The sentinel value 0 (or -1 in 0-indexed conventions) if no such index exists.

**Algorithm:**
```
LINEAR-SEARCH(A, t):
  for i = 1 to n:
    if A[i] == t:
      return i
  return -1
```

**Complexity classes:**
- **Time:** Θ(n) worst case, O(n) average and best.
- **Space:** Θ(1) auxiliary (one loop counter).
- **Comparisons:** ≤ n in the worst case; exactly n if t ∉ A.

---

## Correctness Proof

We prove correctness via **loop invariant**:

> **Invariant (P):** Before the i-th iteration, for all j ∈ {1, …, i-1}, A[j] ≠ t.

**Initialization (i = 1):**
The set {1, …, 0} is empty, so the invariant holds vacuously. ✓

**Maintenance:**
Suppose P holds before the i-th iteration. The loop body checks `A[i] == t`.
- If true, the algorithm returns i. By the invariant, all positions before i are non-matches; position i is a match. So the returned index satisfies the postcondition: it is the **first** match.
- If false, A[i] ≠ t. Combined with P, we now have A[j] ≠ t for all j ∈ {1, …, i}. The invariant holds at the start of iteration i+1. ✓

**Termination:**
The loop runs at most n iterations (i goes from 1 to n). Each iteration either returns or increments i. After iteration n, the loop exits and the algorithm returns -1. By the invariant, A[j] ≠ t for all j ∈ {1, …, n}, so t ∉ A and -1 is correct. ✓

**QED.** The algorithm returns the first index where A[i] = t, or -1 if no such index exists.

---

## Expected Comparisons — Probabilistic Analysis

### Case A: Target Always Present, Uniformly Distributed Position

Assume the target t is in A at a position chosen uniformly at random from {1, …, n}.

Let X = number of comparisons performed. If t is at position k, X = k.

**Expected value:**
```
E[X] = Σ_{k=1}^{n} (1/n) · k
     = (1/n) · n(n+1)/2
     = (n+1)/2
```

So E[X] ≈ n/2 + 0.5 ≈ **n/2** for large n.

**Variance:**
```
Var[X] = E[X²] - (E[X])²
       = (1/n) · Σ k² - ((n+1)/2)²
       = (1/n) · n(n+1)(2n+1)/6 - (n+1)²/4
       = (n+1)(2n+1)/6 - (n+1)²/4
       = (n+1)[(2n+1)/6 - (n+1)/4]
       = (n+1)[(4n+2 - 3n - 3)/12]
       = (n+1)(n-1)/12
       = (n² - 1)/12
```

Standard deviation σ ≈ n/√12 ≈ 0.289n.

So expected comparisons is n/2, with standard deviation ~0.29n. The distribution is uniform on {1, …, n}, not concentrated.

### Case B: Target Possibly Absent

Let p = probability target is present in A; assume position uniform when present.

**E[X] = p · (n+1)/2 + (1-p) · n**

For p = 1: E[X] = (n+1)/2 ≈ n/2.
For p = 0: E[X] = n (always full scan).
For p = 0.5: E[X] = (n+1)/4 + n/2 = (3n+1)/4 ≈ **3n/4**.

This is why "absent target" is the **practical worst case** — and why production systems often pre-check with a Bloom filter or hash set.

### Case C: Skewed Distribution (Self-Organizing)

If element at position k is queried with probability p_k, and the array is fixed in some order:

```
E[X] = Σ_{k=1}^{n} k · p_k
```

This is minimized when high-frequency elements are at low indices. The optimal arrangement is **decreasing-frequency order**. This is the foundational result behind **move-to-front** and **transpose** heuristics:

- For Zipfian distribution (p_k ∝ 1/k), MTF achieves E[X] = O(log n) instead of Θ(n).
- For uniform distribution, MTF gives no improvement (E[X] = n/2 either way).

---

## Lower Bound for Unordered Search

**Theorem (Lower Bound):** Any **comparison-based** algorithm that searches an unordered array of n elements for a target t requires Ω(n) comparisons in the worst case.

**Proof (adversary argument):**

Suppose algorithm A makes only k < n comparisons. We construct an adversary-controlled array where:

1. The adversary delays committing to A's contents.
2. For each of A's queries "is A[i] == t?", the adversary answers **no** (claims A[i] ≠ t).
3. After k queries, at least one position j ∈ {1, …, n} has not been compared. The adversary places t at position j.
4. But A has not inspected position j and must return -1 (or guess) — wrong answer.

Therefore, any correct algorithm must make at least n comparisons in the worst case. ∎

**Implication:** Linear search is **asymptotically optimal** for searching unordered arrays. You cannot do better than O(n) without **preprocessing** (sorting, hashing) or **structural assumptions** (sortedness, sparsity).

This is a profoundly important result: it tells you that for raw unordered data, the simple algorithm is the best algorithm.

### What Doesn't Apply

The Ω(n) lower bound is for **comparison-based** algorithms. It can be beaten by:
- **Hashing** — uses arithmetic, not just comparisons. Achieves O(1) average.
- **Bit-level tricks** — for small-domain values (e.g., bitmaps). Achieves O(n/word_size).
- **Quantum algorithms** — Grover's algorithm achieves O(√n).
- **Algebraic structure** — if values satisfy XOR / arithmetic identities, e.g. "find missing number in 1..n."

---

## Cache-Aware Complexity (External Memory Model)

### The Model

Aggarwal & Vitter's **external memory model** (1988) parameterizes:
- M = size of fast memory (cache or RAM).
- B = block (cache line / page) size.
- N = total dataset size.

Cost is measured in **block transfers** between fast and slow memory.

### Linear Search in EM Model

A linear scan reads each block exactly once. Block reads:

```
T_io(linear_search) = ⌈n / B⌉ = O(n / B)
```

For n = 10⁶ ints (4 MB), B = 16 ints (64-byte cache line), this is 62,500 cache-line reads. At ~10 ns per cache miss, that's 625 µs — but the hardware prefetcher and sequential access pattern reduce this to near-DRAM bandwidth (~10-20 GB/s), giving actual throughput closer to 200-400 µs.

### Compare to Binary Search

Binary search jumps between widely separated locations. For n > M, each step likely costs a cache miss:

```
T_io(binary_search) = O(log_2(n / B)) cache misses near the top of the tree,
                      then settling into block-local access for the last log_2(B) levels.
                    ≈ log_2(n) cache misses worst case
```

For n = 10⁶, that's ~20 cache misses per query, vs ~62500 for linear search. **Binary search is ~3000× more cache-efficient** for large n.

But for **small** n (n < M / B), the linear scan fits in cache after one pass, and subsequent searches hit cache. In hot-cache regimes, linear search's perfect access pattern wins by constant factors.

### Cache-Oblivious Algorithms

Linear search is naturally **cache-oblivious**: it works optimally for any cache hierarchy without parameter tuning. This makes it a great primitive for cache-oblivious data structures (e.g., B-tree leaves, van Emde Boas layouts).

---

## Parallel Complexity (PRAM)

### The PRAM Model

P processors, shared memory, unit-cost memory access. We measure **parallel time** T_p(n) and **work** W_p(n) = p · T_p(n).

### Parallel Linear Search

**Algorithm:** Partition A into p chunks of size n/p. Each processor searches its chunk. First match wins; communicate via a shared "found" flag.

**Parallel time:**
```
T_p(n) = O(n / p)        — each processor scans its chunk
       + O(log p)        — reduction to find the global minimum index
       = O(n / p + log p)
```

For p = O(n / log n), this is O(log n). For p = n (one processor per element), parallel time is O(1) for the search itself, but O(log n) for the reduction.

**Work:**
```
W_p(n) = p · T_p(n) = O(n + p · log p)
```

For p ≤ n / log n, work is O(n) — **work-optimal** (no asymptotic overhead vs sequential).

### Speedup

Theoretical speedup S(p) = T_1(n) / T_p(n) = n / (n/p + log p) ≈ p for p ≪ n.

**Practical speedup** is limited by:
- **Memory bandwidth** — once all cores saturate the memory bus, adding cores doesn't help.
- **Coordination overhead** — atomic ops on the "found" flag, branch mispredictions.
- **Load imbalance** — if the target is in chunk 0, that worker finishes before others.

Empirical: 4-8× speedup is common; 16-64× speedup requires NUMA-aware partitioning and careful contention management.

### Work-Span Tradeoff (Cilk Model)

Span (critical path length) for parallel linear search is O(log n) — the depth of the reduction tree. So parallelism is:
```
P = W / Span = O(n) / O(log n) = O(n / log n)
```

This bounds the **maximum useful parallelism**: for n = 10⁶, you can productively use up to ~50,000 processors before the log-n reduction becomes the bottleneck.

### Distributed Linear Search

In a distributed setting (data partitioned across machines), the cost model adds **network latency**:

```
T = O(n / (p · B)) + O(α + β · log p)
       (computation)    (coordination + reduction)
```

where α is per-message latency (~µs in a datacenter, ~ms across continents) and β is per-byte cost. For globally distributed search, the constant α dominates and a 100-machine search may have ~ms-level overhead just for coordination.

---

## Information-Theoretic Bound

### Decision Tree Lower Bound

Any deterministic comparison-based search algorithm corresponds to a **decision tree**: each internal node is a comparison, each leaf is an answer (an index or "not found").

For a search problem with n+1 possible outputs (positions 1..n, or "not found"), the decision tree has at least n+1 leaves. The minimum height of a binary tree with n+1 leaves is ⌈log₂(n+1)⌉.

So **binary search is information-theoretically optimal** for sorted arrays: O(log n) comparisons.

For **unsorted** arrays, the decision tree must distinguish not just "where is t?" but also "is t at position k vs position k+1 vs ..." with no a priori ordering. The adversary argument above shows this requires Ω(n) — **strictly worse** than the log n bound for sorted data.

### Probabilistic Algorithms

Randomization doesn't help for unordered search: even with random comparison order, the expected number of comparisons to find a target uniformly distributed in n positions is (n+1)/2, and the worst case remains Θ(n).

### Quantum Lower Bound

Grover's algorithm achieves O(√n) using quantum superposition (probing all positions simultaneously, then amplifying matching states). Bennett, Bernstein, Brassard & Vazirani (1997) proved this is **tight**: no quantum algorithm can search an unstructured space in fewer than Ω(√n) queries. Even quantum can't get to O(log n) for unsorted data.

---

## Comparison to Other Search Algorithms

| Algorithm | Time | Space | Preconditions | Notes |
|-----------|------|-------|---------------|-------|
| **Linear search** | Θ(n) | O(1) | None | Cache-friendly, branch-predictable |
| **Binary search** | Θ(log n) | O(1) | Sorted | Cache-unfriendly for large n |
| **Jump search** | Θ(√n) | O(1) | Sorted | Fewer cache misses than binary for huge arrays |
| **Interpolation search** | O(log log n) avg / O(n) worst | O(1) | Sorted, uniform distribution | Beats binary on uniform data |
| **Hash table** | O(1) avg / O(n) worst | O(n) | Hash function, build cost | Best for repeated lookups |
| **BST search** | O(log n) avg, O(n) worst | O(n) | Built tree | Self-balancing variants (AVL, RB) for guarantees |
| **Skip list search** | O(log n) avg | O(n) | Probabilistic structure | Lock-free variants exist |
| **Trie search** | O(k) (k = key length) | O(N · k) | Built trie | Best for string keys with shared prefixes |
| **Bloom filter check** | O(k) | O(m bits) | Built filter | False positives, no false negatives |
| **Grover (quantum)** | O(√n) | O(log n) qubits | Quantum hardware | Theoretical |

### Key Takeaways

1. **No comparison-based algorithm beats Θ(n) without preprocessing.** Sorting (Θ(n log n)) or hashing (Θ(n)) is the fundamental cost of getting sub-linear search.

2. **Linear search has the best cache behavior** of any search algorithm. For data already in or near cache, it's hard to beat.

3. **Information theory and parallelism set hard limits.** Linear search is Θ(n) sequential, Θ(n/p + log p) parallel, and hits a √n quantum floor. These are not engineering choices — they are mathematical bounds.

---

## Summary

Linear search is the **asymptotic baseline** for unstructured search:

- **Worst-case Θ(n)** — provably optimal for unordered data (adversary argument).
- **Average Θ(n/2)** if target uniformly placed; Θ(3n/4) with 50% miss rate.
- **External memory** O(n/B) — perfect sequential access pattern.
- **Parallel** O(n/p + log p) — work-optimal for p ≤ n / log n.
- **Information-theoretically tight** for unordered data; can only be beaten by structural preprocessing (sort → log n; hash → 1) or quantum (√n).

Its theoretical simplicity belies its practical importance: it is the algorithm against which every other search is measured, and the algorithm that wins by default whenever preprocessing is impossible or wasteful.
