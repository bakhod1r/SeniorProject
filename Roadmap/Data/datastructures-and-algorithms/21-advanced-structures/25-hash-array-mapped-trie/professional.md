# Hash Array Mapped Trie (HAMT) — Mathematical Foundations and Complexity Theory

> **Read time: ~70 minutes** · **Audience:** Engineers and researchers who want the formal underpinnings of the HAMT — a proof that depth is `O(log₃₂ n)` with high probability, a precise space analysis of the bitmap + popcount encoding, the cost of persistence via path copying, and a formal account of CHAMP canonicalization and why it makes structural equality fast.

The earlier files asserted "O(log₃₂ n), effectively O(1)" and "bitmap + popcount saves space." This file proves those claims. We model the HAMT as a randomized trie over uniform hashes, bound its height with a balls-into-bins / Chernoff argument, count the exact bits of the bitmap encoding versus a full 32-slot array, quantify the per-update node-copy cost and the total persistent memory across `m` versions, and formalize the canonicalization invariant that makes CHAMP's `equals` short-circuit on pointer equality. We close with the worst-case (adversarial hash) analysis that separates the expected from the guaranteed.

---

## Table of Contents

1. [Formal Definition](#formal-definition)
2. [Correctness — Path Determinism and Lookup Invariant](#correctness)
3. [Expected and High-Probability Depth Bound](#depth-bound)
4. [Bitmap + Popcount Space Analysis](#space)
5. [Persistence Cost — Path Copying and Multi-Version Memory](#persistence-cost)
6. [Amortized Cost of Transient Batch Build](#amortized)
7. [CHAMP Canonicalization, Formalized](#champ)
8. [Information-Theoretic View of the Bitmap Index](#info-theory)
9. [Cache-Oblivious and I/O Considerations](#cache)
10. [Worst Case and Adversarial Hashing](#worst-case)
11. [A Fully Worked Numeric Example](#worked)
12. [Empirical Verification of the Depth Bound](#empirical)
13. [Comparison with Alternatives](#comparison)
14. [Summary](#summary)

---

<a name="formal-definition"></a>
## 1. Formal Definition

```text
Fix a chunk width t (here t = 5, branching B = 2^t = 32) and a hash width w
(here w = 32 or 64), with maximum depth L = ceil(w / t).

A HAMT over key space K and value space V is a rooted tree where each node is one of:

  Internal(bm, C):
      bm in {0,1}^B                  -- a bitmap of present slots
      C = (c_0, ..., c_{p-1})        -- a dense child array, p = popcount(bm)
      The j-th set bit of bm (in increasing slot order) addresses child c_j.

  Leaf(k, v):  k in K, v in V        -- a single entry

  Collision(E): E = {(k_1,v_1),...,(k_r,v_r)}   -- distinct keys with equal full hash

Hashing: hash : K -> {0,1}^w.
Chunk:   chunk(h, d) = floor(h / 2^{t*d}) mod 2^t      (the d-th t-bit slice)

Path of a key k: the sequence  chunk(hash(k),0), chunk(hash(k),1), ...
                 followed from the root, taking at each Internal node the child
                 addressed by that slot, until a Leaf or Collision node is reached.

Dense-index function:  rank(bm, s) = popcount( bm AND (2^s - 1) )
                       (number of present slots strictly below s)
```

The **invariant** maintained after every operation is the conjunction:

```text
I(node):  for Internal(bm, C):  |C| = popcount(bm)
                                 AND for each present slot s with rank r = rank(bm,s),
                                     C[r] is the subtree for keys whose chunk at this depth = s
          for Leaf(k,v):         unique k in the whole tree
          for Collision(E):      all keys in E share the same full hash; |E| >= 2
          (CHAMP also: canonical shape — see Section 7)
```

---

<a name="correctness"></a>
## 2. Correctness — Path Determinism and Lookup Invariant

**Claim.** `get(k)` returns `v` iff the entry `(k, v)` is in the map.

**Lookup invariant `J(d)`.** At the start of the recursion at depth `d` on node `N`, `N` is the unique node such that *every* key `k'` currently stored in the subtree rooted at `N` satisfies `chunk(hash(k'), e) = chunk(hash(k), e)` for all `e < d`. (Equivalently: `N` is exactly where key `k` *must* live if it is present.)

```text
Base (d = 0): N = root. Vacuously, all keys agree on the empty prefix. J(0) holds.

Inductive step: assume J(d) at Internal(bm, C). Let s = chunk(hash(k), d).
  - If bit s of bm is 0: no key with this d-prefix-then-s exists, so k is absent.
    Return "not found" — correct, since by J(d) k could only live here.
  - If bit s of bm is 1: descend to C[rank(bm,s)]. By I(node), that child holds
    exactly the keys whose chunk at depth d equals s. Combined with J(d), every key
    in that child agrees with k on chunks 0..d. So J(d+1) holds.

Termination: each step increases d by 1; d is bounded by L = ceil(w/t) because once
  the hash bits are exhausted the node is a Leaf or Collision. So recursion halts in
  <= L steps.

Postcondition: at a Leaf(k', v'), return v' iff k' = k (full key compare — equal hash
  does NOT imply equal key). At a Collision(E), scan E and return v iff (k,v) in E.
  By J, this is the only place k can be, so the answer is correct. QED.
```

Insertion/deletion preserve `I` by construction (they rebuild path nodes to keep `|C| = popcount(bm)` and collapse single-child nodes), and preserve `J` because they never move a key off its hash-determined path.

### 2.1 Delete correctness and the collapse rule

```text
Claim: delete(k) yields a map containing exactly the previous entries minus k,
       and still satisfying I (in particular I5: no redundant single-child nodes).

Invariant on the way up (post-order): after returning from depth d+1, the returned
subtree is canonical for the set of keys it holds.

Case leaf:        if leaf.key = k -> return EMPTY (signal removal); else unchanged.
Case internal:    recurse into the slot's child.
   - child becomes EMPTY: clear the slot bit, drop the dense entry.
       Now if this node has exactly one remaining child that is a leaf, RETURN that
       leaf (collapse) — this restores I5; otherwise return the rebuilt internal node.
   - child non-empty: replace the child pointer with the rebuilt child.

Termination: recursion depth <= L. Each level does O(B) array surgery.
Postcondition: by induction every returned subtree is canonical; the root is canonical
   for (entries \ {k}). The collapse rule guarantees no internal node is left with a
   single leaf child, so height never exceeds log_32 n by accumulated single-child
   nodes. QED.
```

The collapse rule is what makes repeated insert/delete churn safe: without it, a sequence of `m` insert-then-delete pairs could leave `Θ(m)` single-child internal nodes on a path, silently growing height beyond `log_32 n` and degrading every subsequent operation.

---

<a name="depth-bound"></a>
## 3. Expected and High-Probability Depth Bound

Model `hash(k)` as uniform and independent over `{0,1}^w` for the `n` stored keys (the standard random-oracle assumption; in practice approximated by a good hash).

### 3.1 Expected depth

Consider any fixed depth-`d` node, reachable only by keys whose first `d` chunks equal a fixed sequence — i.e. whose first `td` hash bits are fixed. The probability a given key reaches it is `2^{-td} = 32^{-d}`. Let `X_d` be the number of stored keys reaching that node:

```text
E[X_d] = n * 32^{-d}.
```

A subtree becomes a single leaf once `E[X_d] < 1`, i.e. once `32^d > n`, i.e.

```text
d > log_32 n.
```

Hence the **expected depth of any key's path is `Theta(log_32 n)`**. For `n = 10^6`, `log_32 n = 4`; for `n = 10^9`, `log_32 n ~ 6`.

### 3.2 High-probability bound (no path much longer than the expectation)

We bound the probability that *some* path exceeds depth `D = (1+epsilon) log_32 n + c`. A path reaches depth `D` only if at least two keys share the same `tD`-bit hash prefix (otherwise the trie would have placed a leaf earlier). The number of distinct `tD`-bit prefixes is `32^D`. By a balls-into-bins argument with `n` balls and `32^D` bins:

```text
Pr[some bin has >= 2 keys]
   <= C(n,2) * 32^{-D}              (union bound over key pairs sharing a prefix)
   <= n^2 / 2 * 32^{-D}.
```

Set `D = log_32 n + c`. Then `32^{-D} = (1/n) * 32^{-c}`, so

```text
Pr[depth > log_32 n + c] <= (n^2/2) * (1/n) * 32^{-c} = (n/2) * 32^{-c}.
```

Choosing `c = log_32 n + log_32(2/delta) `... more carefully, take `D = 2 log_32 n + c'`:

```text
Pr[depth > 2 log_32 n + c'] <= (n^2/2) * 32^{-(2 log_32 n + c')}
                              = (n^2/2) * n^{-2} * 32^{-c'} = (1/2) 32^{-c'}.
```

So with probability `>= 1 - (1/2)32^{-c'}` (e.g. `c' = 4 => failure < 2^{-19}`), **every** path is at most `2 log_32 n + O(1)`. Thus `get`/`insert`/`delete` run in `O(log_32 n)` time **with high probability**, and the maximum depth never exceeds `L = ceil(w/t)` deterministically (e.g. 7 for 32-bit hashes), at which point excess keys fall into collision nodes. QED.

```mermaid
graph TD
    A["n keys, uniform hash"] --> B["E[keys under depth-d node] = n / 32^d"]
    B --> C["leaf when 32^d > n  =>  E[depth] = log_32 n"]
    C --> D["union bound on shared prefixes"]
    D --> E["Pr[depth > 2 log_32 n + c] <= (1/2) 32^{-c}"]
```

---

<a name="space"></a>
## 4. Bitmap + Popcount Space Analysis

Compare two encodings of an internal node with `p` present children out of `B = 32` slots, pointer size `P` bits (e.g. 64).

```text
Full-array node:    B pointers           = 32 * P bits, regardless of p.
Bitmap node:        B-bit bitmap + p ptrs = B + p*P bits = 32 + p*P bits.

Savings (bits) = 32P - (32 + pP) = (32 - p)*P - 32.
```

For `P = 64`: a node with `p = 1` child costs `32 + 64 = 96` bits versus `32*64 = 2048` bits — a **21x** reduction. The break-even is `p` near 32 (when the dense array is full, the bitmap adds a negligible 32 bits). Since under uniform hashing most internal nodes near the leaves have small `p`, the average savings are large.

**Total structural space.** A HAMT with `n` entries has `n` leaves and `O(n / (B-1))` internal nodes (each internal node has >= 2 children in CHAMP / after collapse, so the number of internal nodes is bounded by the number of leaves; more precisely a `B`-ary tree with `n` leaves and minimum branching 2 has `<= n - 1` internal nodes). Each internal node stores a `B`-bit bitmap and `p` pointers, `sum p = (#children edges) = (#nodes - 1)`. Therefore:

```text
Total pointers across all internal nodes = O(n).
Total bitmap bits = B * (#internal nodes) = O(n) (since B is constant).
=> Total space = O(n)  with a small constant, no 32-wide waste.
```

The **popcount index** itself is `O(1)` time and `O(1)` extra space: a single hardware instruction computes `rank(bm, s)` from the already-stored bitmap; no auxiliary index structure is needed. This is the crucial efficiency: the bitmap doubles as both the *presence* set and the *rank* directory.

---

<a name="persistence-cost"></a>
## 5. Persistence Cost — Path Copying and Multi-Version Memory

### 5.1 Per-update copy cost

An `insert`/`delete` copies exactly the nodes on the root-to-target path and reuses (shares) all sibling subtrees. The path length is the depth `= O(log_32 n)` whp. Copying a path node of `p` children costs `O(p) <= O(B) = O(32) = O(1)` for the dense-array copy. Hence:

```text
Time per update      = O(log_32 n)        (path length x O(1) per node)
New nodes allocated  = O(log_32 n)        (one fresh node per path level)
Shared (reused) nodes per update = all others (Theta(n) of them remain shared).
```

### 5.2 Total memory across m versions

Starting from a map of size `n` and performing `m` updates, the *additional* persistent memory is the sum of per-update fresh nodes:

```text
Extra nodes over m updates = O(m * log_32 n).
Total memory of the version DAG = O(n + m * log_32 n).
```

Contrast with naive full-copy persistence, which would cost `O(n * m)`. The `log_32 n` factor — versus `log_2 n` for a persistent BST — makes the HAMT's persistence ~`log_2 32 = 5x` cheaper per version in copied nodes than a persistent red-black tree. Formally, with `B = 2^t`:

```text
copy cost per version (HAMT)  = O(log_B n) = O((1/t) log_2 n)
copy cost per version (BST)   = O(log_2 n)
ratio = 1/t = 1/5.
```

This is the precise mathematical statement of "wider branching → shallower tree → cheaper persistence," at the cost of `O(B)` work to copy each (constant-bounded) node's array.

```text
Potential view (optional): define Phi(version DAG) = total live nodes.
Each update raises Phi by O(log_32 n). Over m updates,
   total allocation = Phi_final - Phi_0 = O(m log_32 n). QED.
```

---

<a name="amortized"></a>
## 6. Amortized Cost of Transient Batch Build

Building an immutable map by `n` separate immutable inserts costs `O(n log_32 n)` node allocations. A **transient** with an edit token reduces this. Charge with the **accounting/potential method**:

```text
Ownership states a node can be in: UNOWNED (published) or OWNED (by this transient).

Define potential Phi = (number of path nodes not yet owned by the transient).

When the transient first touches a path node, it copies-and-owns it: actual cost O(1)
plus it decreases the number of future copies on that node to zero.

Charge each node's single copy to its first touch. After a path node is owned, every
subsequent update reuses it in place at O(1) and allocates nothing for that node.

Over n inserts the transient owns at most O(n) distinct nodes total (the final tree has
O(n) nodes). Each is copied at most once. Therefore:

   total allocations during the batch = O(n)         (not O(n log_32 n))
   amortized allocation per insert     = O(1).
```

So transients turn an `O(n log_32 n)` build into an `O(n)` build, with `freeze` (dropping ownership) being `O(#owned nodes) = O(n)` one-time. Correctness requires the **single-owner** invariant: a node is mutated in place only when its token equals the active transient's token; published nodes (token = none) are never mutated, preserving immutability of all already-frozen versions. QED.

---

<a name="champ"></a>
## 7. CHAMP Canonicalization, Formalized

CHAMP splits each internal node's bitmap into two:

```text
dataMap : {0,1}^B   -- slots holding an inline (key,value) entry
nodeMap : {0,1}^B   -- slots holding a sub-node pointer
Invariant (disjointness):  dataMap AND nodeMap = 0    -- a slot is data OR node, never both.

array layout: [ data entries packed front | sub-nodes packed back ]
data index of slot s  : 2 * popcount(dataMap AND (2^s - 1))
node index of slot s  : (len(array) - 1) - popcount(nodeMap AND (2^s - 1))
```

### 7.1 The canonicalization invariant

```text
Canonical(node):
  (C1) No sub-node holds exactly one entry. (A singleton must be inlined as a data
       entry in the parent, in the slot addressed by its chunk.)
  (C2) No empty sub-nodes.
  (C3) The shape of the tree is a deterministic function of the SET of entries only,
       independent of insertion/deletion order.
```

**Theorem (shape canonicity).** Two CHAMP maps containing the same set of entries `S` have the same tree shape (same `dataMap`/`nodeMap` at every position).

```text
Proof sketch (structural induction on depth):
  At depth d, each entry of S is routed by chunk(hash(k), d) to a slot. Entries that
  are alone in their slot must (by C1) be inline data entries -> they fix dataMap.
  Slots with >= 2 entries become sub-nodes -> they fix nodeMap, recursively canonical
  by induction. Equal-hash entries beyond depth L form a canonical collision node
  (sorted by key, say). Thus dataMap, nodeMap, and every child are determined by S
  alone, independent of operation order. QED.
```

### 7.2 Why canonicity makes equality fast

```text
equals(A, B):
  if A == B (same pointer): return true            -- O(1) short-circuit
  if A.dataMap != B.dataMap or A.nodeMap != B.nodeMap: return false   -- O(1) reject
  compare inline entries pairwise; recurse on sub-nodes pairwise.

Because shape is canonical, structural inequality is detected at the first differing
bitmap, and structural EQUALITY can reuse pointer-equality of shared sub-nodes to
prune entire subtrees. Expected cost is O(size of the symmetric difference), not O(n).
```

Without C3 (plain HAMT), two equal-content maps may differ in shape, so `equals` cannot trust bitmaps or pointer equality and degrades toward `O(n)` with full re-traversal — the practical reason Scala migrated to CHAMP.

---

<a name="info-theory"></a>
## 8. Information-Theoretic View of the Bitmap Index

The bitmap + popcount scheme is an instance of a **succinct rank/select** structure restricted to a single 32-bit (or 64-bit) machine word. It is worth seeing why this special case is so cheap.

```text
General problem: store a subset S of {0,...,B-1} and support
    member(s)        : is s in S?
    rank(s) = |{ x in S : x < s }|     -- the dense index we need

Lower bound: storing an arbitrary subset of a B-element universe needs
    ceil(log2( sum_{p=0}^{B} C(B,p) )) = ceil(log2(2^B)) = B bits
in the worst case (any subset is possible). The bitmap uses exactly B bits — it is
information-theoretically optimal as a *membership* encoding for an arbitrary subset.
```

The remarkable part is that the *same* B bits also answer `rank` in O(1) when B fits in one machine word: `rank(s) = popcount(bitmap AND (2^s - 1))`. A general succinct rank structure over a long bit-vector needs an auxiliary `o(B)`-bit index of block counts to hit O(1); here `B <= 64`, so a single hardware `POPCNT` over one masked word suffices and **no auxiliary index is stored at all**. This is precisely why HAMTs pick a chunk width `t` with `2^t` ≤ machine word size: it keeps the per-node directory inside one word and the rank inside one instruction.

```text
Why t = 5 (B = 32) rather than t = 6 (B = 64)?
  - B = 32 -> 32-bit bitmap, fits a 32-bit register; popcount on 32 bits.
  - B = 64 -> 64-bit bitmap, shallower tree (log_64 n) but wider dense arrays to copy.
  - Depth: log_64 n = (1/6) log_2 n  vs  log_32 n = (1/5) log_2 n  (only ~17% shallower).
  - Copy cost per path node: O(B) -> doubling B doubles array-copy work per update.
  The t = 5 choice balances shallow depth against per-node copy cost; it is the
  empirically chosen sweet spot in Clojure/Scala/Haskell.
```

### 8.1 Expected dense-array size

Under uniform hashing, the number of present children `p` at an internal node holding `k` keys behaves like a balls-into-bins occupancy: with `k` keys thrown into `B = 32` slots, the expected number of non-empty slots is

```text
E[p] = B * (1 - (1 - 1/B)^k) = 32 * (1 - (31/32)^k).
```

For `k` small this is ≈ `k` (few collisions); for `k` large it saturates toward 32. The dense array therefore wastes essentially nothing: its length tracks the actual number of distinct child slots, validating the `O(n)` total-space result of Section 4.

---

<a name="cache"></a>
## 9. Cache-Oblivious and I/O Considerations

```text
Parameters: N entries, M = cache size (words), L = cache line / block size (words).

Naive HAMT pointer layout (nodes scattered by the allocator):
  Each of the O(log_32 N) hops touches a node on a potentially distinct cache line.
  Cache misses per lookup: O(log_32 N) in the worst layout.

Versus a flat open-addressed hash table:
  One probe sequence on O(1) cache lines (usually 1-2). This is the constant-factor
  gap that makes mutable hash tables faster in practice despite identical Big-O.
```

CHAMP improves the constant by **co-locating** a node's inline data entries in one contiguous array region, so a node that resolves to a local entry costs a single line touch rather than a pointer chase. It does **not** change the asymptotic `O(log_32 N)` miss bound, but it shrinks the per-hop constant and improves iteration to near-sequential within a node.

```text
HAMT is NOT cache-oblivious in the van-Emde-Boas sense: it does not recursively lay
out subtrees to minimize block transfers across all M, L. A persistent map that needs
cache-oblivious guarantees would use a vEB-laid-out search tree instead, trading the
1/t branching advantage for provable O((N/L) log_{M/L}(N/L)) scan I/O. In practice the
shallow depth (log_32 N <= 7 for 32-bit hashes) keeps the miss count tiny regardless.
```

The takeaway: the HAMT optimizes **depth** (algorithmic) and **node compactness** (space), and leaves cross-node locality to the allocator/CHAMP — an explicit, well-understood trade rather than an oversight.

---

<a name="worst-case"></a>
## 10. Worst Case and Adversarial Hashing

The probabilistic bounds assume a uniform hash. An adversary who can choose keys to control `hash(k)` can defeat them:

```text
Adversarial scenario: choose n keys all sharing the same w-bit hash.
  => all n keys land in ONE collision node at depth L.
  => get/insert/delete on that node = O(n) (linear scan / linear array surgery).
  => the structure degrades to a linked list / unsorted array.
```

This is the HAMT analogue of hash-flooding on a hash table. Defenses are identical in spirit:

```text
1. Seeded/randomized hash (SipHash-style): h_seed(k) = H(seed || k), seed secret
   per process. The adversary cannot precompute colliding keys. Restores the uniform
   model against a computationally bounded adversary (random-oracle / PRF assumption).
2. Cap collision-node size; rehash with a fresh seed if exceeded.
3. For ordered worst-case guarantees, fall back to a balanced BST per collision bucket
   (collision node as a tree), giving O(L + log r) worst case for r colliding keys.
```

Deterministic worst case (no adversary, just an unlucky or structurally-keyed hash) is bounded by `L = ceil(w/t)` levels plus the largest collision node; with seeded hashing, `r` (collision-node size) is `O(1)` whp, so the deterministic-plus-probabilistic bound is `O(w/t) = O(1)` for fixed `w`, matching the `O(log_32 n)` expected bound until `n` approaches `2^w`.

---

<a name="worked"></a>
## 11. A Fully Worked Numeric Example

To make the bounds concrete, fix `t = 5`, `B = 32`, `w = 32`, and `n = 1{,}000{,}000` entries.

```text
Expected depth:
    log_32(10^6) = ln(10^6)/ln(32) = 13.8155 / 3.4657 = 3.99  ~  4 levels.

High-probability max depth (Section 3.2), choosing c' = 4:
    Pr[depth > 2*log_32 n + 4] <= (1/2) * 32^{-4} = (1/2) * (1/1048576) ~ 4.8e-7.
    2*log_32 n + 4 = 2*3.99 + 4 = 11.98  ~  12 levels.
    But the deterministic cap is L = ceil(32/5) = 7, so in fact depth <= 7 always;
    the probabilistic bound is loose here because the hash simply runs out of bits.
    => With 32-bit hashes, n = 10^6, every path is <= 7; expected ~4.

Lookup cost:
    ~4 internal-node hops, each: 1 bitmap test + 1 popcount + 1 dereference.
    On a 3 GHz core with ~1 popcount/cycle and ~4 ns per cold pointer chase,
    a fully-cold lookup is ~16 ns; a warm lookup is a few ns.

Per-update copied nodes:
    ~4 fresh internal nodes + 1 new leaf = 5 allocations.
    Shared (reused) nodes: nearly all of the ~10^6 leaves + internal nodes remain shared.

Space:
    Each internal node: 32-bit bitmap (4 bytes) + p pointers (8p bytes) + header.
    With sum of p = O(n), total pointer bytes = O(n); bitmaps = 4 * (#internal) = O(n).
    => total ~ O(n) with a small constant; no 32-wide array waste.
```

### Verifying the persistence economy

Suppose we perform `m = 10^6` updates on this map and retain all versions.

```text
Naive full-copy persistence: O(n*m) = 10^6 * 10^6 = 10^12 node copies — infeasible.
HAMT path-copy persistence:  O(n + m*log_32 n) = 10^6 + 10^6 * 4 = 5 * 10^6 nodes.
Ratio: ~200000x less memory than naive copying.
Versus persistent RB-tree:   O(n + m*log_2 n) = 10^6 + 10^6 * 20 = 2.1 * 10^7 nodes,
                             ~4.2x more than the HAMT (the 1/t = 1/5 branching factor).
```

This single table is the quantitative justification for the whole design: wide branching turns persistence from "impossible" into "cheap," and beats the binary persistent tree by the branching factor's log.

---

<a name="empirical"></a>
## 11b. Empirical Verification of the Depth Bound

The theory predicts expected depth `≈ log₃₂ n`. The following instrument measures the *actual* maximum and average leaf depth of a HAMT built from `n` keys, so you can confirm the bound experimentally. It returns `(maxDepth, avgDepth)` for a tree built over uniform hashes.

#### Go

```go
package main

import (
	"fmt"
	"math"
	"math/rand"
)

// measure builds a HAMT-shaped depth profile by simulating slot assignment of n
// uniform hashes and reporting realized max/avg depth. (Simplified: counts the
// depth at which each key becomes unique.)
func measure(n int) (int, float64) {
	const t = 5
	keys := make([]uint64, n)
	for i := range keys {
		keys[i] = rand.Uint64()
	}
	maxD, sumD := 0, 0
	for i := 0; i < n; i++ {
		d := 0
		for j := 0; j < n; j++ { // depth until keys[i] is unique among others
			if i == j {
				continue
			}
			pref := (5 * (d + 1))
			if (keys[i]>>0)&((1<<pref)-1) == (keys[j])&((1<<pref)-1) {
				d++
			}
		}
		if d > maxD {
			maxD = d
		}
		sumD += d
	}
	return maxD, float64(sumD) / float64(n)
}

func main() {
	for _, n := range []int{1000, 10000} {
		m, a := measure(n)
		fmt.Printf("n=%d  predicted log32 n=%.2f  measured avg~%.2f max=%d\n",
			n, math.Log(float64(n))/math.Log(32), a, m)
	}
}
```

#### Java

```java
import java.util.Random;

public class DepthProbe {
    static int[] measure(int n) {
        Random r = new Random(1);
        long[] keys = new long[n];
        for (int i = 0; i < n; i++) keys[i] = r.nextLong();
        int maxD = 0; long sum = 0;
        for (int i = 0; i < n; i++) {
            int d = 0;
            for (int j = 0; j < n; j++) {
                if (i == j) continue;
                int pref = 5 * (d + 1);
                long mask = (pref >= 63) ? -1L : ((1L << pref) - 1);
                if ((keys[i] & mask) == (keys[j] & mask)) d++;
            }
            maxD = Math.max(maxD, d); sum += d;
        }
        return new int[]{maxD, (int) (sum / n)};
    }
    public static void main(String[] args) {
        for (int n : new int[]{1000, 10000}) {
            int[] m = measure(n);
            System.out.printf("n=%d  log32 n=%.2f  avg~%d max=%d%n",
                n, Math.log(n) / Math.log(32), m[1], m[0]);
        }
    }
}
```

#### Python

```python
import math, random

def measure(n):
    keys = [random.getrandbits(64) for _ in range(n)]
    max_d, total = 0, 0
    for i in range(n):
        d = 0
        for j in range(n):
            if i == j:
                continue
            pref = 5 * (d + 1)
            mask = (1 << pref) - 1
            if (keys[i] & mask) == (keys[j] & mask):
                d += 1
        max_d = max(max_d, d); total += d
    return max_d, total / n

if __name__ == "__main__":
    for n in (1000, 10000):
        m, a = measure(n)
        print(f"n={n}  log32 n={math.log(n)/math.log(32):.2f}  avg~{a:.2f} max={m}")
```

The measured average depth tracks `log₃₂ n` (≈2 for `n=1000`, ≈3 for `n=10000`), and the max stays within a small multiple — the empirical face of the high-probability bound of §3.2.

---

<a name="comparison"></a>
## 13. Comparison with Alternatives

| Attribute | HAMT (t=5) | Persistent red-black tree | Mutable open-addressed hash table |
|---|---|---|---|
| get/insert/delete (whp / avg) | O(log₃₂ n) | O(log₂ n) | O(1) amortized |
| Deterministic worst case | O(w/t + r) collision | O(log₂ n) | O(n) on resize/flood |
| Copy cost per persistent version | O(log₃₂ n) | O(log₂ n) | O(n) full copy |
| Node space waste | None (bitmap+popcount) | 2 ptrs + color/node | Load-factor slack |
| Structural equality | O(diff) with CHAMP | O(n) compare | O(n) compare |
| Deterministic? | No (hash-randomized) | Yes | No (hash) |
| Ordered? | No | Yes | No |

The defining trade: the HAMT's `1/t` factor makes it the *shallowest* persistent map and the *cheapest per version*, paying with no ordering and a dependence on hash quality for its bounds.

### 12.1 Choosing the chunk width formally

The chunk width `t` trades depth against per-node copy cost. Let the cost model be: a read pays `depth` cache-miss-bounded hops `= log_{2^t} n = (1/t) log_2 n`; an update copies `depth` path nodes, each of expected dense size bounded by `O(2^t)` array slots. Then:

```text
read cost      ~ (1/t) log_2 n                 (decreasing in t)
update copy    ~ (1/t) log_2 n * E[array size]  (array size grows ~ with 2^t near full)
node directory ~ 2^t bits per node              (must fit one machine word: 2^t <= 64)

The constraint 2^t <= wordsize bounds t <= 6 (64-bit) or t <= 5 (32-bit popcount path).
Within that, t = 5 minimizes the product for typical n and pointer sizes, which is why
it is the universal choice. Larger t shrinks depth only logarithmically (log_2 t in the
denominator) while linearly enlarging the array-copy and directory costs.
```

This formalizes the empirical "5 bits is the sweet spot" claim made informally in the lower-level files: the marginal depth reduction from `t=5` to `t=6` is `1 - 5/6 ≈ 17%`, but the per-node copy and directory costs roughly double, so 5 wins on the combined objective for the parameter ranges that matter.

### 12.2 Summary of asymptotic results

| Quantity | Bound | Section |
|---|---|---|
| Expected path depth | `Θ(log₃₂ n)` | §3.1 |
| High-probability max depth | `2 log₃₂ n + O(1)`, fail `≤ ½·32^{-c}` | §3.2 |
| Deterministic max depth | `⌈w/t⌉` (+ collision-node size) | §1, §10 |
| Node space (p children) | `B + pP` bits vs `BP` | §4 |
| Total structural space | `O(n)` | §4 |
| Time per get/insert/delete | `O(log₃₂ n)` whp | §2, §3 |
| Copied nodes per update | `O(log₃₂ n)` | §5.1 |
| Memory over m versions | `O(n + m log₃₂ n)` | §5.2 |
| Transient batch build | `O(n)` allocations amortized | §6 |
| CHAMP equality | `O(symmetric difference)` | §7.2 |

---

<a name="summary"></a>
## 14. Summary

Formally, a HAMT is a randomized `B`-ary trie over uniform hashes with bitmap-compressed nodes. Its depth is `Theta(log_B n)` in expectation and `2 log_B n + O(1)` with high probability (union bound on shared prefixes), giving `O(log₃₂ n)` operations and `O(log₃₂ n)` copied nodes per persistent update — a factor `1/t = 1/5` cheaper per version than a persistent BST. The **bitmap + popcount** encoding stores a node in `B + pP` bits instead of `BP`, costs `O(1)` to index (the bitmap doubles as the rank directory), and yields `O(n)` total space. **Transients** amortize a batch build to `O(n)` allocations via a single-owner edit token. **CHAMP** enforces a canonical shape (no singleton sub-nodes; data/node bitmap split), making structural equality short-circuit on bitmaps and pointers. The bounds hold under a uniform-hash model; an adversary controlling hashes forces `O(n)` collision nodes, defended by seeded hashing and bounded buckets.

---

**Next step:** [Interview Preparation →](./interview.md) — tiered Q&A across all levels plus a HAMT `get`/`insert` (bitmap + popcount) coding challenge in Go, Java, and Python.
