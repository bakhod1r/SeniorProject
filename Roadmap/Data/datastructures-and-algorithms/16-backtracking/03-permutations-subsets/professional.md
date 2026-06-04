# Generating Permutations, Subsets, and Combinations — Mathematical Foundations

> **Focus:** The combinatorics behind the counts (`2^n` subsets, `n!` permutations, `C(n,k)` combinations, multinomials for multisets), proofs that the backtracking enumeration generates **each object exactly once** (completeness + no-duplication), the **correctness proof of the duplicate-skip rule**, the **correctness of `next_permutation`**, and the theory of **combinatorial generation** (Gray codes, the combinatorial number system, ranking/unranking).

---

## Table of Contents

1. [Formal Definitions](#1-formal-definitions)
2. [Counting: 2^n, n!, C(n,k), and Multinomials](#2-counting-2n-n-cnk-and-multinomials)
3. [The Decision-Tree Model of Backtracking](#3-the-decision-tree-model-of-backtracking)
4. [Completeness and Uniqueness of Subset Enumeration](#4-completeness-and-uniqueness-of-subset-enumeration)
5. [Completeness and Uniqueness of Permutation Enumeration](#5-completeness-and-uniqueness-of-permutation-enumeration)
6. [Correctness of the Duplicate-Skip Rule](#6-correctness-of-the-duplicate-skip-rule)
7. [Correctness of next_permutation](#7-correctness-of-next_permutation)
8. [Gray Codes: Existence and Construction](#8-gray-codes-existence-and-construction)
9. [The Combinatorial Number System and Ranking](#9-the-combinatorial-number-system-and-ranking)
10. [Generating Functions and Combinatorial Identities](#10-generating-functions-and-combinatorial-identities)
11. [Amortized Analysis of Successor Functions](#11-amortized-analysis-of-successor-functions)
12. [Counting vs Enumerating: Complexity Boundaries](#12-counting-vs-enumerating-complexity-boundaries)
13. [Appendix: How These Foundations Generalize](#appendix-how-these-foundations-generalize)
14. [Summary](#13-summary)

---

## 1. Formal Definitions

Let `S = {a₀, a₁, …, a_{n-1}}` be a finite set of `n` distinct elements (we treat multisets in §6).

- A **subset** of `S` is any `T ⊆ S`. The set of all subsets is the **power set** `2^S`.
- A **permutation** of `S` is a bijection `π : {0,…,n-1} → S`, equivalently an ordered arrangement `(π(0), …, π(n-1))` using every element once.
- A **k-combination** is a subset `T ⊆ S` with `|T| = k`. Order is irrelevant.
- A **k-permutation** (arrangement) is an injective sequence of length `k` from `S`; order matters.
- A **composition** of these (a tuple over an alphabet, allowing repeats) is the unrestricted product `S^L`; subsets are the binary case and full permutations are the no-repeat, use-all case. We mention it because it is the most general node-branching shape, of which subsets/permutations/combinations are constrained specializations.

The **lexicographic order** on sequences over a totally ordered alphabet compares element by element: `x < y` iff at the first index where they differ, `x_i < y_i` (a proper prefix is smaller). This total order is what "next permutation" and "ordered enumeration" refer to.

**Notation used throughout.**

| Symbol | Meaning |
|--------|---------|
| `n` | number of input elements |
| `k` | target size of a combination / k-permutation |
| `S`, `T` | the input set / a subset |
| `2^S` | the power set of `S` (all subsets) |
| `χ` | indicator (characteristic) vector of a subset, `χ ∈ {0,1}^n` |
| `C(n,k)` | binomial coefficient `n!/(k!(n−k)!)` |
| `P(n,k)` | falling factorial `n!/(n−k)!`, number of k-permutations |
| `mᵢ` | multiplicity of the `i`-th distinct value in a multiset |
| `r` | a rank (integer index) of an object in a fixed total order |
| `g(i)` | the `i`-th binary-reflected Gray code, `i ⊕ (i>>1)` |
| `⊕` | bitwise XOR |
| `Θ, Ω, O` | tight / lower / upper asymptotic bounds |

An object's **rank** is its position (0-indexed) in a fixed total order; **unrank(r)** returns the `r`-th object and **rank(obj)** its inverse. A generator is **complete** if every target object is emitted, **sound/duplicate-free** if no object is emitted twice, and **correct** if both hold (a bijection between emit events and objects).

**Lexicographic order, worked.** Over the alphabet `0 < 1 < 2`, the length-3 permutations of `{0,1,2}` in lex order are:
```
rank 0: 012      rank 3: 120
rank 1: 021      rank 4: 201
rank 2: 102      rank 5: 210
```
Reading down the first column, the leading element is non-decreasing (`0,0,1,1,2,2`); within each leading block the remaining positions recurse lexicographically. This nested structure is exactly what `next_permutation` (§7) and the factorial number system (§9) exploit: the most significant position changes least often, like the high digit of an odometer. Subsets have an analogous order under their indicator vectors read as binary integers — the bit-enumeration order of §4.

---

## 2. Counting: 2^n, n!, C(n,k), and Multinomials

**Subsets — `2^n`.** Build a subset by deciding, independently, "in or out" for each of the `n` elements. By the multiplication principle there are `2 · 2 · … · 2 = 2^n` decision sequences, and the map (decision sequence → subset) is a bijection (each subset corresponds to its unique indicator vector). Hence `|2^S| = 2^n`. Equivalently, by the binomial theorem, `Σ_{k=0}^{n} C(n,k) = (1+1)^n = 2^n`.

**Permutations — `n!`.** Fill `n` ordered positions. Position 0 has `n` choices, position 1 has `n−1` (one element used), …, position `n−1` has `1`. Product: `n · (n−1) · … · 1 = n!`.

**k-permutations — `n!/(n−k)!`.** Same argument truncated after `k` positions: `n · (n−1) · … · (n−k+1) = n!/(n−k)!`, written `P(n,k)`.

**k-combinations — `C(n,k) = n! / (k!(n−k)!)`.** Each k-combination can be ordered in `k!` ways to form k-permutations, so `P(n,k) = C(n,k) · k!`, giving `C(n,k) = P(n,k)/k! = n!/(k!(n−k)!)`. Pascal's recurrence `C(n,k) = C(n−1,k−1) + C(n−1,k)` follows by conditioning on whether element `a_{n-1}` is in the combination — *exactly the include/exclude split of the backtracking tree*.

**Multisets (duplicate inputs).** If `S` is a multiset with distinct values having multiplicities `m₁, …, m_d` (so `n = Σ mᵢ`):

- Distinct **permutations** = multinomial `n! / (m₁! · m₂! · … · m_d!)`. Proof: each distinct arrangement is counted `m₁!·…·m_d!` times among the `n!` arrangements of labeled copies, since permuting identical copies leaves the arrangement unchanged.
- Distinct **subsets** (sub-multisets) = `∏ (mᵢ + 1)`, choosing independently how many copies (0 through `mᵢ`) of each value to include.

These closed forms are the **specifications** the enumerators must meet — every proof below shows the algorithm produces exactly this many objects, each once.

**Worked counts (sanity anchors).** Concrete small cases you should be able to reproduce instantly:

| Input | Subsets | Permutations | C(n,2) |
|-------|---------|--------------|--------|
| `[a,b,c]` (distinct, n=3) | `2³ = 8` | `3! = 6` | `C(3,2) = 3` |
| `[a,b,c,d]` (n=4) | `2⁴ = 16` | `4! = 24` | `C(4,2) = 6` |
| `[1,2,2]` (multiset) | `(1+1)(2+1) = 6` | `3!/2! = 3` | — |
| `[2,2,2]` (multiset) | `(3+1) = 4` | `3!/3! = 1` | — |
| `[]` (empty) | `2⁰ = 1` (just `{}`) | `0! = 1` (the empty tuple) | `C(0,2) = 0` |

**Stirling's approximation.** For asymptotic reasoning, `n! ≈ √(2πn) (n/e)^n`, so `log₂(n!) ≈ n log₂ n − n log₂ e`. This is why even modest `n` (say 13) produces billions of permutations: factorial growth dominates exponential growth (`n!` overtakes `2^n` around `n = 4`). For combinations, the central binomial coefficient `C(n, n/2) ≈ 2^n / √(πn/2)` is the largest, so the bulk of subsets concentrate at size `≈ n/2` — a fact that matters when estimating the work of size-targeted generation.

**Growth-rate reference (practical feasibility limits).** A rough guide for "can I enumerate this at all":

| n | `2^n` (subsets) | `n!` (permutations) | feasible to list? |
|---|-----------------|---------------------|-------------------|
| 10 | ~1.0×10³ | ~3.6×10⁶ | both trivially |
| 15 | ~3.3×10⁴ | ~1.3×10¹² | subsets yes; permutations no |
| 20 | ~1.0×10⁶ | ~2.4×10¹⁸ | subsets yes; permutations hopeless |
| 25 | ~3.4×10⁷ | — | subsets borderline (tens of MB) |
| 30 | ~1.1×10⁹ | — | subsets stream-only |

The table is a back-of-envelope sanity gate: if your `n` lands in a "no" cell, you must switch from enumeration to counting (a formula/DP) or to a targeted search that prunes most of the space — exactly the senior-level decision discussed in `senior.md`.

---

## 3. The Decision-Tree Model of Backtracking

Model a backtracking generator as a rooted tree `𝒯`:

- The **root** is the empty partial solution `∅`.
- An internal node at depth `d` is a partial solution after `d` committed choices.
- The **children** of a node are the partial solutions obtained by each valid next choice (the iterations of the `for` loop).
- Certain nodes are **output nodes** (where the algorithm emits): leaves for permutations/combinations; *every* node for the start-index subset enumeration.

The algorithm performs a depth-first traversal of `𝒯`, emitting at output nodes. To prove correctness we must show two things:

1. **Completeness (surjectivity):** every target object is the label of (or is read off from) exactly one output node — none is missed.
2. **No duplication (injectivity):** distinct output nodes yield distinct objects — none is emitted twice.

Together these establish a **bijection** between output nodes and target objects, which simultaneously proves the count is correct.

**Termination lemma.** The traversal halts. *Proof:* the tree is finite — depth is bounded by `n` (each child commits one more of `n` elements, or, for combinations, reaches size `k ≤ n`), and each node has at most `n` children (one per loop iteration). A DFS of a finite tree visits each node once and terminates. The total node count is itself bounded (by `2^{n+1}` for subsets, `Σ_{j=0}^{n} P(n,j)` for the permutation prefix tree), confirming finiteness.

**The buffer-restoration invariant.** The correctness of *reusing one mutable buffer* rests on an invariant: *every call to `backtrack` returns with the shared buffer in exactly the state it had on entry.* Proof by structural induction on the recursion: the base case (leaf) makes no mutation that outlives it; the inductive step performs `choose` (one push), recursively calls (which restores by hypothesis), then `un-choose` (the matching pop) — net zero change. Therefore siblings always start from the same buffer state, which is what makes the choice paths in the bijection well-defined. A missing `un-choose` breaks this invariant and the bijection collapses (paths leak into one another) — formalizing exactly why the "leave no trace" discipline is mandatory, not stylistic.

**Node-count accounting (combinations with pruning).** The unpruned combination tree for `combine(n,k)` has a node at every strictly-increasing prefix of length `0..k`, i.e. `Σ_{j=0}^{k} C(n,j)` nodes — far more than the `C(n,k)` leaves when `k ≪ n`. The feasibility pruning `i ≤ n−(k−|cur|)` removes every prefix that cannot be extended to length `k`. After pruning, the surviving internal nodes are exactly the prefixes that *do* extend to at least one leaf, and a charging argument (charge each surviving node to a descendant leaf, with each leaf charged at most `k` times) bounds the total visited nodes by `O(k · C(n,k))` — matching the output size up to the `k` factor. This is the formal statement of "pruning makes combination generation output-optimal," and it is provable precisely because the tree structure is so regular.

---

## 4. Completeness and Uniqueness of Subset Enumeration

Consider the start-index enumerator on distinct `S` sorted as `a₀ < a₁ < … < a_{n-1}`:

```
sub(start, cur):
    emit cur
    for i in start..n-1: cur.push(a_i); sub(i+1, cur); cur.pop()
```

**Claim.** The emitted sets are exactly the `2^n` subsets, each once.

**Bijection.** Map each subset `T = {a_{i₁}, …, a_{i_m}}` with `i₁ < i₂ < … < i_m` to the node reached by the choice path `i₁, i₂, …, i_m` (always picking strictly increasing indices). We show this map is well-defined and a bijection onto output nodes.

*Well-defined / reachable (completeness).* Because at depth `t` the loop starts at `start = i_t + 1`, any strictly increasing index sequence is a valid root-to-node path: after choosing `i_t`, the next call permits indices `> i_t`, and `i_{t+1} > i_t` qualifies. So the increasing-order listing of any `T` traces a genuine path, and `T` is emitted at its terminal node. Every subset has a unique increasing listing, so every subset is reached.

*Injective (no duplication).* Each node corresponds to exactly one choice path (the recursion records the sequence of `i`'s), and that path *is* the increasing index listing of the emitted set. Two different subsets have different increasing listings, hence different paths, hence different nodes. Conversely, the constraint "`i+1`, strictly increasing" forbids ever emitting the same set via two orders (e.g. you can never produce the path `1,0`), so no set is emitted twice. ∎

The count falls out: output nodes ↔ subsets is a bijection, and we independently counted `2^n` subsets, so the tree has `2^n` output nodes. (The include/exclude binary-tree variant is the same bijection viewed as indicator vectors; bit enumeration is literally that bijection, mask ↔ indicator vector.)

**The include/exclude variant, formally.** The binary-tree enumerator decides, at depth `i`, exclude-then-include for element `aᵢ`, emitting only at depth-`n` leaves:
```
sub2(i, cur):
    if i == n: emit cur; return
    sub2(i+1, cur)                       # exclude a_i
    cur.push(a_i); sub2(i+1, cur); cur.pop()   # include a_i
```
*Bijection.* Map each subset `T` to its **indicator vector** `χ ∈ {0,1}^n`, where `χ_i = 1` iff `aᵢ ∈ T`. The root-to-leaf path makes exactly the choices `χ_0, χ_1, …, χ_{n-1}` (left = 0 = exclude, right = 1 = include). Every leaf is reached by exactly one such bit string, and indicator vectors biject with subsets (the fundamental fact behind `|2^S| = 2^n`). Hence leaves ↔ subsets is a bijection with `2^n` leaves. **Bit enumeration is this same bijection made iterative:** the integer `mask` *is* the indicator vector read as binary, and looping `mask = 0 … 2^n − 1` visits every leaf once in numeric order — no tree, no stack, the same proof.

**Worked trace (`S = {a,b}`).** The start-index tree:
```
node []        emit {}        (depth 0)
  +a → [a]     emit {a}       (depth 1, start=1)
        +b → [a,b]  emit {a,b}(depth 2)
  +b → [b]     emit {b}       (depth 1, start=2 → no children)
```
Four output nodes, four subsets `{}, {a}, {a,b}, {b}` — `2² = 4`, each once. Note `[b]` never spawns `[b,a]` because its `start = 2 > index(a) = 0`; this is the `i+1` constraint enforcing the unique increasing listing.

---

## 5. Completeness and Uniqueness of Permutation Enumeration

Consider the used-array enumerator on distinct `S`:

```
perm(cur):
    if |cur| == n: emit cur; return
    for i in 0..n-1: if not used[i]: place a_i; perm(cur); unplace a_i
```

**Claim.** The emitted sequences are exactly the `n!` permutations, each once.

**Bijection.** Map each permutation `π = (π₀, …, π_{n-1})` to the leaf reached by choosing, at depth `t`, the (unused) index of `π_t`.

*Completeness.* At depth `t`, exactly the elements `π₀,…,π_{t-1}` are marked used; since `π` is a bijection, `π_t` is distinct from all of them, so `π_t` is still unused and is an available choice. By induction the entire path is valid and `π` is emitted at the depth-`n` leaf.

*No duplication.* The root-to-leaf path *is* the sequence of placed elements, i.e. `π` itself. Distinct permutations differ at some first position `t`, so their paths diverge at depth `t`, reaching distinct leaves. And each leaf, being a single path, yields one sequence. Hence the map is a bijection between leaves and permutations. ∎

The same argument applies to the swap formulation: the invariant is that after `swap(start, i)` the prefix `[0..start]` is some injective arrangement and the suffix `[start+1..]` is exactly the remaining multiset; the loop ranges over all choices for position `start`, and the swap-back restores the suffix, so each placement is tried once. (For distinct elements the swap version also enumerates each permutation exactly once; for multisets it requires a per-level seen-set, see §6.)

**Worked trace (`S = {a,b,c}`, used-array).** The leaves, in DFS order, are the six permutations. The first subtree (place `a` first):
```
[]
  place a → [a]      used={a}
    place b → [a,b]  used={a,b}
      place c → [a,b,c]   LEAF #1
    place c → [a,c]  used={a,c}
      place b → [a,c,b]   LEAF #2
  place b → [b] …            (LEAF #3 [b,a,c], #4 [b,c,a])
  place c → [c] …            (LEAF #5 [c,a,b], #6 [c,b,a])
```
At depth 1, `a` is used so it is skipped at deeper levels; at depth 2 only one element remains unused, forcing the last position. Six leaves, six permutations — exactly `3!`. The completeness step is visible: when the prefix is `[a]`, the still-unused set is `{b,c}`, and the loop tries both, so no ordering beginning with `a` is missed.

**Counting the permutation prefix tree.** The number of *nodes* (not just leaves) in the used-array tree is `Σ_{j=0}^{n} P(n,j) = Σ_{j=0}^{n} n!/(n−j)!`, which for fixed `n` is `⌊e·n!⌋` — about `e ≈ 2.718` times the leaf count. So the recursion does only a constant factor more work than the `n!` leaves it emits, confirming the `Θ(n·n!)` bound is tight and the internal-node overhead is `O(1)` amortized per permutation.

---

## 6. Correctness of the Duplicate-Skip Rule

Now let `S` be a **multiset**, sorted so equal values are adjacent. We prove the two skip rules from `middle.md` produce each *distinct* object exactly once.

> **The general principle behind both rules — canonical representatives.** When a structure has internal symmetry (here: identical copies are interchangeable), the set of *labeled* outputs is partitioned into equivalence classes, and each class maps to one *distinct* output. To emit each distinct output once, we choose a single **canonical** member of every class and arrange the traversal to visit *only* canonical members. The skip conditions are exactly the predicate "this branch would produce a non-canonical member — prune it." Proving correctness then reduces to two checks: (a) every class contains exactly one canonical member (so we lose nothing), and (b) the traversal emits a member iff it is canonical (so we emit each class once). This "fix a canonical form" pattern recurs across all symmetry-breaking in backtracking (necklaces, board rotations, isomorph rejection); the duplicate-skip rule is its simplest instance.

### Subsets-II skip rule

Rule: in `sub(start, cur)`, skip index `i` when `i > start ∧ a_i = a_{i-1}`.

**Canonical form.** Define the canonical representative of a sub-multiset as: among all index sets that realize it, the one that, at each value, uses the *leftmost* available copies. Formally, a chosen index set is canonical iff for every chosen index `i` with `a_i = a_{i-1}`, index `i-1` is also chosen.

**Claim.** The enumerator emits exactly the canonical index sets, and canonical index sets biject with distinct sub-multisets.

*Each distinct sub-multiset has exactly one canonical index set* — pick, for each value `v` appearing `c` times in the sub-multiset, the first `c` copies of `v` in the sorted array. This is unique.

*The enumerator emits exactly the canonical ones.* Suppose at some level the loop is at `start` and encounters `i > start` with `a_i = a_{i-1}`. Skipping `i` forbids choosing copy `i` at this level *without having chosen copy `i-1`* — but `i-1` was a sibling at this same level (index `≥ start`) that, if desired, would have been chosen first by the canonical rule. Thus any non-canonical index set (one that picks `i` but not the adjacent earlier copy `i-1` *at the same level*) is exactly the case the rule prunes, while canonical sets (which always take the earlier copy first, going deeper) survive: choosing `a_{i-1}` then recursing into a call with `start = i` lets you also pick `a_i` (now `i == start`, not skipped). Hence emitted ⇔ canonical. Combined with the bijection (canonical ↔ distinct sub-multiset), each distinct subset is emitted once. ∎

The emit count therefore equals `∏(mᵢ+1)`, matching §2.

**Worked example (`[1,2,2]`, sorted).** Indices: `a₀=1, a₁=2, a₂=2`. The start-index tree with the skip rule:
```
[]                emit {}
  i=0 (1)  → [1]  emit {1}
     i=1 (2) → [1,2]   emit {1,2}
        i=2 (2) → [1,2,2]  emit {1,2,2}
     i=2 (2): i>start(1) and a₂==a₁ → SKIP
  i=1 (2)  → [2]  emit {2}
     i=2 (2) → [2,2]   emit {2,2}
  i=2 (2): i>start(0) and a₂==a₁ → SKIP
```
Emitted: `{}, {1}, {1,2}, {1,2,2}, {2}, {2,2}` — exactly `(1+1)(2+1) = 6` distinct sub-multisets. The two SKIPs are precisely the branches that would have re-produced `{2}` and `{1,2}` via the *second* copy of `2` chosen as a sibling. Critically, the *deeper* uses of the second `2` (giving `{2,2}` and `{1,2,2}`) are **not** skipped, because there `i == start` — confirming why the condition is `i > start`, not `i > 0`.

### Permutations-II skip rule

Rule: skip `i` when `used[i] ∨ (a_i = a_{i-1} ∧ ¬used[i-1])`.

**Canonical form.** Among the `m_v!` ways to assign the `m_v` identical copies of a value `v` to the positions a given distinct arrangement uses for `v`, declare canonical the assignment that uses copies in **increasing index order** (copy `i-1` placed before copy `i`).

**Claim.** The enumerator emits exactly canonical placements, one per distinct arrangement.

*Proof sketch.* The clause `a_i = a_{i-1} ∧ ¬used[i-1]` forbids placing copy `i` while copy `i-1` (same value) is still unused. So along any branch, equal copies are forced into increasing-index placement order — precisely the canonical assignment. Two different canonical placements correspond to two different *distinct arrangements* (they differ in the value sequence, not just in which identical copy sits where), so by the §5 argument they reach different leaves. And every distinct arrangement has exactly one canonical placement, which the unskipped path realizes. Hence a bijection between emitted leaves and distinct arrangements; the count is the multinomial `n!/∏ mᵢ!`. ∎

This is why `¬used[i-1]` (not `used[i-1]`) is correct: it enforces "earlier copy placed first," eliminating the within-value symmetry exactly once.

**Worked example (`[1,1,2]`, sorted, indices `0:1, 1:1, 2:2`).** Trace the first-position choices:
```
i=0 (value 1): used → place copy 0. (continue deeper)
i=1 (value 1): a₁==a₀ and ¬used[0]? used[0] is now TRUE here only inside copy-0's subtree;
               as a FIRST choice at the root, used[0]=false → SKIP copy 1 at the root.
i=2 (value 2): place → leads to permutations starting with 2.
```
So the root only branches on `{copy 0 of value 1}` and `{value 2}` — the second `1` is skipped at the root because placing it first (with copy 0 unused) would duplicate the branch that places copy 0 first. Inside copy-0's subtree, when we reach `i=1` with `used[0]=true`, the clause `¬used[0]` is false, so copy 1 *is* allowed — correctly producing `[1,1,2]`. The full distinct output is `[1,1,2], [1,2,1], [2,1,1]` — three, matching `3!/2! = 3`. Every duplicate that the naive enumerator would emit corresponds to placing a later equal copy before its predecessor, which is exactly the pruned case.

---

## 7. Correctness of next_permutation

`next_permutation(a)` returns the lexicographically smallest permutation strictly greater than `a`, or (when `a` is the largest, i.e. descending) reports "none" and wraps to the smallest. Recall the steps: find the largest `i` with `a_i < a_{i+1}` (the **pivot**); if none, `a` is descending (maximal). Else find the largest `j > i` with `a_j > a_i`; swap `a_i, a_j`; reverse the suffix `a_{i+1..n-1}`.

**Theorem.** The result is the immediate lexicographic successor of `a`.

**Proof.**
*(1) The suffix `a_{i+1..n-1}` is non-increasing.* By maximality of `i`: for every `t > i` we have `a_t ≥ a_{t+1}` (otherwise `t` would be a larger valid pivot). A non-increasing suffix is already the **largest** arrangement of its multiset, so no successor can be formed by changing only the suffix — the change must occur at or before position `i`.

*(2) Position `i` must increase, and minimally.* Any permutation greater than `a` and agreeing with `a` on `a_0..a_{i-1}` must have a larger value at position `i` (positions before `i` are fixed to keep it a successor with the smallest possible prefix; the suffix alone cannot grow per (1)). To increase position `i` as little as possible we replace `a_i` with the **smallest** suffix value that still exceeds `a_i`. Because the suffix is non-increasing, the *last* (rightmost) element greater than `a_i` is that smallest qualifying value — which is exactly the `j` chosen. Swapping keeps the suffix non-increasing (a known invariant: the swapped-in `a_i` sits between its neighbors' order).

*(3) Minimize the suffix.* After the swap the suffix is still non-increasing, hence currently the *largest* arrangement of its values; the successor needs the *smallest*, so we **reverse** it into non-decreasing order. The prefix `a_0..a_{i-1}` is unchanged, position `i` is the least possible increase, and the suffix is the least possible — so the result is the immediate successor. ∎

*Corollary (full enumeration).* Starting from the sorted (smallest) array and iterating `next_permutation` until it reports "none" visits every permutation exactly once in increasing lexicographic order. For multisets the same proof holds verbatim (it never assumes distinctness), so it enumerates each **distinct** arrangement once — this is why `next_permutation` handles duplicates for free.

**Worked trace (`a = [1, 3, 2]`).**
```
Step 1 — pivot: scan from right for a[i] < a[i+1].
         a[1]=3, a[2]=2 → 3 ≥ 2, not it.
         a[0]=1, a[1]=3 → 1 < 3 ✓  → pivot i = 0.
Step 2 — successor: rightmost a[j] > a[0]=1 in suffix [3,2].
         a[2]=2 > 1 ✓ → j = 2.
Step 3 — swap a[0],a[2]: [2, 3, 1].
Step 4 — reverse suffix after i=0, i.e. positions 1..2: [3,1] → [1,3].
Result: [2, 1, 3]  — the immediate lexicographic successor of [1,3,2].
```
Sanity check: the full lex order of `{1,2,3}` is `123, 132, 213, 231, 312, 321`; indeed the successor of `132` is `213` = `[2,1,3]`. ✓

**Duplicate-skip-for-free, demonstrated.** On `a = [1, 1, 2]`, the lex sequence is `112, 121, 211` (three, the multinomial `3!/2! = 3`). At `121`, the pivot search finds `a[0]=1 < a[1]=2`; swapping with the rightmost larger element and reversing yields `211`. No step ever produces a *duplicate* of `112` because the algorithm only ever moves to a *strictly larger* arrangement, and equal elements never create a strictly larger one by being reordered among themselves — the proof above used `>` (strict) at the pivot and successor steps, which is exactly what excludes equal-element re-shuffles.

**Boundary correctness of each step (why strictness matters).** The comparison operators are load-bearing; getting one wrong breaks the proof:

| Step | Correct comparison | If you weaken it | Consequence |
|------|--------------------|-------------------|-------------|
| Pivot scan | `a[i] < a[i+1]` (strict) | `a[i] ≤ a[i+1]` | stops too early on equal elements → emits duplicates |
| Successor `j` | rightmost `a[j] > a[i]` (strict) | `a[j] ≥ a[i]` | swaps an equal element → no strict increase, infinite loop or repeat |
| Suffix reverse | reverse `[i+1, n)` | reverse `[i, n)` | overwrites the pivot position → wrong successor |
| Wrap | reverse whole array when no pivot | return without reversing | enumeration stalls at the largest permutation |

Each strict `<`/`>` is precisely what makes the algorithm advance to the *strictly next distinct* arrangement; the multiset correctness is a free corollary of using strict comparisons rather than a separate dedup mechanism.

---

## 8. Gray Codes: Existence and Construction

A **binary-reflected Gray code** `G_n` is an ordering of all `2^n` binary strings of length `n` such that consecutive strings (and the wrap-around pair) differ in exactly one bit.

**Construction (reflection).** `G_1 = (0, 1)`. Given `G_{n-1} = (g_0, …, g_{2^{n-1}-1})`, form `G_n` by prefixing `0` to `G_{n-1}` in order, then prefixing `1` to `G_{n-1}` in **reverse**:
```
G_n = 0g_0, 0g_1, …, 0g_{2^{n-1}-1}, 1g_{2^{n-1}-1}, …, 1g_1, 1g_0
```
**Correctness.** Within each half, consecutive entries differ by one bit (inductive hypothesis). At the junction the two middle entries are `0g_last` and `1g_last`, differing only in the prefix bit. The wrap-around pair `1g_0` and `0g_0` likewise differ only in the prefix. So all consecutive pairs differ in one bit, and all `2^n` strings appear (each half contributes the full `G_{n-1}` once). ∎

**Closed form.** The `i`-th Gray code equals `i ⊕ (i >> 1)`. *Proof.* Two consecutive integers `i` and `i+1` have binary representations differing by a carry chain; XOR-ing with the right shift cancels all but the single highest changed bit, leaving exactly one bit different between `g(i)` and `g(i+1)`. The map `i ↦ i ⊕ (i>>1)` is a bijection on `{0,…,2^n−1}` (its inverse is the XOR-prefix fold), so it lists all strings. Interpreting each string as an indicator vector gives an ordering of all subsets where consecutive subsets differ by adding/removing **one** element — useful for incremental subset evaluation.

**Worked table (`n = 3`).** Comparing plain binary against the reflected Gray code, with the single changing bit highlighted:

| i | binary | `i>>1` | `g = i⊕(i>>1)` | subset | change |
|---|--------|--------|----------------|--------|--------|
| 0 | 000 | 000 | 000 | {} | — |
| 1 | 001 | 000 | 001 | {a} | +a |
| 2 | 010 | 001 | 011 | {a,b} | +b |
| 3 | 011 | 001 | 010 | {b} | −a |
| 4 | 100 | 010 | 110 | {b,c} | +c |
| 5 | 101 | 010 | 111 | {a,b,c} | +a |
| 6 | 110 | 011 | 101 | {a,c} | −b |
| 7 | 111 | 011 | 100 | {c} | −a |

Every consecutive pair (and the wrap from `{c}` back to `{}`, both differing only in bit 2 / element `c`) toggles exactly one element. This is what lets an incremental evaluator update a set-dependent function in `O(1)` per subset (apply or undo one element) instead of `O(n)` per subset (recompute from scratch) — a real speedup when the per-element update is cheap.

**Inverse (Gray → binary).** To rank a Gray code back to its integer (and thus its position), XOR-fold the prefix: `b = g; b ^= b>>1; b ^= b>>2; b ^= b>>4; …`. Each fold doubles the span of accumulated parity; after `⌈log₂ n⌉` folds the full prefix-XOR is computed, recovering `i` such that `g(i) = g`. This makes Gray-code generation fully rankable, hence shardable like the other schemes.

---

## 9. The Combinatorial Number System and Ranking

To address combinatorial objects by integer index (for unranking, §6 of `senior.md`):

**Combinations — combinatorial number system.** Every integer `r ∈ [0, C(n,k))` has a unique representation `r = C(c_k, k) + C(c_{k-1}, k-1) + … + C(c_1, 1)` with `n > c_k > c_{k-1} > … > c_1 ≥ 0`. These `c`'s *are* the indices of the `r`-th k-combination in a fixed order. Unranking greedily picks the largest `c_k` with `C(c_k, k) ≤ r`, subtracts, and recurses on `k-1`. This gives `O(n)` random access and underpins sharded combination enumeration.

**Worked unrank (`n=5, k=3, r=5`).** There are `C(5,3) = 10` combinations of `{0,1,2,3,4}`. To find the 5th (0-indexed):
```
k=3: largest c with C(c,3) ≤ 5 → C(4,3)=4 ≤ 5, C(5,3)=10 > 5 → c₃ = 4; r ← 5 − 4 = 1
k=2: largest c with C(c,2) ≤ 1 → C(2,2)=1 ≤ 1, C(3,2)=3 > 1 → c₂ = 2; r ← 1 − 1 = 0
k=1: largest c with C(c,1) ≤ 0 → C(0,1)=0 ≤ 0       → c₁ = 0; r ← 0
```
Indices `{c₃,c₂,c₁} = {4,2,0}` → combination `{0,2,4}`. (This particular ordering is the combinatorial-number-system order; a worker assigned ranks `[5,10)` would start exactly here and advance with the successor routine.)

**Permutations — factorial number system (Lehmer code).** Every `r ∈ [0, n!)` is uniquely `r = Σ_{i=1}^{n-1} d_i · i!` with `0 ≤ d_i ≤ i`. The digits `(d_{n-1}, …, d_0)` form the **Lehmer code**: at step `i` (from the most significant), pick the `d_i`-th remaining element. Because the representation is unique and the picking map is a bijection from digit tuples to permutations, this yields the `r`-th lexicographic permutation. The inverse (ranking) counts, for each position, how many smaller unused elements remain — computable in `O(n log n)` with a Fenwick tree. Uniqueness of these number systems is precisely what makes rank/unrank well-defined bijections.

**Worked unrank example.** Take `n = 4`, elements `[0,1,2,3]`, and `r = 17`. Factorials are `3! = 6, 2! = 2, 1! = 1`. Decompose `r` in the factorial base:
```
17 ÷ 6 = 2 remainder 5   →  d_3 = 2,  pick the 2nd of [0,1,2,3] = 2, remaining [0,1,3]
 5 ÷ 2 = 2 remainder 1   →  d_2 = 2,  pick the 2nd of [0,1,3]   = 3, remaining [0,1]
 1 ÷ 1 = 1 remainder 0   →  d_1 = 1,  pick the 1st of [0,1]     = 1, remaining [0]
 0 ÷ 1 = 0               →  d_0 = 0,  pick the 0th of [0]       = 0
```
So the 17th permutation (0-indexed, lexicographic) is `[2, 3, 1, 0]` — obtained in `O(n)` without touching the previous 17. This is the exact mechanism a sharded worker uses to jump directly to the start of its index range.

**Why the greedy combinatorial decomposition is unique.** For combinations, uniqueness of `r = Σ C(c_j, j)` follows because the greedy choice (largest `c_k` with `C(c_k, k) ≤ r`) cannot be improved: if you took a smaller `c_k`, the remaining terms `Σ_{j<k} C(c_j, j) < C(c_k+1, k) − C(c_k, k) = C(c_k, k−1)` could not make up the deficit (a hockey-stick bound, §10). Hence the representation is forced — the same rigidity that makes the Lehmer code unique in the factorial base.

---

## (Aside) Lower Bounds: Why You Cannot Do Better

It is natural to ask whether some clever algorithm could enumerate faster than `Θ(output)`. The answer is no, and the reason is an information-theoretic / decision-tree lower bound that mirrors the comparison-sort `Ω(n log n)` argument.

**The counting argument.** Any algorithm that *outputs* all `M` distinct objects must perform at least one distinct write per object, and each object has size `Ω(s)` (e.g. `s = n` for a permutation). So total work is `Ω(M · s)`: `Ω(n · n!)`, `Ω(n · 2^n)`, `Ω(k · C(n,k))`. The recursive and successor-based generators all match this — they are **optimal** up to constants.

**The decision-tree view of generation order.** If we additionally require the objects in lexicographic order and the only primitive is comparing/swapping elements, the *sequence of distinct orderings* the algorithm can produce is bounded by the leaves of a comparison tree, again giving the same `Ω(log M)` = `Ω(n log n)`-style floor *per object emitted in order* — which the amortized-`O(1)` successor functions of §11 meet because they exploit the algebraic structure (factorial/combinatorial number systems) rather than blind comparisons. The lesson: structure beats comparison, and the best you can hope for is output-optimal, which the standard templates already achieve.

**Space lower bound for streaming.** A generator that emits each of `M` objects exactly once, in any fixed order, must distinguish "already emitted" from "not yet emitted." Naively this needs `Ω(M)` bits (a visited set) — which would defeat streaming. The successor-function generators sidestep this by maintaining only the *current* object (`O(n)` bits) and relying on the *total order* to guarantee no repeats: "emit, then advance to the strictly-next" is stateless beyond the current object. This is precisely why an explicit total order (lexicographic, Gray, combinatorial-number-system) is the enabling structure for `O(state)`-memory enumeration; without it you would need the `Ω(M)` visited set. The theory thus directly justifies the senior-level design rule "stream via a successor over a total order."

---

## 10. Generating Functions and Combinatorial Identities

Generating functions encode an entire counting sequence as the coefficients of a formal power series, turning combinatorial reasoning into algebra. They give a second, independent derivation of the counts above and explain *why* the recursive structure of backtracking matches the multiplicative structure of the formulas.

**Subsets as a product of binary choices.** Assign each element `aᵢ` a variable factor `(1 + x)`: the `1` means "exclude," the `x` means "include" (contributing 1 to the subset size). The product over all `n` elements is the **ordinary generating function** for subsets by size:

```
∏_{i=0}^{n-1} (1 + x) = (1 + x)^n = Σ_{k=0}^{n} C(n,k) x^k
```

Setting `x = 1` collapses the size distinction and recovers `Σ_k C(n,k) = 2^n` — the total subset count. The coefficient of `x^k` is `C(n,k)`, the number of size-`k` subsets (combinations). This single identity unifies "subsets," "combinations," and the binomial theorem, and it mirrors the backtracking tree exactly: each `(1 + x)` factor is one level's include/exclude branch.

**Multiset subsets.** For a value with multiplicity `m`, the factor becomes `(1 + x + x² + … + x^m)` (choose 0..m copies). The product over distinct values is the sub-multiset generating function; evaluating at `x = 1` gives `∏(mᵢ + 1)`, matching §2. The coefficient of `x^t` counts sub-multisets of total size `t`.

**Permutations via exponential generating functions (EGFs).** Permutations are *labeled, ordered* structures, so they use EGFs (coefficients divided by `k!`). The EGF for "arrangements of a set" is `1/(1−x) = Σ_k k! · x^k / k!`, whose coefficient of `x^k/k!` is `k!` — the number of orderings of `k` items. The EGF framework composes: the number of permutations decomposed into cycles, derangements, and many constrained-permutation counts all fall out of EGF operations (the exponential formula). For our purposes the key takeaway is that the *factorial* in `n!` is the signature of EGFs, just as the *power* in `2^n` is the signature of OGFs.

*Derangement example.* The EGF for derangements (permutations with no fixed point) is `e^{−x}/(1−x)`, giving `D_n = n! Σ_{j=0}^{n} (−1)^j/j! ≈ n!/e`. So roughly `1/e ≈ 37%` of all permutations are derangements — a count you would *never* get cheaply by enumeration but that the EGF yields in closed form. This is the practical payoff of the GF machinery: constrained counts without generation.

*Why this matters for generators.* When a constraint admits a GF, you get a free *test oracle* (the expected count) and often a *direct unrank* (via the GF's structure), letting you generate constrained objects without rejection sampling. When it does not, you fall back to backtracking with a validity predicate — and the GF still tells you whether the expected output is small enough to enumerate at all.

**Vandermonde and hockey-stick.** Two identities recur in pruning analyses:
- **Vandermonde:** `Σ_j C(m, j) C(n, k−j) = C(m+n, k)` — splitting a combination across two groups; used when reasoning about combinations drawn from a partitioned candidate set. *Example:* combinations of size 2 from a 3+2 partition: `C(3,0)C(2,2) + C(3,1)C(2,1) + C(3,2)C(2,0) = 1 + 6 + 3 = 10 = C(5,2)` ✓.
- **Hockey-stick:** `Σ_{i=r}^{n} C(i, r) = C(n+1, r+1)` — the running total of combinations as the upper index grows; this is exactly the cumulative count an iterative combination generator passes through, and it bounds the work of prefix-pruned traversals. *Example:* `C(2,2)+C(3,2)+C(4,2) = 1+3+6 = 10 = C(5,3)` ✓.

These two evaluations are not busywork: the Vandermonde split is what lets you *parallelize* a combination enumeration by fixing how many elements come from each partition (each term is one shard's size), and the hockey-stick sum is the exact prefix count that an `unrank` routine subtracts as it walks down the indices. The algebra and the algorithm are the same object viewed two ways.

These identities are not decorative: they let you predict the *exact* number of nodes a pruned backtracking tree visits, which is how you prove a pruning rule changes the asymptotics rather than just the constant.

**Worked coefficient extraction (`n = 4`).** Expand `(1 + x)^4 = 1 + 4x + 6x² + 4x³ + x⁴`. Read off: `C(4,0)=1` (the empty subset), `C(4,1)=4` (singletons), `C(4,2)=6` (pairs), `C(4,3)=4`, `C(4,4)=1` (the full set). Sum of coefficients = `1+4+6+4+1 = 16 = 2⁴`. So if a problem asks "all subsets of size ≤ 2," the generating function tells you to expect `1 + 4 + 6 = 11` outputs *before you run anything* — an immediate test oracle and capacity estimate.

**Multiset worked example (`[1,2,2]`).** Generating function `(1 + x)·(1 + x + x²) = 1 + 2x + 2x² + x³`. Coefficients: one size-0 subset (`{}`), two size-1 (`{1},{2}`), two size-2 (`{1,2},{2,2}`), one size-3 (`{1,2,2}`). Total `1+2+2+1 = 6 = (1+1)(2+1)`, matching the §2 product formula and the §6 worked trace exactly. The product structure of the GF *is* the independence of the per-value choices that the backtracking tree explores level by level.

**Why GFs predict pruned tree sizes.** When a generator prunes by a size budget `≤ k`, the surviving nodes correspond to partial products truncated at degree `k`. Computing the truncated polynomial's coefficient sum (a partial-sum of binomials, i.e. a hockey-stick evaluation) gives the *exact* node count the pruned traversal visits — turning "is my pruning effective?" from a guess into an arithmetic check.

---

## 11. Amortized Analysis of Successor Functions

Iterative generation (§3 and §6 of `senior.md`) advances a current object to its successor on each call. A naive worst-case bound for `next_permutation` or the combination `advance` is `O(n)` per step (the suffix reversal / tail reset). But over a *full* enumeration the **amortized** cost is `O(1)` per object — a result worth proving because it justifies streaming all `n!`/`C(n,k)` objects in time proportional only to the output.

**Permutations — amortized O(1).** Consider enumerating all `n!` permutations by repeated `next_permutation` from the sorted start. The cost of one call is `O(1)` to find the pivot at depth `d` plus `O(n−d)` to reverse the suffix, where `d` is the pivot position from the right. The total work is `Σ` over all calls of `(n − d_call)`. A counting argument (analogous to the binary-counter increment amortization) shows that position `n−1−t` participates in a reversal only once every `(t+1)!` steps, so the total suffix-reversal work telescopes to `O(n!)` — i.e. `O(1)` per permutation amortized. The intuition matches the binary/factorial-counter analogy: most increments touch only the low digits; carries that ripple far are exponentially rare.

**The telescoping sum, explicitly.** Over a full enumeration of `n!` permutations, a suffix of length `ℓ` is reversed each time the pivot sits at position `n−1−ℓ`. The pivot reaches that depth exactly when the last `ℓ−1` positions are descending and the one before is about to bump — which happens once per `ℓ!`-block of consecutive permutations. So the number of length-`ℓ` reversals is `n!/ℓ!`, each costing `ℓ`. Total reversal cost:
```
Σ_{ℓ=2}^{n} ℓ · (n!/ℓ!) = n! · Σ_{ℓ=2}^{n} ℓ/ℓ! = n! · Σ_{ℓ=2}^{n} 1/(ℓ−1)! ≤ n! · (e − 1) = O(n!)
```
Dividing by the `n!` permutations gives `O(1)` amortized per permutation. The `(e − 1)` constant is the same Euler bound that appeared in the prefix-tree node count of §5 — both reflect that factorial decay makes deep work negligible.

**Combinations — amortized O(1).** The `advance` routine's tail-reset length equals the number of trailing indices at their maximum, which (by the same carry argument over the combinatorial number system) averages to a constant across all `C(n,k)` steps. Hence enumerating all combinations is `Θ(k · C(n,k))` total (the unavoidable cost of *writing* each size-`k` object), with `O(1)` amortized *advance* work on top.

*Worked advance trace (`n=4, k=2`).* Starting from `[0,1]`, repeated `advance` yields the six combinations with the indicated tail-reset lengths:
```
[0,1] → [0,2]   (bump tail, reset 0)        cost 1
[0,2] → [0,3]   (bump tail, reset 0)        cost 1
[0,3] → [1,2]   (tail maxed → bump head, reset tail 1)  cost 2
[1,2] → [1,3]   (bump tail)                 cost 1
[1,3] → [2,3]   (tail maxed → bump head, reset tail 1)  cost 2
[2,3] → done
```
Total advance work `1+1+2+1+2 = 7` over 5 transitions → `1.4` average, a constant independent of how large `C(4,2)` is; scaling `n,k` keeps this average bounded, confirming the `O(1)` amortized claim. The two "cost 2" steps are the rare carries; most steps just bump the last index.

**Subsets — true O(1) per step.** Bitmask enumeration increments an integer (`mask++`) and reads it; the increment is amortized `O(1)` (binary counter), and decoding the mask to a list is `O(popcount)` ≤ `O(n)` only when you materialize the list. Pure existence/iteration over masks is `O(1)` per step.

> **Why this matters in practice:** the amortized bounds mean a streaming generator has *no asymptotic penalty* versus a recursive one — you get bounded memory (`O(state)`) **and** output-optimal time. This is the theoretical justification for preferring iterators in production (`senior.md` §2–3).

**Loopless generation.** Stronger still, there exist *loopless* algorithms (Ehrlich, Knuth's Algorithm L/T) that produce each successor in **worst-case** `O(1)` (not just amortized) by maintaining auxiliary direction/inversion tables — used when a hard real-time per-step bound is required. The binary-reflected Gray code is the canonical loopless subset generator: `i ↦ i ⊕ (i>>1)` and the single-bit-change property mean each step flips exactly one element in `O(1)` worst case.

**Per-step cost summary.**

| Object | Method | Worst-case / step | Amortized / step | Total enumeration |
|--------|--------|-------------------|------------------|-------------------|
| Subsets | bitmask `mask++` | `O(1)` (existence) / `O(n)` (decode) | `O(1)` increment | `Θ(n·2^n)` |
| Subsets | Gray `i^(i>>1)` | `O(1)` (single toggle) | `O(1)` | `Θ(2^n)` toggles |
| Permutations | `next_permutation` | `O(n)` | `O(1)` | `Θ(n·n!)` |
| Permutations | Heap's algorithm | `O(1)` swap | `O(1)` | `Θ(n!)` swaps |
| Combinations | `advance` successor | `O(k)` | `O(1)` | `Θ(k·C(n,k))` |

Heap's algorithm is the classic loopless permutation generator: it produces all `n!` permutations with a single swap between consecutive outputs, achieving worst-case `O(1)` per step — at the cost of *not* being lexicographic. The trade-off mirrors the swap-vs-used-array choice of `middle.md`: you buy `O(1)` worst-case steps by giving up the natural order.

---

## 12. Counting vs Enumerating: Complexity Boundaries

A crucial distinction: **counting** how many objects satisfy a property is often vastly cheaper than **enumerating** them.

- **Enumeration is output-sensitive.** Listing all subsets/permutations/combinations is `Θ(size_of_object · number_of_objects)` — you cannot beat writing each one down. So `Θ(n·2^n)`, `Θ(n·n!)`, `Θ(k·C(n,k))` are optimal; no algorithm is "faster" because the output itself is that large.
- **Counting can be polynomial.** `2^n`, `n!`, `C(n,k)` are single formulas (`O(n)` arithmetic, or `O(1)` ignoring big-int cost). Counting subsets/permutations/combinations satisfying *linear* constraints often reduces to DP (e.g. count subsets summing to `t` via subset-sum DP in `O(n·t)`), avoiding enumeration entirely.
- **The hard middle.** Some "count the valid configurations" problems are **#P-hard** (e.g. counting the permanent / number of perfect matchings, counting Hamiltonian paths), even though *finding one* may be easy or NP-complete. Backtracking enumeration with pruning is the practical tool when no DP/formula exists, but it inherits the exponential output/branching bound.
- **Existence vs all.** "Is there a configuration?" (a decision problem) can short-circuit at the first success — average-case far cheaper than full enumeration, though still worst-case exponential.

> **Engineering corollary:** before writing a generator, ask *which* question you are answering. If it is "how many" or "does one exist," you may avoid the exponential blow-up entirely with a formula or DP. Enumerate only when you genuinely need every object materialized.

**A concrete contrast.** "How many subsets of `[a₁..a_n]` sum to exactly `t`?" can be answered by the subset-sum counting DP `dp[s] += dp[s − aᵢ]` in `O(n·t)` time and `O(t)` space — *polynomial*, no enumeration. But "**list** all subsets summing to `t`" is output-sensitive: if there are `M` such subsets the answer needs `Ω(M)` work, and `M` can itself be exponential. The counting DP and the enumeration share the *same recursive structure* (include/exclude on each element), yet differ exponentially in cost — purely because one collapses identical-sum states (memoization) while the other must keep them distinct (each is a different object to emit). This is the cleanest illustration of why "count" and "list" are different complexity classes despite identical-looking recursion.

*Worked DP (`[1,2,3], t=3`).* Build `dp[s]` = number of subsets summing to `s`, processing each element:
```
init:        dp = [1,0,0,0]         (empty subset sums to 0)
after a=1:   dp = [1,1,0,0]         ({}, {1})
after a=2:   dp = [1,1,1,1]         (+{2}, +{1,2})
after a=3:   dp = [1,1,1,2]         (+{3} → dp[3]=2: {1,2} and {3})
```
`dp[3] = 2` is computed in `O(n·t) = O(9)` operations. *Listing* those two subsets `{1,2}` and `{3}` requires walking the choice tree — fine here, but exponential in the worst case (e.g. all elements equal to a divisor of `t`). The DP gave the count without ever materializing a subset.

**The #P boundary, sharpened.** Counting problems form their own hierarchy: `#P` is the counting analog of `NP`. `#SUBSET-SUM-COUNT` with arbitrary weights is `#P`-hard, but with *small* integer targets the pseudo-polynomial DP escapes hardness. Counting *all* subsets (`2^n`) or *all* permutations (`n!`) is trivially `O(n)` because no constraint filters them. The hardness lives entirely in the *constraint*, not in the combinatorial object — a useful diagnostic when deciding whether to reach for a formula, a DP, or backtracking enumeration.

---

## Further Reading

- *The Art of Computer Programming, Vol. 4A: Combinatorial Algorithms, Part 1* (Knuth) — the definitive treatment of generating tuples, permutations, combinations, and Gray codes, including loopless algorithms (Algorithm L, Algorithm T).
- *Introduction to Algorithms* (CLRS) — combinatorics fundamentals, recurrences, and the analysis machinery used above.
- *Concrete Mathematics* (Graham, Knuth, Patashnik) — binomial identities (Vandermonde, hockey-stick) and generating functions in depth.
- *generatingfunctionology* (Wilf) — OGFs and EGFs as a calculus for counting.
- *Computational Complexity* (Arora, Barak) — the `#P` class and the counting-vs-decision gap.
- Sibling topic `professional.md` in `01-recursion-basics` — structural induction proofs for recursive algorithms.
- cp-algorithms.com — "Generating all combinations / subsets / permutations" and "Finding the next lexicographical permutation."

---

## Appendix: How These Foundations Generalize

The three primitives proved here are the base cases of a much larger theory; recognizing the pattern lets you transfer the proofs.

- **Cartesian products / `k`-ary tuples.** Listing all length-`L` strings over an alphabet of size `s` is the same tree with `s` children per node and depth `L`; the count is `s^L` (the `(1 + x + … )^L` generating function with `s` terms). Subsets are the special case `s = 2`. The completeness/uniqueness proof is identical (bijection between root-to-leaf bit/digit strings and tuples).
- **`k`-permutations and partial arrangements.** The used-array proof of §5, stopped at depth `k`, enumerates `P(n,k)` arrangements; the same bijection argument restricted to length-`k` injective sequences applies unchanged.
- **Constrained backtracking (N-Queens, Sudoku, graph coloring).** These add a *validity predicate* to the choice loop. The decision-tree model, termination lemma, and buffer-restoration invariant carry over verbatim; only the set of *valid* children shrinks. Completeness becomes "every valid object is reachable by one canonical path"; the proof obligations are the same two (completeness + injectivity).
- **Counting analogs collapse to DP.** Whenever the *count* (not the list) is wanted and partial states coincide, the enumeration tree folds into a DAG and the recursion memoizes — the subset-sum and permutation-count examples of §12. The bijection proof for enumeration becomes a recurrence-correctness proof for counting.
- **Symmetry reduction (Burnside / orbit counting).** When the objects themselves carry symmetry (rotations, reflections), the *number of distinct objects* is given by Burnside's lemma — the average number of fixed points over the symmetry group. The canonical-representative technique of §6 is the *generation*-side counterpart of Burnside's *counting*-side formula.

This is why mastering subsets, permutations, and combinations pays compound interest: every harder combinatorial-generation problem is one of these trees with extra predicates, a different branching factor, or a symmetry quotient — and the correctness machinery is always the same bijection-or-canonical-form argument.

**A unified checklist for proving any generator correct.** Whatever the object, establish:

1. **Termination** — the tree is finite (bounded depth, bounded branching).
2. **The restoration invariant** — every choice is undone, so sibling branches start from a clean state.
3. **Completeness** — define a canonical choice path for each distinct target object and show it is a valid root-to-output path (nothing is missed).
4. **Injectivity** — show distinct output nodes give distinct objects, i.e. the canonical path is unique (nothing is doubled).
5. **(If symmetric) Canonical form** — the pruning predicate emits a member iff it is the canonical representative of its equivalence class.

Steps 3 and 4 together are a bijection between emit events and distinct objects, which proves *both* correctness *and* the count formula in one stroke. This five-point template is the entire methodology of this file applied to subsets, permutations, combinations, and their duplicate-aware variants — and it transfers unchanged to every constraint-satisfaction backtracker you will write.

---

## 13. Summary

The combinatorics is exact and the algorithms are provably correct. The counts come from the multiplication principle: `2^n` subsets (independent in/out choices), `n!` permutations (falling product of position choices), `C(n,k) = n!/(k!(n−k)!)` combinations, and the multinomial `n!/∏mᵢ!` for multiset permutations. Each backtracking enumerator establishes a **bijection between its output nodes and the target objects** — completeness (every object reachable by one canonical choice path) plus injectivity (distinct nodes give distinct objects) — which simultaneously proves correctness and the count. The duplicate-skip rules are correct because they emit exactly the **canonical representative** of each distinct multiset object. `next_permutation` is the provable lexicographic successor (fix the longest non-increasing suffix, minimally bump the pivot, minimize the suffix), enumerating all distinct arrangements in order. Gray codes exist by the reflection construction and equal `i ⊕ (i>>1)`; the combinatorial and factorial number systems give bijective ranking/unranking. Finally, remember the boundary: **enumeration is output-optimal but exponential, while counting and existence can be polynomial** — choose the question before the algorithm.

The deeper lesson is that *structure is what makes generation tractable*: a total order turns "avoid duplicates" from an `Ω(M)` visited-set problem into an `O(state)` successor problem; a canonical form turns symmetric over-counting into a single pruning predicate; a number system turns "find the r-th object" into `O(n)` arithmetic. Every efficient combinatorial generator is, at bottom, an algorithm that *reads off* an algebraic structure (binomials, factorials, Gray reflection) rather than searching blindly. Internalize the five-point correctness checklist and the algebra behind the counts, and you can derive, implement, and *prove* any generator in this family — and the constraint-satisfaction backtrackers that build on them — from first principles.
