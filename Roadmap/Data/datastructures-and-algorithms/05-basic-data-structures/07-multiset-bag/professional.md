# Multiset / Bag — Mathematical Foundations and Complexity Theory

## Table of Contents

1. [Formal Definition](#formal-definition)
2. [Loop Invariant for the Counter Pattern](#loop-invariant-for-the-counter-pattern)
3. [Amortized Analysis of Insert / Remove](#amortized-analysis-of-insert--remove)
4. [Lower Bounds for Counting](#lower-bounds-for-counting)
5. [Parallel and Concurrent Updates](#parallel-and-concurrent-updates)
6. [CRDT G-Counter and PN-Counter Correctness](#crdt-g-counter-and-pn-counter-correctness)
7. [Communication Complexity of Count Queries](#communication-complexity-of-count-queries)
8. [Misra-Gries Correctness Proof](#misra-gries-correctness-proof)
9. [Cache-Oblivious Considerations](#cache-oblivious-considerations)
10. [Comparison Table](#comparison-table)
11. [Summary](#summary)

---

## Formal Definition

```text
Let U be the universe of elements.
A multiset M over U is a function   m : U -> N_0  (non-negative integers).
The support of M is  supp(M) = { x in U : m(x) > 0 }.
The size of M is     |M|     = sum_{x in U} m(x).
The cardinality      d(M)    = |supp(M)|.

Operations:
  add(x)     : m'(x) = m(x) + 1, m'(y) = m(y) for y != x.
  remove(x)  : if m(x) > 0 then m'(x) = m(x) - 1, else undefined.
  count(x)   : returns m(x).
  size()     : returns |M|.
  distinct() : returns d(M).

Algebra on multisets A, B : U -> N_0:
  (A + B)(x)  = A(x) + B(x)             -- sum
  (A ∪ B)(x)  = max(A(x), B(x))         -- multiset union
  (A ∩ B)(x)  = min(A(x), B(x))         -- intersection
  (A − B)(x)  = max(A(x) − B(x), 0)     -- bounded difference

Invariant I(M): forall x in U, m(x) >= 0  AND  |M| = sum_{x in supp(M)} m(x).
```

The set of multisets over `U` forms a **commutative monoid** under `+` with identity the empty multiset `0`. Under `(∪, ∩)` it forms a **distributive lattice**: `A ∪ (B ∩ C) = (A ∪ B) ∩ (A ∪ C)`. The empty multiset is the bottom; the supremum is not bounded above unless `U` is finite and counts are bounded.

These algebraic properties are not decorative — they are the foundation of:

- **Commutativity and associativity** of `+` enable distributed aggregation (you can sum partial counts in any order, justifying MapReduce-style folds).
- **Idempotence** of `max` enables the G-Counter CRDT proof later in this document.
- **Distributivity** of `∪` over `∩` lets the optimizer rewrite multiset-algebra expressions in database query planning.

---

## Loop Invariant for the Counter Pattern

The "counter pattern" used throughout middle.md is so universal that it deserves a formal correctness argument. Consider the sliding-window anagram check:

```text
Algorithm WINDOW-ANAGRAM(s, p):
  Input:  s of length n, p of length m, m <= n.
  Output: every i in [0, n - m] such that multiset(s[i..i+m-1]) = multiset(p).

  need[c] := multiplicity of c in p, for each c.
  have    := empty multiset.
  matched := 0.
  for r in 0..n-1:
    have.add(s[r])
    if have[s[r]] == need[s[r]]: matched += 1
    if r >= m:
      left = s[r - m]
      if have[left] == need[left]: matched -= 1
      have.remove(left)
    if matched == |supp(need)| and r >= m - 1: emit r - m + 1.
```

**Invariant I.** At the top of iteration `r`, after the window has been adjusted:
1. `have` equals `multiset(s[l..r])` where `l = max(0, r - m + 1)`.
2. `matched` equals `|{ c in supp(need) : have(c) == need(c) }|`.
3. For every emitted index `i`, `multiset(s[i..i+m-1]) = need`.

*Proof.* Base case (r = -1): `have` is empty, window is empty, `matched = 0`. All three clauses hold vacuously.

Inductive step. Assume I before iteration r. The two updates are:
- `have.add(s[r])` extends the window by one element on the right. By the inductive hypothesis `have` was the window count; after `add`, the new `have` matches the new window. The conditional update of `matched` is correct because `have[s[r]] == need[s[r]]` holds **after** the add iff `have[s[r]]` was `need[s[r]] - 1` before — exactly the boundary case where `s[r]` becomes the count-matching contribution.
- `have.remove(left)` (when r >= m) shrinks the window by one on the left. Symmetric argument: `matched` decrements precisely when `have[left] == need[left]` **before** the remove (the count drops below need).

Termination: the loop runs exactly `n` iterations. The emit condition `matched == |supp(need)|` together with `|have| = m` implies `have = need` as multisets, because two multisets of equal size that agree on all keys of one are equal. So every emitted index is a true anagram match.

This invariant — `matched` tracks the count of fully-satisfied keys — generalizes to every "multiset subset" sliding-window problem. The runtime is O(n) because each character is added and removed at most once, giving O(2n) multiset operations.

---

## Amortized Analysis of Insert / Remove

Consider a hash-backed multiset implemented over a dynamic array of `capacity` buckets that doubles when the load factor `alpha = d / capacity` exceeds 1.

**Aggregate method.** Let `n_i` denote the support cardinality after operation `i`. Each `add` does O(1) work plus, on the resize-triggering operation, O(d) work to rehash. After `n` add operations the resize budget across all resizes is bounded by a geometric series:

```text
sum of resize costs <= sum_{k=0}^{log2 n} 2^k = 2^{log2 n + 1} - 1 = O(n).
```

Total work over `n` adds is `O(n) + O(n) = O(n)`, so amortized cost is `O(1)` per `add`.

**Potential method.** Define a potential function `Phi(M) = 2 * d(M) - capacity(M)`. Immediately after a resize, `d = capacity / 2` so `Phi = 0`. Just before the next resize, `d = capacity` so `Phi = capacity`. The amortized cost of an `add` that triggers a resize is:

```text
a_i = c_i + Phi(M_i) - Phi(M_{i-1})
    = (1 + d) + (-d) - (d - 1)        -- after resize Phi drops by d, before it grew by 1 per add
    = 2 + ... = O(1).
```

A non-resizing add has `a_i = 1 + 2 = 3 = O(1)`. The potential is always non-negative, so total amortized cost upper-bounds total actual cost.

**Remove is symmetric**: deletion never triggers a resize in the standard model (we let `alpha` fall freely), so each `remove` is O(1) worst case once we have located the bucket. Hash-table textbooks also discuss *shrinking* on `alpha < 1/4`; a similar potential argument gives O(1) amortized for shrink-and-remove cycles, with the standard caveat that you must use a strictly less aggressive shrink threshold than the growth threshold to avoid pathological flapping.

The same argument applies to the `total` cache: each operation does O(1) extra work to maintain `|M|`, so the amortized bound is unchanged.

---

## Lower Bounds for Counting

### Lower bound for exact-count over a stream of length N

**Claim.** Any data structure that supports `add(x)` and exact `count(x)` over an alphabet of size `u`, using a stream of `N` operations, requires `Omega(min(N, u) * log N)` bits of memory in the worst case.

*Proof sketch.* Reduce from `INDEX` in one-way communication complexity. Alice holds a vector `f : [u] -> [N]` summing to N (i.e., a multiset). Bob holds a query `q in [u]`. Alice streams `f(i)` copies of element `i` to a counter; Bob then queries `count(q)`. Any solution lets Bob recover `f(q)`, hence the entire vector by Yao's principle. INDEX has communication complexity `Omega(u log N)` for vectors of magnitude up to N, so the counter must transmit (and thus store) `Omega(min(N, u) * log N)` bits.

Consequence: exact counting in sub-linear space is **impossible** in the worst case. Sub-linear-space algorithms like Count-Min Sketch necessarily approximate, and the lower bound predicts that an `eps`-approximation needs `Omega((1/eps) * log N)` bits — matching CMS up to constant factors.

### Lower bound for heavy hitters

The Misra-Gries algorithm uses `O(k * log N)` bits to identify all elements with frequency above `N/k`. This is tight:

**Claim.** Any deterministic streaming algorithm that outputs the set of elements with frequency > N/k requires `Omega(k * log(u/k))` bits.

*Proof idea.* Encode an arbitrary subset `S` of `[u]` of size k into a stream that places exactly `N/k + 1` copies of each element in `S` and one copy of each element outside `S`. The output set is `S`. A space bound below `log(C(u, k)) = Omega(k log(u/k))` cannot distinguish all subsets.

---

## Parallel and Concurrent Updates

Let `p` processors share a multiset and issue concurrent operations. The serialization point is the per-key counter update.

**Atomic-increment model.** Each `add(x)` does an `atomic-fetch-and-add` on `count[x]`. Under the asynchronous PRAM model, two processors contending on the same key incur O(1) work each but observe a serial order. With `p` processors and `n` updates uniformly spread over `d` distinct keys, expected per-key contention is `n/d` per processor, and total throughput is `Theta(min(p, d))` after Memory-CAS contention is accounted for. The bound is tight: when all `p` processors hammer one key, throughput collapses to one update per CAS cycle.

**Lock-striping.** Partition the key space into `s` shards, each protected by a lock. Expected contention per shard is `n/s`. For uniformly random keys and `p` processors, the maximum shard load is `Theta(n/s + log s / log log s)` by the standard bins-and-balls bound. Choosing `s = Theta(p log p)` makes the max load `O(n/p)` with high probability — linear scaling.

**Lock-free counter striping (LongAdder pattern).** Replace each counter with an array of cells; on contention pick a different cell; reads sum all cells. This reduces contention from `O(p)` to `O(p / cells)` per cell. The cost is an `O(cells)` read but `O(1)` average write. The technique is correct because integer addition is commutative and associative — exactly the algebraic property that distinguishes a multiset counter from, e.g., a max counter (which is *not* invertible under arbitrary partial sums).

The choice of striping is exactly the choice that makes the operation a CRDT.

---

## CRDT G-Counter and PN-Counter Correctness

A **G-Counter** is the canonical replicated grow-only counter. It is a state-based CRDT (also called a "convergent" or CvRDT).

```text
Definition. A G-Counter for N replicas is a vector  P : [N] -> N_0.

  query(P)          = sum_i P[i].
  increment_i(P)    = P with P[i] := P[i] + 1.
  merge(P, Q)(i)    = max(P[i], Q[i]) for all i.
```

**Theorem (Strong Eventual Consistency).** Two replicas that have received the same set of updates (in any order) converge to the same state.

*Proof.* The set of states `S = N_0^N` with the partial order `P <= Q iff P[i] <= Q[i] for all i` is a join-semilattice; `merge` is the join. Every `increment_i` is monotone with respect to this order (it strictly increases one component). For any two states `P, Q` reachable from the same set of operations, the merges are associative, commutative, and idempotent (max of integers has those properties), so the final state depends only on the *set* of updates, not their order or multiplicity. Hence both replicas reach the same join. QED.

**PN-Counter.** Increments and decrements need two G-Counters:

```text
PN-Counter:  P, N  -- both G-Counters.
  query                = sum P[i] - sum N[i].
  increment_i          = P[i] += 1.
  decrement_i          = N[i] += 1.
  merge((P1,N1), (P2,N2)) = (merge_G(P1,P2), merge_G(N1,N2)).
```

The PN-Counter inherits SEC from the G-Counter because the merge factors through the two grow-only components. Note that the PN-Counter does **not** support `decrement` below the local replica's positive count without coordination — if you also need a non-negativity invariant (e.g., "inventory >= 0") you must add a separate reservation protocol (escrow or token passing), because the multiset axiom `m(x) >= 0` is not preserved under arbitrary network reorderings of `add` and `remove`.

The correspondence is exact: a multiset over `U` whose counts can both increase and decrease across replicas needs one PN-Counter per element. Memory grows as `O(N * d)` where N is the replica count and d is the support size. For huge supports this becomes the dominant cost — practical systems shard the multiset across replicas so each replica only holds the PN-Counters for keys it actually receives updates on.

---

## Communication Complexity of Count Queries

Consider the **distributed count problem**: `p` servers each hold a multiset `M_i`. A coordinator wants to compute `m(x) = sum_i M_i(x)` for an arbitrary query x.

**Upper bound.** O(p * log N) bits trivially: each server sends its local count. Optimal in the worst case if every server has a non-zero count.

**Lower bound.** `Omega(p)` bits even in the *promise* version where at most one server has a non-zero count, by reduction from `PROMISED-EQUALITY`. So the trivial scheme is tight up to the log factor.

**Streaming distributed.** When queries come continuously and updates come continuously, a *functional monitoring* model applies. To maintain an `(1 +/- eps)`-approximation of `m(x)` at the coordinator under continuous updates, each server can use a local threshold: send a delta to the coordinator only when its local count has grown by `eps * estimate / p`. Total communication is `O((p / eps) * log N)` over the lifetime of the stream — sub-linear in update count, exactly the regime the multi-region telemetry pipelines rely on.

This bound matters in practice: a 100-server telemetry pipeline streaming events at 1M/sec to a coordinator cannot afford one message per event. The local-threshold scheme reduces messages by a factor of `eps * 1e6 / 100 ~= 100 * eps` events per message. With `eps = 0.01` that is one message per 1000 events per server — manageable.

---

## Misra-Gries Correctness Proof

**Theorem (Misra-Gries 1982).** After processing a stream of N items with the algorithm described in senior.md using k-1 counter slots, every element `x` whose true count `f(x)` exceeds `N/k` is retained in the candidate set `M`, and for every `x in M` we have:

```text
   f(x) - N/k  <=  M[x]  <=  f(x).
```

*Proof.* The upper bound `M[x] <= f(x)` is immediate: `M[x]` is only ever incremented when `x` is observed, never preemptively. We show the lower bound.

Define a *decrement round* as one execution of the "else" branch where all counters in `M` decrement by 1 and zero-valued counters are removed. Let `D` denote the total number of decrement rounds across the stream.

Each decrement round decrements at most `k - 1` counters by 1 each, and is triggered only when `|M| = k - 1` and a new element arrives. The triggering element is added to `M` with count 1 right after (or in some variants is also decremented and discarded). So each decrement round consumes at least `k` distinct stream tokens (k - 1 from previously stored counts plus 1 from the triggering element). Therefore:

```text
   k * D  <=  N,  i.e.,  D  <=  N / k.
```

The decrement applied to `x`'s counter across the stream is at most `D <= N/k`. The increment applied is exactly `f(x)`. So if `x` is in `M` at the end:

```text
   M[x] >= f(x) - D >= f(x) - N/k.
```

Conversely, any `x` with `f(x) > N/k` cannot have been fully decremented to 0 and removed, so `x in M`. QED.

The proof reveals the algorithm's tightness: `D = N/k` is achievable on adversarial streams (e.g., distinct elements until the table fills, then a new distinct element each step), so the lower bound `f(x) - N/k` cannot be improved without more counters. This matches the lower bound from communication complexity established earlier.

---

## Cache-Oblivious Considerations

A hash multiset's operations are O(1) in the RAM model but pay cache misses on every key access. Let `B` be the cache block size in bytes, `M` the cache size.

**Hash multiset, separate chaining.** A lookup touches: (1) the bucket array slot at index `h(x) % capacity`, (2) the first chain node, (3) further chain nodes if collisions. Under uniform hashing, the bucket slot is essentially a random access — O(1) cache miss with probability `1 - alpha * B / size_of_pointer` (where `alpha` is load factor). For a 1M-distinct multiset with 16-byte pointers and 64-byte cache lines, that miss probability is ~99%. The chain walk adds one cache miss per chain node.

**Open-addressing variant.** Replaces chain misses with linear probing — the next probed slot is on the same cache line with high probability if load factor is moderate. Total expected misses per operation drops to ~1 from ~2.

**Dense `int[K]` for small alphabets.** Sequential or nearly-sequential access; for `K = 256` the entire counter fits in 1-2 cache lines. Operations are effectively cache-resident; the speedup over a hash multiset is often 10-20x.

**Cache-oblivious tree multisets.** A `TreeMultiset` over `n` distinct elements pays `O(log_B n)` cache misses per operation using a van Emde Boas layout, versus `O(log n)` for a naive layout. The constant factor on cache misses, not the asymptotic complexity, dominates real-world performance for in-memory multisets at the billion-element scale.

For a multiset that lives in memory but spills to SSD (e.g., embedded RocksDB-backed counter store), the I/O complexity becomes `O((1/B) * log_{M/B}(N/B))` per amortized operation — the standard LSM-tree bound, exactly the structure RocksDB uses for its key-value counter use case.

---

## Comparison Table

| Attribute | Hash multiset | Tree multiset | CMS sketch | Misra-Gries | PN-Counter (per element) |
|-----------|---------------|---------------|------------|-------------|---------------------------|
| `add` time (worst) | O(n) | O(log n) | O(d) hashes | O(k) decrement step | O(1) per replica |
| `count` time (worst) | O(n) | O(log n) | O(d) | O(1) | O(N) replicas to sum |
| Space | O(d) | O(d) | O(d * w) const | O(k) | O(N) per element |
| Deterministic? | Yes | Yes | No (overcount) | Yes (no false neg) | Yes (SEC) |
| Cache I/Os per op | O(1) miss | O(log_B n) miss | O(d) misses | O(1) | O(1) per replica |
| Concurrency model | striping / CAS | per-key lock + tree lock | atomic increments | single writer | CRDT merge |
| Use case | general | sorted / range | huge cardinality | top-k under tight RAM | distributed sum |

---

## Summary

The multiset's professional treatment hangs on five formal pillars:

1. **Amortized O(1)** insert and remove on the dynamic-array hash backend, proven by aggregate or potential method.
2. **Omega(min(N, u) log N) bits** for exact counting — and the matching `O((1/eps) log N)` upper bound that justifies sketches.
3. **Heavy hitters** are solvable in `O(k log N)` bits, tight by reduction from communication-complexity lower bounds.
4. **G-Counter / PN-Counter CRDTs** give Strong Eventual Consistency for distributed multiset state; the proof reduces to associativity, commutativity, and idempotence of `max` over a join-semilattice.
5. **Functional monitoring** trades approximation error for communication, achieving `O((p/eps) log N)` bits of total traffic across distributed counters.

These bounds are not academic — they determine whether your trending-topics pipeline can run on 100 KB of sketch state or needs 10 TB of exact counts, and whether your distributed cart-counter can survive a network partition without losing increments. The mathematics chosen here is exactly the mathematics the senior-level system-design chapter operationalizes.
