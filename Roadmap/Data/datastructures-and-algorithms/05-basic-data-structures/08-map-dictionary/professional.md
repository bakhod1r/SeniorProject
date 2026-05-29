# Map / Dictionary — Mathematical Foundations and Complexity Theory

## Table of Contents

1. [Formal Definition](#formal-definition)
2. [Amortized Analysis of Resize](#amortized-analysis-of-resize)
3. [The Dictionary Problem — Lower Bounds](#the-dictionary-problem--lower-bounds)
4. [Universal Hashing and Expected Complexity](#universal-hashing-and-expected-complexity)
5. [Parallel Maps — Lock-Free Theory](#parallel-maps--lock-free-theory)
6. [Persistent Immutable Maps — HAMT](#persistent-immutable-maps--hamt)
7. [Cache-Aware Hashing](#cache-aware-hashing)
8. [Comparison Across Models](#comparison-across-models)
9. [Summary](#summary)

---

## Formal Definition

A **Map** (dictionary) is an abstract data type defined as a partial function:

```text
M : K -> V_perp        where V_perp = V cup {perp}

Operations:
  put(M, k, v)     : M' such that M'(k) = v, and M'(k') = M(k') for k' != k
  get(M, k)        : M(k)                       (returns perp if absent)
  remove(M, k)     : M' such that M'(k) = perp, M'(k') = M(k') for k' != k
  containsKey(M,k) : M(k) != perp
  size(M)          : |{k : M(k) != perp}|

Axioms (forall k, k', v, v'):
  (A1) get(put(M, k, v), k)            = v
  (A2) get(put(M, k, v), k')           = get(M, k')        for k' != k
  (A3) get(remove(M, k), k)            = perp
  (A4) get(remove(M, k), k')           = get(M, k')        for k' != k
  (A5) put(put(M, k, v), k, v')        = put(M, k, v')
```

The dictionary problem is: implement a data structure supporting these operations efficiently.

---

## Amortized Analysis of Resize

### Doubling strategy

A hash-backed Map resizes when load factor `alpha = n/m` exceeds threshold `alpha*` (commonly 0.75). Resize: allocate a new array of size `2m`, rehash all `n` entries.

**Claim:** Over any sequence of `n` insertions starting from empty, total work is `O(n)`. Amortized cost per `put` is `O(1)`.

### Aggregate method

Let `T(n)` = total cost of `n` inserts.

```text
Resize sizes:   m_0, 2*m_0, 4*m_0, ..., m
Cost of each:   O(m_0), O(2*m_0), ..., O(m)
Total resize:   sum_{i=0}^{log(m/m_0)} O(m_0 * 2^i)
              = O(m_0 * 2^{log(m/m_0)+1})
              = O(2m) = O(m) = O(n)

Plus n O(1) basic insertions:    O(n)
Total:                            O(n)
Amortized per put:                O(n)/n = O(1)
```

### Potential method

Define potential `Phi(M) = 2*size(M) - capacity(M)`, capped at 0 from below.

- After resize, `size = capacity/2`, so `Phi = 2*(c/2) - c = 0`.
- Each insert raises `Phi` by 2 (size up by 1).
- A resize at threshold uses actual cost `O(n)` but reduces `Phi` by approximately `n` (capacity doubles, so `2*size - capacity` drops by `~size`).

```text
amortized(insert) = actual + DeltaPhi
                  = O(1) + 2
                  = O(1)

amortized(resize) = actual + DeltaPhi
                  = O(n) + (-n)
                  = O(1)
```

Thus every operation has amortized `O(1)` cost.

### Why not "shrink at threshold"?

If we resize down at `alpha < 0.25`, an adversary alternating insert/delete at the boundary can trigger `O(n)` work per op. The standard fix: shrink only at `alpha < 1/4` (a factor of 2 below the expansion threshold) — this gives an amortized `O(1)` for the alternating sequence too.

```text
Adversary sequence (bad shrink threshold = alpha*):
  Fill to n -> resize up (cost n)
  Delete 1 -> resize down (cost n/2)
  Insert 1 -> resize up (cost n)
  ...
With shrink threshold = alpha*/4, alternating cannot
straddle both thresholds; amortized stays O(1).
```

---

## The Dictionary Problem — Lower Bounds

### Pointer-machine model

In the **pointer-machine model**, memory is a graph of nodes with constant-degree pointers; an algorithm follows pointers and performs comparisons.

**Theorem (Yao, 1981; Fredman & Saks, 1989):** Any deterministic dictionary on `n` integer keys in `[1, U]` in the pointer-machine model requires `Omega(log log n)` time per operation if `U` is super-polynomial in `n`, and `Omega(sqrt(log n / log log n))` in stronger variants.

Comparison-based dictionaries (BSTs) have a `Omega(log n)` lower bound in the comparison model — proven by an adversary argument on `n!` permutations of keys.

### Cell-probe model

In the **cell-probe model** (Yao), memory is divided into words of `w` bits. An algorithm pays for each word read or written; computation is free.

**Theorem (Patrascu & Thorup, 2006):** Any dynamic dictionary supporting `update` and `query` in `t_u` and `t_q` cell probes respectively must satisfy:

```text
t_q * lg(t_u/t_q + 2) = Omega(lg n / lg w)
```

This implies that for `w = Theta(lg n)` (standard word RAM), any dictionary requires `Omega(lg n / lg lg n)` cell probes per operation in the worst case. **Even hashing cannot achieve worst-case O(1) without trade-offs.**

### Practical takeaway

The `O(1)` hash-table cost is **expected** (over random hash functions or random inputs), not worst-case. Achieving worst-case `O(1)` requires:

- **Cuckoo hashing** — worst-case `O(1)` lookups, expected `O(1)` inserts (with rebuild on failure).
- **Two-level perfect hashing (FKS scheme)** — static, worst-case `O(1)`, space `O(n)`. Dynamic variants exist but are intricate.

---

## Universal Hashing and Expected Complexity

### Universal family

A family `H` of hash functions `h : U -> [m]` is **2-universal** if:

```text
forall x != y in U:   Pr_{h <- H}[h(x) = h(y)] <= 1/m
```

**Theorem:** If `h` is drawn uniformly from a 2-universal family, the expected number of collisions for any fixed `x` against `n-1` other items is at most `(n-1)/m`. With chaining, expected chain length at any bucket is `1 + alpha`.

**Corollary:** Expected `O(1 + alpha)` time per operation, regardless of input distribution.

### Why this matters in practice

Without universal (or randomized) hashing, an adversary can craft input that collides into one bucket, degrading `O(1)` to `O(n)`. This is **hash flooding** (CVE-2003-1564, CVE-2011-4815, etc.).

Modern languages defend by:

| Language | Defense |
|----------|---------|
| Python (≥ 3.4) | Random `PYTHONHASHSEED` per process |
| Java | Treeification of long chains; per-VM randomness in some types |
| Go | Per-process random hash seed |
| Rust | `SipHash` (keyed PRF) by default |
| Redis | `SipHash-2-4` with per-server key |

### Tabulation hashing

**Definition:** Split key into `c` characters; precompute `c` tables `T_i : [256] -> [m]`. Define `h(x) = T_1[x_1] XOR T_2[x_2] XOR ... XOR T_c[x_c]`.

**Theorem (Patrascu & Thorup, 2011):** Simple tabulation is 3-independent and gives `O(1)` expected operation time with strong concentration — better than 2-universal.

---

## Parallel Maps — Lock-Free Theory

### Linearizability

A concurrent Map is **linearizable** if every operation appears to take effect atomically at some instant between its invocation and its return. This is the gold standard for concurrent maps.

### Progress conditions

| Condition | Definition |
|-----------|------------|
| **Wait-free** | Every thread completes every op in bounded steps |
| **Lock-free** | At least one thread makes progress in bounded steps |
| **Obstruction-free** | A thread running in isolation completes in bounded steps |
| **Blocking** | A thread may be blocked indefinitely (e.g., on a mutex) |

### Designs

1. **Java `ConcurrentHashMap` (Java 8+)** — fine-grained locking (per-bin `synchronized`), lock-free reads via volatile + CAS. **Lock-free for reads, blocking for writes**.
2. **Split-ordered hash table (Shalev & Shavit, 2006)** — wait-free linked list + reverse-bit ordering of keys. Allows table to grow without rehashing existing nodes. Wait-free reads, lock-free updates.
3. **Cliff Click's `NonBlockingHashMap`** — CAS-only, no locks. Each operation completes in finite steps; resize is cooperative.

### Theoretical limit

**Theorem (Herlihy, 1991):** A wait-free implementation of an arbitrary object requires consensus number infinity. Compare-and-swap has consensus number infinity, so CAS-based wait-free maps are possible. Read-modify-write primitives (atomic add) have consensus number 2 and cannot implement wait-free maps over more than 2 threads.

---

## Persistent Immutable Maps — HAMT

A **persistent** Map preserves all previous versions. Every `put` returns a new Map; the old Map is still valid. Foundational in functional languages and concurrent systems (no locks needed for readers).

### HAMT — Hash Array Mapped Trie

**Bagwell, 2000.** Combines a trie indexed by hash bits with array-mapped node compression.

```text
- Each node is indexed by k bits of the hash (typically k=5, branching=32).
- A node stores up to 32 children, but uses a bitmap + packed array to use space only for occupied slots.
- Lookup descends log_{32}(n) ~= 6 levels for n up to ~1 billion.
- Updates rebuild O(log_{32}(n)) nodes (path copying).
```

### Operations

| Op | Time | New nodes allocated |
|----|------|--------------------|
| `get` | O(log_{32} n) ~= O(1) for practical n | 0 (read-only) |
| `put` | O(log_{32} n) | log_{32} n |
| `remove` | O(log_{32} n) | log_{32} n |

For `n = 10^9`, depth is ~6. Effectively O(1) for any realistic dataset.

### Production users

- **Clojure** — `PersistentHashMap` is HAMT.
- **Scala** — immutable `HashMap` is a HAMT variant (`HashTrieMap`).
- **Immer.js** — JavaScript HAMT-backed immutable maps.
- **Haskell** — `Data.HashMap.Strict` (`unordered-containers`).

### Why senior engineers care

- **Lock-free concurrent readers** — readers see a consistent snapshot; no synchronization needed.
- **Cheap snapshots** — versioning a HAMT is `O(1)` (just keep the old root pointer).
- **Structural sharing** — two versions sharing 99% of structure use ~1% extra memory per diff.

---

## Cache-Aware Hashing

Real CPUs have cache lines (typically 64 bytes). Hash table performance is dominated by **cache misses**, not arithmetic.

### Robin Hood hashing

Open-addressing variant where a probe sequence "steals" slots from probes that have searched less — equalizes probe distances. Empirically gives uniform probe distribution and excellent cache behavior.

### Swiss table (Google, abseil)

Used in `absl::flat_hash_map` and Rust's `hashbrown` (the default `HashMap`).

- **Control bytes**: each slot has a 1-byte tag (top 7 bits of hash + 1 sentinel bit) stored in a separate array.
- **SSE/SIMD lookup**: scan 16 control bytes in parallel with one SIMD compare.
- **Result**: lookups touch one 16-byte control-byte cache line plus the matching slot — typically 2 cache lines.

### Cache-oblivious dictionaries

**van Emde Boas layout** for static dictionaries gives `O(log_B n)` cache misses per query (B = block size), matching the optimal `O(log_B n)` for any comparison-based dictionary.

For dynamic structures, **cache-oblivious B-trees** (Bender et al., 2000) achieve `O((log n)/log B)` amortized cache misses per operation.

---

## Comparison Across Models

| Model | Lower Bound | Upper Bound | Achiever |
|-------|-------------|-------------|----------|
| Comparison-based (BST) | Omega(log n) | O(log n) | Red-black tree |
| Pointer-machine integer | Omega(sqrt(log n / log log n)) | O(log n / log log n) | y-fast trie |
| Cell-probe (RAM, w-bit) | Omega(log n / log lg n) | O(log n / log lg n) | Patrascu's structure |
| Hash + universal | n/a (expected) | O(1) expected | Chained hashing |
| Hash + perfect | n/a (static) | O(1) worst-case | FKS / cuckoo |
| Concurrent linearizable | reads need O(1) atomic | O(1) expected | ConcurrentHashMap |
| Persistent immutable | Omega(log n) (depth) | O(log_{32} n) | HAMT |

---

## Summary

At professional level the Map ADT is a backdrop for several foundational results:

- **Amortized O(1) for hashing under doubling resize** — provable via aggregate or potential method.
- **No deterministic dictionary achieves worst-case O(1)** — cell-probe lower bound.
- **Universal hashing defeats adversarial inputs** — expected O(1) regardless of distribution.
- **Wait-free concurrent maps require CAS** — Herlihy's consensus hierarchy.
- **Persistent maps via HAMT trade O(1) expected for O(log_{32} n) but enable lock-free readers and cheap snapshots.**
- **Modern hash tables are cache-engineered** — Swiss tables, Robin Hood, control bytes, SIMD probing.

These results justify the engineering choices made in production systems. Understanding the lower bounds tells you which "fast Map" claims are real and which are marketing.

Further reading:
- CLRS, ch. 11 (hashing), ch. 17 (amortized analysis)
- Mehlhorn & Sanders, *Algorithms and Data Structures: The Basic Toolbox*, ch. 4
- Bagwell, "Ideal Hash Trees" (2001)
- Patrascu & Thorup, "The Power of Simple Tabulation Hashing" (2011)
- Herlihy & Shavit, *The Art of Multiprocessor Programming*
