# Set (Set ADT) — Mathematical Foundations and Complexity Theory

## Table of Contents

1. [Formal Definition](#formal-definition)
2. [Amortized Analysis of HashSet](#amortized-analysis-of-hashset)
3. [Comparison-Model Lower Bound for Sorted Sets](#comparison-model-lower-bound-for-sorted-sets)
4. [Cell-Probe Lower Bound for Dictionary](#cell-probe-lower-bound-for-dictionary)
5. [External-Memory (I/O) Complexity](#external-memory-io-complexity)
6. [Parallel and Concurrent Set Operations](#parallel-and-concurrent-set-operations)
7. [Comparison Across Models](#comparison-across-models)
8. [Summary](#summary)

---

## Formal Definition

A **Set ADT** over a universe `U` is a tuple `(S, op)` where `S ⊆ U` and `op` is the operation alphabet:

```text
op = { add(x), remove(x), contains(x), size(), iterate(),
       union(T), intersect(T), difference(T) }
```

**Invariant I(S)**: `∀ x ∈ U. (x ∈ S) ↔ (last add(x) postdates last remove(x))`.

**Algebraic properties** (Boolean algebra over the power set 2^U):
- Identity:        `S ∪ ∅ = S`,   `S ∩ U = S`
- Idempotence:     `S ∪ S = S`,   `S ∩ S = S`
- Commutativity:   `S ∪ T = T ∪ S`,   `S ∩ T = T ∩ S`
- Associativity:   `(S ∪ T) ∪ V = S ∪ (T ∪ V)`
- Distributivity:  `S ∩ (T ∪ V) = (S ∩ T) ∪ (S ∩ V)`
- De Morgan:       `(S ∪ T)^c = S^c ∩ T^c`,   `(S ∩ T)^c = S^c ∪ T^c`

Any implementation that respects these laws on its public interface is a valid set, regardless of internal representation.

---

## Amortized Analysis of HashSet

The HashSet's headline guarantee — O(1) `add` — is **amortized**, not worst-case. We prove it for the standard *doubling-on-overflow* policy.

### Setup

- Table capacity `c`. Threshold `α_max = 3/4`. When `size + 1 > α_max · c`, we double: `c' = 2c` and rehash every element.
- Single `add` cost without resize: `O(1)` (one hash, one chain insert).
- Single `add` cost during resize: `O(c)` to rehash all `c · α_max = (3/4)c` existing elements into the new table of size `2c`.

### Aggregate Method

Let `n` operations be performed on an initially empty set with capacity `c₀ = 1`. The table doubles when crossing thresholds at sizes `1, 2, 4, 8, ..., 2^k` where `2^k ≤ n`. The total rehash work is:

```text
T_rehash(n) = Σ_{i=0}^{k} 2^i  ≤  2^{k+1} - 1  ≤  2n
```

Plus `n` non-resize work (`O(1)` each). Total:

```text
T_total(n) ≤ 3n   ⇒   T_amortized = O(1) per operation.   ∎
```

### Potential Method

Define the potential function:

```text
Φ(D) = 2 · ( size(D) - (c(D) / 2) )
```

Φ starts at 0, never becomes negative when size ≥ c/2, and grows by 2 with each add (until next resize).

**Non-resize add**: actual cost `c_i = 1`. ΔΦ = 2. Amortized = `1 + 2 = 3`.

**Resize add**: actual cost `c_i = 1 + (3/4)c` (insert plus rehash). Before resize, size = (3/4)c, so Φ_before = 2·(3/4 c - c/2) = c/2. After resize and insert, capacity is 2c, size is (3/4)c + 1, so Φ_after = 2·((3/4)c + 1 - c) = 2 - c/2.

```text
ΔΦ = (2 - c/2) - (c/2) = 2 - c
amortized = (1 + 3c/4) + (2 - c) = 3 - c/4 ≤ 3
```

So amortized cost ≤ 3 per operation, independent of `n`.   ∎

### Why "Expected" not "Worst-Case"

The above assumes *no hash collisions exceed expected chain length*. With a universal hash family `H` and an arbitrary `n`-element set:

```text
E_{h∈H}[chain_length_at_bucket(b)] = n / c ≤ α_max
E_{h∈H}[contains(x) cost] = 1 + α_max = O(1)
```

By Chernoff bound, the probability that any single bucket exceeds `O(log n / log log n)` chain length is at most `1/n^c` for constant `c`. So with high probability, the worst-case chain length is sublinear and `add`/`contains` are O(log n / log log n) per operation in the worst case across all buckets.

Without a universal hash family — i.e., with a fixed hash function and adversarially chosen keys — the worst-case is genuinely O(n), and this is achievable in production (the hash-flooding attack).

---

## Comparison-Model Lower Bound for Sorted Sets

A TreeSet's `contains` runs in O(log n). Can we do better with comparisons?

**Theorem**: Any deterministic algorithm that, given a sorted set `S` of `n` distinct comparable elements and a query `x`, decides membership using only pairwise comparisons must perform at least `⌈log₂(n + 1)⌉` comparisons in the worst case.

**Proof (information-theoretic / decision-tree argument)**:

Any such algorithm is a comparison-based decision tree. Each internal node compares two elements (either `x` to some `S[i]`, or `S[i]` to `S[j]`), and has three outcomes (`<`, `=`, `>`). Each leaf labels the answer.

For the membership problem, the answer set has size `n + 1`: either `x` equals one of `n` distinct values in `S`, or `x` falls into one of the `n + 1` "gaps" (less than `S[0]`, between consecutive elements, or greater than `S[n-1]`) — and the algorithm must distinguish at least the YES leaves (`n` of them) from each NO outcome that the adversary can force.

A ternary tree of height `h` has at most `3^h` leaves but only ≤ `2h + 1` of them can be reached by the membership-decision path (by the standard reduction to binary). For `2h + 1 ≥ n + 1` we need `h ≥ ⌈log₂(n+1)⌉`.   ∎

**Consequence**: TreeSet's O(log n) `contains` is **asymptotically optimal in the comparison model**. To beat log n requires escaping the model — e.g., hashing (uses arithmetic on key bits), van Emde Boas trees (uses key as bit-string for direct indexing), or fusion trees (multiplication tricks).

---

## Cell-Probe Lower Bound for Dictionary

The **cell-probe model** counts memory probes; each cell holds w bits and any computation between probes is free. This is the strongest standard lower-bound model — bounds here apply to any RAM algorithm.

**Theorem (Pătrașcu–Thorup, 2006)**: For a static dictionary with `n` elements over a universe of size `2^w`, with space `S` cells of `w` bits each, the expected query time satisfies:

```text
t = Ω( log(w / log(S/n)) )
```

For `S = O(n)` (linear space) and `w = log U`, this is roughly `Ω(log w / log log w)`. The Y-fast trie and fusion tree match it (up to constants).

**Theorem (Yao, 1981)**: For a perfect hash on a universe of size `m` storing `n` items in `O(n)` cells, there exists a scheme with `O(1)` worst-case lookups. (FKS perfect hashing.)

The takeaway:
- **Static dictionaries** can achieve O(1) worst-case lookup with linear space (FKS).
- **Dynamic dictionaries** (supporting add/remove) cannot do better than `Ω(log log n)` per operation in the cell-probe model under reasonable space (Pătrașcu's lower bounds, 2008).
- HashSet's amortized O(1) is an *expected*-time bound under randomization, not a deterministic guarantee.

---

## External-Memory (I/O) Complexity

The **external-memory model** (Aggarwal–Vitter, 1988) counts block transfers between RAM of size `M` and external storage of size N organized in blocks of size `B`.

### HashSet I/Os

```text
Membership probe: O(1) blocks  — assuming the bucket fits in a block.
Adversarial:      O(1) avg, O(n/B) worst when chain spans many blocks.
```

External hash tables (e.g., extendible hashing, linear hashing) achieve `O(1)` amortized I/O per operation by ensuring each bucket fits in one block.

### TreeSet I/Os

```text
Probe (binary tree node-per-block): O(log₂ n)
Probe (B-tree, fan-out Θ(B)):       O(log_B n)
```

A standard binary BST is catastrophic in external memory: every node visit is a separate block read. B-trees (and B+ trees) replace one-element nodes with `B`-element nodes, packing more comparisons per I/O. This is why filesystem indexes, relational DB indexes (PostgreSQL btree, MySQL InnoDB), and key-value stores (RocksDB SST files) all use B-trees, not BSTs.

```text
Asymptotic:     O(log_B n) << O(log₂ n)
For n=10⁹, B=256:  log_B n ≈ 4   vs   log₂ n ≈ 30
```

A factor of ~7 in random I/Os, which translates to roughly the same factor in latency on spinning disks and SSDs.

### BitSet I/Os

```text
Membership:       O(1) — single word read.
Bulk operations:  O(U/Bw) — scan all words of the bit vector.
```

For dense universes, BitSet has unbeatable cache and I/O behavior — sequential word scans are bandwidth-bound, not seek-bound.

### Cache-Oblivious Sets

The **van Emde Boas layout** for a search tree lays out the tree recursively (top half contiguous, bottom subtrees contiguous) so that any path crosses `O(log_B n)` blocks without knowing `B`. Cache-oblivious B-trees achieve the same `O(log_B n)` bound as B-trees without tuning `B`.

For sets, the equivalent is the **cache-oblivious string B-tree** (Ferragina–Grossi) and **cache-oblivious priority queues**.

---

## Parallel and Concurrent Set Operations

Define cost in two metrics: **work** `W` (total operations across all processors) and **span** `D` (longest chain of sequential dependencies, i.e., parallel time on infinitely many processors). With `P` processors, runtime ≈ `max(W/P, D)`.

### Lock-Free HashSet (Michael 2002)

For `n` concurrent operations:

```text
Work:  W = O(n) (expected, under uniform hashing)
Span:  D = O(1) per operation, but contention causes retries
```

Throughput scales linearly with `P` until contention on a single bucket dominates. With `k` operations on the same bucket per cycle, expected retries per operation = O(k).

### Parallel Set Algebra

For two sets `A`, `B`:

**Parallel union** (mutable):
```text
W = O(|A| + |B|)
D = O(log |B|)   — using parallel hash table insertion
```

**Parallel intersection**:
```text
W = O(|small|)
D = O(log |small|)
```

Implementations: Intel TBB `concurrent_unordered_set`, Java `ConcurrentHashMap`'s `keySet`, Rust `dashmap`.

### Cost Bound

By Brent's theorem:

```text
T_P ≤ T_∞ + (T_1 - T_∞) / P   =   D + (W - D) / P
```

For union with `W = n`, `D = log n`, on `P` cores: `T_P ≈ log n + n/P`. For `P ≪ n / log n` the parallel runtime is linear in `n/P` — strong scaling. Beyond that, span dominates and adding cores stops helping.

### RCU and Wait-Free Reads

In RCU-protected sets, reads are **wait-free** (constant span, no retries). Writes are blocking on the grace-period detector and incur O(P) work to publish + reclaim.

```text
Read span:  O(1)
Write span: O(grace_period_length) = O(P) in many implementations
```

This is the right model for read-heavy workloads (1000:1 read:write ratios in many production caches), where the kernel-style RCU has crushed lock-free alternatives in benchmarks.

---

## Comparison Across Models

| Model | HashSet | TreeSet | BitSet | Lower bound |
|---|---|---|---|---|
| RAM, amortized | O(1) | O(log n) | O(1) | Ω(1) for hashing under universal H |
| Cell-probe, dynamic | O(1) expected | O(log n) | O(1) | Ω(log log n) |
| Comparison model | n/a (uses bits) | O(log n) | n/a | Ω(log n) |
| External-memory | O(1) I/O | O(log_B n) I/O | O(U/Bw) I/O | Ω(log_B n) for sorted |
| Parallel (W/D) | O(n)/O(log n) | O(n log n)/O(log n) | O(U/w)/O(log U/w) | — |
| Cache-oblivious | — | O(log_B n) (vEB layout) | O(U/(Bw)) | Ω(log_B n) |

The pattern across models: HashSet wins on point operations *if* you accept randomized/expected bounds and a small universe of hash inputs. TreeSet wins on ordered operations and provable deterministic worst-case. BitSet dominates dense integer universes. None is universally optimal — each is provably optimal in its own model.

---

## Set Algebra Complexity Lower Bounds

### Intersection

For unordered sets in the comparison model, intersection of two sets of sizes `m ≤ n` requires `Ω(m log(n/m + 1))` comparisons. This is achieved by a balanced BST + sweep (or by sorting + merge).

In the hashing model, expected intersection cost drops to `O(m)` — independent of `n` — by iterating the smaller set and probing the larger.

**Proof sketch (comparison lower bound)**: Consider the decision tree distinguishing which subsets `S ⊆ {1, ..., m}` give nonempty intersection. There are `2^m` such subsets, so the tree has height ≥ `m`. The Frederickson–Johnson refinement of this argument tightens it to `Ω(m log(n/m + 1))` for `m ≤ n`.

### Union

The output size alone is between `max(|A|, |B|)` and `|A| + |B|`, so any algorithm that materializes the union requires `Ω(|A| + |B|)` time in the worst case. In the comparison model the bound is matched by merging two sorted lists; in the hash model by a single linear pass over both inputs.

### Set Equality

Testing `A = B` for unordered sets requires `Ω(min(|A|, |B|))` comparisons in the worst case. Idea: an adversary maintains uncertainty by answering comparisons consistently as long as possible. Until you query at least `|A|` elements you cannot rule out a single-element difference.

In the hash model, equality is `O(min(|A|, |B|))` average: check `|A| == |B|`, then iterate the smaller set probing the larger.

---

## Worked Proof: Amortized Cost of Set Algebra

**Claim**: Building the intersection of `k` HashSets `S_1, ..., S_k` of total size `N` takes amortized `O(N)` time.

**Proof**:

Without loss of generality, `|S_1| ≤ |S_2| ≤ ... ≤ |S_k|`. The intersection cardinality at step `i` is at most `min(|S_1|, ..., |S_i|) = |S_1|`. The work at step `i` is at most `|S_1|` probes (one per element of the running intersection).

Total work: `≤ |S_1| · (k - 1) + |S_1|` (initial scan). Since `|S_1| ≤ N / k`, total work is `≤ N`. Amortized `O(N)`.   ∎

This argument explains why sort-by-size is the standard preprocessing step for multi-set intersection in databases and search engines (TF-IDF posting list intersections).

---

## Probabilistic Analysis of Bloom Filter False Positive Rate

A Bloom filter with `m` bits, `k` hash functions, and `n` inserted elements has false positive probability:

```text
Pr[fp] = (1 - (1 - 1/m)^(kn))^k  ≈  (1 - e^(-kn/m))^k
```

**Optimal `k`**: Minimize `Pr[fp]` over `k` for fixed `m`, `n`. Take log of the right side and differentiate:

```text
d/dk [ k · ln(1 - e^(-kn/m)) ] = 0
Solution: k* = (m/n) · ln 2
```

At this `k*`:

```text
Pr[fp] = (1/2)^k* = (1/2)^((m/n) ln 2)
m/n required for fp rate p: m/n = -log₂(p) / ln 2 ≈ 1.44 · log₂(1/p)
```

**Example**: For `p = 0.01` (1% false positive), `m/n ≈ 9.6` bits per element, `k* ≈ 6.6` (use 7 hashes). For `p = 10^-9`, `m/n ≈ 43` bits per element.

This is the formula every Bloom filter implementation cites. It is also why Bloom filters dominate naïve "store a HashSet" when memory is tight — 1.44·log₂(1/p) bits per element is asymptotically the best any probabilistic membership structure can do (proved by Carter, Floyd, Gill, Markowsky, and Wegman, 1978).

---

## Summary

At the professional level, the Set ADT is studied under four lenses:

1. **Amortized analysis** justifies HashSet's O(1) `add` via aggregate and potential methods — a worst-case-per-op bound is impossible without resize, but the *average* over n operations is constant.
2. **Comparison-model lower bound** of Ω(log n) makes TreeSet's `contains` provably optimal; beating it requires going outside the comparison model (hashing, integer tricks).
3. **Cell-probe lower bounds** push the bar even higher: Ω(log log n) per operation for any dynamic dictionary with reasonable space, which HashSet matches in expectation but not in worst case.
4. **External-memory and cache-oblivious models** explain why B-trees dominate on-disk indexes despite RAM's love affair with hash tables — the unit of memory access there is the *block*, not the element.

The Set is a deceptively simple ADT with surprisingly deep theory. The lower bounds are tight, the implementations are creative, and the right choice depends entirely on which model best matches your hardware and your access pattern.
