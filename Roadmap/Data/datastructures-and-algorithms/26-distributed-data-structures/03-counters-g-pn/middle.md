# Distributed Counters: G-Counter & PN-Counter — Middle Level

> A distributed counter is the "hello world" of CRDTs, but it is also the cleanest place to *see the lattice machinery work*. At this tier we stop treating "merge by max" as a recipe and start treating it as a theorem: the G-Counter state space is a product lattice, merge is its least upper bound, and convergence falls out of three algebraic properties. Once you can prove a G-Counter converges, the PN-Counter (and most of the CRDT zoo) becomes a corollary.

This page assumes you have read the [junior](junior.md) tier — you should already be comfortable with "every replica keeps a per-replica tally and takes the max on merge." Here we make that precise, prove it, build the op-based variant, and confront the one genuinely subtle thing about counters: **decrement**.

---

## Table of Contents

1. [Recap: what we are building on](#1-recap-what-we-are-building-on)
2. [The G-Counter as a product lattice](#2-the-g-counter-as-a-product-lattice)
3. [Convergence proof: merge = LUB ⇒ SEC](#3-convergence-proof-merge--lub--sec)
4. [Why value = Σ slots, and why you must never merge by summing](#4-why-value--σ-slots-and-why-you-must-never-merge-by-summing)
5. [The PN-Counter, formally](#5-the-pn-counter-formally)
6. [The op-based counter and the redelivery trap](#6-the-op-based-counter-and-the-redelivery-trap)
7. [Negative and arbitrary integer deltas](#7-negative-and-arbitrary-integer-deltas)
8. [Metadata cost: O(n) and the actor-id problem](#8-metadata-cost-on-and-the-actor-id-problem)
9. [Worked examples: partition and heal](#9-worked-examples-partition-and-heal)
10. [Code: Python and Go/Java](#10-code-python-and-gojava)
11. [Misconceptions, mistakes, cheat sheet, summary](#11-misconceptions-mistakes-cheat-sheet-summary)
12. [Further reading](#12-further-reading)

---

## 1. Recap: what we are building on

A **distributed counter** is a replicated integer that supports `increment` (and, for the PN-Counter, `decrement`) on any replica, at any time, **without coordination** — no locks, no leader, no consensus round before you can bump the value. Replicas exchange state asynchronously and must, after they have all seen the same set of updates, agree on the same total.

The naïve approach — store one shared integer and have each replica add to it — fails the moment two replicas increment concurrently. If replica A holds `5`, replica B holds `5`, both add `1` to get `6`, and then they merge, the merge function `max(6, 6) = 6` *loses one increment*. You wanted `7`. The single-integer representation has **thrown away the information needed to merge correctly**: it cannot tell "we both reached 6 independently" from "one of us reached 6."

The fix is the central idea of the whole topic: **make the state carry enough provenance that merge becomes information-preserving.** Instead of one integer, a **G-Counter** (grow-only counter) over `n` replicas keeps a *vector* — one non-negative integer per replica:

```
state = [ c_0, c_1, ..., c_{n-1} ]
```

Replica `r` only ever increments its *own* slot `c_r`. The visible value of the counter is the **sum of all slots**. Merge is **componentwise max**. Because replica A's increments live in slot A and replica B's in slot B, the two `+1`s from the previous paragraph land in *different* slots, and `max` keeps both. The total is `7`. Information was preserved.

This tier answers four "why" questions that the junior tier left as assertions:

- *Why* is componentwise-max the right merge, and not some other function?
- *Why* does that merge guarantee every replica eventually converges?
- *Why* can't a counter just be one G-Counter — why does decrement force a second one?
- *Why* is the op-based version simpler than op-based sets but still not free?

If you want the broader CRDT framing, see [CRDT Fundamentals](../01-crdt-fundamentals/middle.md); for the state-based vs operation-based dichotomy that this page leans on, see [State vs Op CRDTs](../02-state-vs-operation-based-crdts/middle.md).

---

## 2. The G-Counter as a product lattice

### 2.1 The objects we are reasoning about

Fix a finite set of replica identifiers. For concreteness say there are `n` of them, indexed `0 … n-1`. A G-Counter **state** is an element of

```
S = ℕ^n = ℕ × ℕ × … × ℕ   (n copies)
```

that is, an `n`-tuple of natural numbers (including 0). Each coordinate is the number of increments contributed *by that replica*. A state `s ∈ S` is written `s = (s[0], s[1], …, s[n-1])`.

### 2.2 The partial order

Define a relation `⊑` on `S` by **componentwise ≤**:

```
s ⊑ t   ⇔   s[i] ≤ t[i]   for every i in 0 … n-1
```

Read `s ⊑ t` as "`t` knows at least as much as `s`" — `t` has seen at least as many increments from every replica. This is a **partial** order, not a total one: two states can be incomparable. For `n = 2`, the states `(3, 1)` and `(1, 3)` satisfy neither `(3,1) ⊑ (1,3)` nor `(1,3) ⊑ (3,1)`. That incomparability is exactly the algebraic footprint of *concurrent, unmerged updates* on two replicas.

`⊑` is a genuine partial order: it is

- **reflexive** — `s ⊑ s`, since `s[i] ≤ s[i]`;
- **antisymmetric** — if `s ⊑ t` and `t ⊑ s` then `s[i] ≤ t[i]` and `t[i] ≤ s[i]` for all `i`, so `s[i] = t[i]`, so `s = t`;
- **transitive** — `≤` is transitive in each coordinate.

### 2.3 The join (least upper bound)

For any two states `s, t`, define their **join** `s ⊔ t` coordinatewise:

```
(s ⊔ t)[i] = max(s[i], t[i])
```

**Claim.** `s ⊔ t` is the *least upper bound* of `{s, t}` under `⊑`. To be a least upper bound it must satisfy two things.

1. **It is an upper bound.** For every `i`, `max(s[i], t[i]) ≥ s[i]` and `≥ t[i]`, so `s ⊑ s⊔t` and `t ⊑ s⊔t`. ✔
2. **It is the *least* upper bound.** Suppose `u` is *any* upper bound of `{s, t}`, i.e. `s ⊑ u` and `t ⊑ u`. Then for each `i`, `s[i] ≤ u[i]` and `t[i] ≤ u[i]`, so `max(s[i], t[i]) ≤ u[i]` (the max of two numbers each `≤ u[i]` is itself `≤ u[i]`). Hence `s ⊔ t ⊑ u`. So `s⊔t` is below every upper bound — it is the least one. ✔

Because every pair has a least upper bound, `(S, ⊑)` is a **join-semilattice**. (It is in fact a full lattice — componentwise `min` gives meets — but CRDTs only ever need joins.)

### 2.4 Why it is a *product* lattice

`ℕ` under `≤` is itself a join-semilattice with join `max`. `S = ℕ^n` is the `n`-fold **product** of that semilattice with itself, and the product of join-semilattices is a join-semilattice whose order and join are computed *coordinatewise*. That is the entire structural content of "G-Counter": it is the product lattice `(ℕ, ≤, max)^n`. Everything we prove later about G-Counters is really a fact about product lattices, which is why it transfers verbatim to the PN-Counter (a product of two such products) and beyond.

### 2.5 Local increment is monotone — and inflationary

`increment` at replica `r` is the function

```
inc_r(s) = s with s[r] replaced by s[r] + 1
```

Two properties matter:

- It is **inflationary**: `s ⊑ inc_r(s)`. The new state dominates the old one because slot `r` strictly grew and every other slot is unchanged. The state only ever moves *up* the lattice. This is the precise meaning of "grow-only."
- It touches **exactly one coordinate** — the replica's own. Replica `r` never writes another replica's slot. This non-interference is what lets concurrent increments on different replicas combine losslessly: they live in orthogonal coordinates, so `max` keeps all of them.

A state-based CRDT requires updates to be inflationary so that the sequence of states a replica passes through forms a monotonically increasing chain in the lattice. `inc_r` qualifies. Monotonicity is the bridge from "the lattice has joins" to "replicas converge," which is the next section.

---

## 3. Convergence proof: merge = LUB ⇒ SEC

### 3.1 What we want to prove

A state-based CRDT satisfies **Strong Eventual Convergence (SEC)**:

> Any two replicas that have **delivered the same set of updates** are in the **same state**, regardless of the *order* in which those updates and merges were applied.

For a G-Counter, "delivered the same set of updates" means each replica's state is the join of the same multiset of local states. We want: the *final* merged state is a function only of the *set* of states merged, not of the merge schedule.

### 3.2 The three algebraic laws of the merge

The merge operator is `⊔` (componentwise max). It inherits three laws from `max` on `ℕ`, proved coordinatewise:

**Commutative.** `s ⊔ t = t ⊔ s`.
Per coordinate, `max(s[i], t[i]) = max(t[i], s[i])`. ∎

**Associative.** `(s ⊔ t) ⊔ u = s ⊔ (t ⊔ u)`.
Per coordinate, `max(max(a, b), c) = max(a, b, c) = max(a, max(b, c))`. ∎

**Idempotent.** `s ⊔ s = s`.
Per coordinate, `max(a, a) = a`. ∎

A binary operation that is associative, commutative, and idempotent is exactly the join of a semilattice — these three laws *are* the definition of a join-semilattice, dressed as algebra rather than order theory. (The order is recoverable from the operation: `s ⊑ t ⇔ s ⊔ t = t`.)

### 3.3 From the three laws to SEC

Let `R` be the set (or multiset) of states a replica has merged in. Define its current state as the join over `R`. The three laws guarantee this is **well-defined independent of evaluation order**:

- **Commutativity** says the *order* of operands doesn't matter: `a ⊔ b = b ⊔ a`.
- **Associativity** says the *grouping/parenthesization* doesn't matter: you can fold the merges in any tree shape.
- **Idempotency** says *duplicates* don't matter: receiving the same state twice is the same as receiving it once (`a ⊔ a = a`).

Together: the join of a finite set `{s_1, …, s_k}` has a single value `s_1 ⊔ s_2 ⊔ … ⊔ s_k` no matter how messages were reordered, batched, regrouped, or redelivered. Two replicas that have absorbed the **same set** of states therefore compute the **same join**, hence end in the **same state**. That is SEC. ∎

This is worth pausing on: **the network is allowed to reorder, duplicate, and delay messages arbitrarily**, and SEC still holds, *because* the three laws neutralize exactly those three pathologies. Reordering ↔ commutativity. Re-batching ↔ associativity. Duplication ↔ idempotency. The lattice was engineered so that the merge operation is invariant under everything an asynchronous network can do to message delivery. This robustness is the headline advantage of state-based CRDTs and the thing op-based counters (§6) have to work to recover.

### 3.4 Why it is *strong* eventual

"Eventual consistency" usually only promises that replicas *eventually* agree, often via conflict resolution that may itself need coordination or human intervention. SEC is stronger: agreement is **deterministic and coordination-free** — it follows purely from having seen the same updates, with the merge function (not a tie-breaker, not a last-writer-wins clock, not an operator) doing all the work. There is no conflict to resolve because the lattice has no conflicts: every pair of states has a unique least upper bound.

---

## 4. Why value = Σ slots, and why you must never merge by summing

### 4.1 The query

The **value** (the externally visible count) of a G-Counter state `s` is

```
value(s) = Σ_i s[i]
```

the sum of all slots. This is the *query*, computed on demand from the state; it is **not** the state and it is **not** how states combine. Keeping these two operations separate is the single most important discipline with counters.

- **Merge** combines two *states* and must be `⊔` (componentwise max).
- **Value** projects a *state* to a *number* and is `Σ`.

Why is the value a sum while the merge is a max? Because the slots are **independent contributions**. Slot `i` records how many increments replica `i` has performed — these are disjoint events, so the grand total is their sum. Merge, by contrast, is reconciling **two views of the same slot**: replica A's belief about how far replica `i` has counted vs. replica B's belief. Two beliefs about the *same* monotonic quantity reconcile by taking the larger — the one that has seen more. Sum across slots; max within a slot.

### 4.2 The trap: merging by summing

It is tempting — and *wrong* — to define merge as componentwise **addition**:

```
WRONG:  merge(s, t)[i] = s[i] + t[i]
```

This breaks **idempotency**, and idempotency was load-bearing for SEC.

> **Concrete failure.** Replica A is in state `(2, 0)`. It sends its state to B. Then, due to a retry, the *same* message is delivered to B a second time (networks duplicate messages). With max-merge: `max((2,0),(2,0)) = (2,0)` — value 2, correct. With sum-merge: `(2,0) + (2,0) = (4,0)` — value 4. The duplicate delivery **double-counted**, and the counter is now permanently wrong, with no way to detect or undo it.

Even without duplicates, sum-merge is broken. Imagine A and B both started from a shared `(1, 0)`, neither incremented, and they merge: sum-merge yields `(2, 0)` — value 2 — out of two replicas that did *nothing*. Sum-merge counts the *gossip*, not the *increments*. The number of times two replicas exchange state is an artifact of the network topology and timing; it must have **zero** effect on the value. Only `max` has that property, because `max` is idempotent and sum is not.

The rule, burned in: **state-based merge of a counter is `max` per slot, never `+`.** Addition appears in exactly two legitimate places — incrementing your *own* slot locally (`s[r] += 1`), and summing slots to compute the *value*. It must never appear in `merge`.

---

## 5. The PN-Counter, formally

A G-Counter only grows. Real counters need to go down too: likes can be un-liked, inventory is consumed, "active sessions" rise and fall. But you **cannot** simply allow `dec_r(s) = s[r] - 1`, because decrement is **not inflationary** — it moves the state *down* the lattice, breaking monotonicity, and then merge-by-max silently undoes it (a replica that merges in an older, higher state resurrects the decremented value). The lattice machinery only works for monotonically growing quantities.

The **PN-Counter** (Positive-Negative counter) recovers decrement by a clean trick: track increments and decrements **separately**, each in its own grow-only counter, and subtract at query time.

### 5.1 State

A PN-Counter state is a pair of G-Counters:

```
state = (P, N)
        P = [p_0, p_1, …, p_{n-1}]   -- a G-Counter of increments
        N = [n_0, n_1, …, n_{n-1}]   -- a G-Counter of decrements
```

`P` only ever grows (it counts increments); `N` only ever grows (it counts decrements). Both obey the grow-only discipline of §2 individually.

### 5.2 Operations

```
inc_r(P, N) = (inc_r(P), N)      -- increment bumps your slot in P
dec_r(P, N) = (P, inc_r(N))      -- DECREMENT bumps your slot in N (it ADDS to N)
value(P, N) = (Σ P) − (Σ N)
```

The crucial sleight of hand: **a decrement is an *increment of N*.** We never decrement any slot of any vector. Decrement, the non-monotone operation, is re-expressed as a monotone operation (incrementing the decrement-tally) on a *second* grow-only structure. Both `P` and `N` therefore stay in the grow-only lattice, where all our proofs apply. The downward movement of the *value* is produced by the subtraction in the query, not by any slot going down.

### 5.3 It is a product of product-lattices

`P ∈ ℕ^n` and `N ∈ ℕ^n` are each elements of the product lattice from §2. The PN-Counter state space is their product:

```
S_PN = ℕ^n × ℕ^n   ≅   ℕ^{2n}
```

with order and join taken **componentwise across both vectors**:

```
(P, N) ⊑ (P', N')   ⇔   P ⊑ P'  AND  N ⊑ N'
(P, N) ⊔ (P', N')   =   (P ⊔ P',  N ⊔ N')
```

The product of two join-semilattices is a join-semilattice, so `S_PN` is again a join-semilattice and `⊔` is again its least upper bound. There is nothing new to prove from scratch.

### 5.4 Convergence

The merge `(P, N) ⊔ (P', N') = (P ⊔ P', N ⊔ N')` is **associative, commutative, and idempotent** because it is componentwise application of operations that are each associative, commutative, and idempotent (§3.2) on the two component lattices. By the *same* argument as §3.3, the PN-Counter satisfies SEC: any two replicas that have merged the same set of states compute the same `(P, N)`, hence the same `value = ΣP − ΣN`. ∎

Note that `value` can be negative (`ΣN > ΣP`), which is correct — distributed inventory and balance counters legitimately go negative across partitions, and the PN-Counter represents that faithfully. The state vectors `P` and `N` are *always* non-negative; only their difference can dip below zero.

### 5.5 The asymmetry you don't get for free

A PN-Counter converges, but it does **not** enforce a lower bound. If your domain says "this counter must never go below 0" (e.g. seats remaining), the PN-Counter will happily converge to `-3` after a partition where three replicas each decremented the same scarce resource. That is a *bounded-counter* problem (escrow / reservations), which is genuinely harder and needs coordination or a reservation protocol. The PN-Counter is the unbounded-integer CRDT; it is not a solution to "don't oversell." That distinction is a senior-tier topic — see [senior](senior.md).

---

## 6. The op-based counter and the redelivery trap

So far everything has been **state-based**: replicas ship whole states and merge with `⊔`. The **operation-based** (commutative replicated data type, CmRDT) alternative ships the *operations* instead.

### 6.1 The op-based design

When replica `r` is asked to increment by `k`, it:

1. applies the effect locally (its local value goes up by `k`), and
2. **broadcasts** the operation `increment(k)` to all other replicas.

On receiving `increment(k)`, a replica applies the same effect: add `k` to its local value. There is no per-replica vector at all in the simplest design — the local state can be a single integer, because the *operations*, not a merge function, carry the convergence burden.

### 6.2 Why op-based counters are unusually simple

For op-based CRDTs to converge, **concurrent operations must commute** — applying them in either order must reach the same state. For an op-based *set*, this is fiddly: an `add(x)` concurrent with a `remove(x)` does **not** commute (add-then-remove ≠ remove-then-add), which is why op-based sets need tagging schemes (unique tags per add, tombstones, OR-Set semantics) to recover commutativity.

Counters are blissfully easy here because **addition is commutative and associative**:

```
(v + a) + b = (v + b) + a
```

Any two increment operations commute *natively*, with no tags, no tombstones, no causal-ordering requirement. There is no concurrent operation that conflicts with `increment(k)`. This is why the op-based counter is one of the simplest CRDTs in existence: the algebra of the operation is already a commutative monoid.

### 6.3 The trap: delivery must be exactly-once (or dedup'd)

Here is the catch that bites people. The op-based effect `v += k` is **commutative but NOT idempotent**. Applying `increment(5)` twice adds 10, not 5. So:

> **If the network delivers an operation more than once, an op-based counter double-counts — permanently and undetectably.**

Recall §3.3: state-based merge neutralizes duplication *for free* because `⊔` is idempotent. The op-based counter has thrown away that safety net by shipping non-idempotent effects. To stay correct it must be handed a delivery guarantee:

- **Exactly-once delivery**, or
- **At-least-once delivery with deduplication** — the receiver tracks which operations it has already applied (by unique operation ID) and ignores repeats, or
- **Causal/reliable broadcast** with dedup, the standard substrate assumed in the CRDT literature for op-based CRDTs.

That requirement is a real cost. It pushes complexity *down into the messaging layer*: you now need a reliable, deduplicating broadcast channel, which in practice means message IDs, acknowledgements, and retransmission with idempotent receive-side filtering. The state-based counter needs none of that — it tolerates an unreliable, reordering, duplicating, gossip transport, because all the robustness lives in the lattice.

### 6.4 The trade-off in one line

| | State-based (CvRDT) | Op-based (CmRDT) |
|---|---|---|
| Ships | whole state (vector) | the operation `increment(k)` |
| Merge/apply property needed | assoc + comm + **idempotent** | assoc + comm (idempotent **not** required) |
| Tolerates duplicate delivery? | **Yes, for free** | **No** — needs dedup / exactly-once |
| Tolerates reordering? | Yes | Yes (increments commute) |
| Message size | O(n) per sync | O(1) per increment |
| Transport demanded | unreliable gossip OK | reliable, dedup'd broadcast |

This is the counter-specific instance of the general dichotomy in [State vs Op CRDTs](../02-state-vs-operation-based-crdts/middle.md): state-based moves robustness into the data structure (paying in message size and metadata), op-based moves it into the network (paying in delivery guarantees but sending tiny messages). For high-frequency counters where O(n) state sync is expensive, op-based with a reliable bus wins; for hostile networks where you can't trust delivery, state-based wins. Many production systems use **delta-state** CRDTs to get the best of both — small messages *and* idempotent merge — which is a senior topic.

---

## 7. Negative and arbitrary integer deltas

We motivated `N` with `decrement` (delta `-1`). The PN-Counter generalizes cleanly to **arbitrary integer deltas**, and seeing exactly how preserves the monotonicity invariant.

Given an arbitrary signed delta `d ∈ ℤ` at replica `r`, **split it by sign** and route each part to the grow-only vector that can absorb it monotonically:

```
add(d) at replica r:
    if d ≥ 0:  P[r] += d        -- positive part inflates P
    else:      N[r] += (−d)     -- negative part inflates N (note: −d > 0)
```

The key: **both vectors only ever receive non-negative additions.** A delta of `+7` adds 7 to `P[r]`; a delta of `−7` adds 7 to `N[r]`. In neither case does any slot of any vector decrease. So:

- `P` and `N` each remain grow-only, hence each remains an inflationary, monotone sequence in the product lattice `ℕ^n`.
- Both keep their idempotent max-merge, so SEC is preserved exactly as in §5.4.
- The value `ΣP − ΣN` correctly reflects the net of all signed deltas, because the subtraction reconstructs the sign at *query* time.

This is the whole reason for the P/N split: it **factors a non-monotone quantity (a signed integer that can go up or down) into two monotone quantities (two grow-only tallies)**, so that the lattice's growth-only requirement is satisfied. You never violate monotonicity; you re-encode the problem so monotonicity holds. The same factor-by-sign idea generalizes to other "can decrease" CRDTs, which is why understanding it here pays off later.

A subtlety: there are *infinitely many* `(P[r], N[r])` pairs with the same net (e.g. net `+3` is `(3,0)` or `(10,7)` or …). The PN-Counter does **not** canonicalize these — it keeps whichever pair the operations produced. Two replicas that saw the same operations get the *same* pair, so this doesn't threaten convergence; but it does mean `P` and `N` grow without bound even if the value oscillates around zero (a counter that goes +1, −1, +1, −1, … forever has bounded *value* but unbounded *metadata*). That unbounded growth is the seed of the actor-id / GC problem in §8.

---

## 8. Metadata cost: O(n) and the actor-id problem

### 8.1 The cost

A G-Counter stores one integer per replica that has ever incremented: **O(n)** where `n` is the number of distinct replica identifiers. A PN-Counter stores two such vectors: still **O(n)** (specifically `2n` integers). Per *query* you also pay O(n) to sum the slots, and per *merge* O(n) to take the componentwise max. These are fine when `n` is small and fixed.

### 8.2 Why `n` is not the number of *current* replicas

The dangerous part: `n` is the number of replica IDs **ever seen**, not the number currently running. Every slot is keyed by a replica ID, and there is no safe, coordination-free way for a live replica to know that some ID is *gone forever* and its slot can be dropped. If you delete a slot prematurely and a delayed message from that replica arrives later, merge-by-max could resurrect or distort the value. So slots tend to **accumulate**.

In real deployments replicas are not a fixed roster — they are processes, devices, browser tabs, ephemeral serverless workers, or client "actors" that come and go. Each new actor that performs even a single increment adds a permanent slot to the vector. Over months, a counter touched by millions of short-lived clients accrues a vector with **millions of slots**, almost all of them belonging to actors that will never act again. The counter's *value* is one number; its *state* is megabytes. This is the **actor-id growth** (a.k.a. tombstone/identity-bloat) problem, and it is the central practical headache of CRDT counters at scale.

### 8.3 Foreshadowing

How do you bound this? Use a **small, stable set of server-side actor IDs** rather than per-client IDs (clients send deltas to a server replica that owns a slot); periodically **compact** by having a coordinator collapse the vector once it can prove no in-flight messages reference an old ID; or adopt **delta-CRDTs** and bounded actor schemes. These mechanisms — and the trade-offs between them — are exactly the [senior](senior.md) material. For now, internalize the shape of the cost: **O(n) metadata where `n` is unbounded over time**, and that boundedness, not correctness, is what makes counters hard in production.

---

## 9. Worked examples: partition and heal

### 9.1 G-Counter across a partition

Three replicas `A, B, C`. State is a vector indexed `[A, B, C]`. Start from `(0, 0, 0)` everywhere.

**Before the partition** — a few increments propagate normally:

```
A inc:  A = (1,0,0)         gossip to B, C
B inc:  B = (1,1,0)         gossip to A, C
                            after gossip settles, all = (1,1,0), value 2
```

**Partition occurs:** `{A}` is split from `{B, C}`. No messages cross.

```
Side {A}:                       Side {B, C}:
  A inc, inc, inc                 B inc          → B,C eventually = (1,2,0)
  A = (4,1,0)                     C inc, inc     → B,C eventually = (1,2,2)
  value(A) = 5                    value = 5
```

During the partition each side's view is internally consistent but the two sides disagree (A thinks 5 = 4+1+0; B/C think 5 = 1+2+2, but for *different reasons*). The slots tell the true story.

**Heal:** the partition ends; A exchanges state with B/C. Merge = componentwise max:

```
A's state:    (4, 1, 0)
B/C's state:  (1, 2, 2)
merge (max):  (max 4 1, max 1 2, max 0 2) = (4, 2, 2)
value = 4 + 2 + 2 = 8
```

Every replica converges to `(4, 2, 2)`, value **8** — the true total of all 8 increments (3 by A pre/during, plus 1 by A pre-partition… let's recount cleanly: A did 1 (pre) + 3 (during) = 4; B did 1 (pre) + 1 (during) = 2; C did 0 (pre) + 2 (during) = 2; total 8 ✔). **No increment was lost, none double-counted**, and the merge required no coordination — just `max`. Idempotency means it is safe to re-run the heal merge any number of times; the result stays `(4,2,2)`.

### 9.2 PN-Counter across a partition

Same three replicas. State is `(P, N)`, each a `[A,B,C]` vector. Start all-zero. Suppose this is a "items in stock" counter.

**Before partition:** stock is incremented to 10. Say A added 6, B added 4: `P = (6,4,0)`, `N = (0,0,0)`, value `10`.

**Partition** `{A}` vs `{B, C}`:

```
Side {A}:                          Side {B, C}:
  A sells 2 items → 2 decrements     B sells 3 → N: B += 3
  N: A += 2                          C sells 1 → N: C += 1
  P = (6,4,0)                        P = (6,4,0)
  N = (2,0,0)                        N = (0,3,1)
  value = 10 − 2 = 8                 value = 10 − 4 = 6
```

The two sides now report different stock (8 vs 6) — that is the price of availability under partition, and it is *correct* given each side's local knowledge.

**Heal:** merge `P` and `N` componentwise by max.

```
P:  max((6,4,0),(6,4,0)) = (6,4,0)        ΣP = 10
N:  max((2,0,0),(0,3,1)) = (2,3,1)        ΣN = 6
value = 10 − 6 = 4
```

All replicas converge to value **4**: 10 added, 6 sold (2 + 3 + 1), net 4 ✔. Every decrement landed in a *distinct slot of N* (A's in `N[A]`, B's in `N[B]`, C's in `N[C]`), so `max` kept all of them — concurrent decrements did **not** clobber each other, for exactly the same reason concurrent increments don't: orthogonal slots.

This is also where the **bounded-counter caveat** (§5.5) shows itself: if pre-partition stock had been 4 and each side oversold during the partition, the healed value could go negative. The PN-Counter would converge to a *correct* (consistent, deterministic) negative number — it just can't *prevent* the oversell without coordination.

---

## 10. Code: Python and Go/Java

All snippets are runnable. Each ends with assertions that demonstrate convergence (order-, duplicate-, and reordering-independence).

### 10.1 Python — G-Counter and PN-Counter (state-based)

```python
from __future__ import annotations
from collections import defaultdict
from typing import Dict, Iterable


class GCounter:
    """Grow-only counter. State is replica_id -> count (a sparse N^n vector)."""

    def __init__(self, replica_id: str) -> None:
        self.replica_id = replica_id
        self.slots: Dict[str, int] = defaultdict(int)

    def increment(self, by: int = 1) -> None:
        if by < 0:
            raise ValueError("GCounter cannot decrement; use PNCounter")
        # Local update inflates ONLY this replica's own slot.
        self.slots[self.replica_id] += by

    def value(self) -> int:
        # Query = sum of all slots.
        return sum(self.slots.values())

    def merge(self, other: "GCounter") -> None:
        # Merge = componentwise max (the lattice join). Idempotent.
        for rid, cnt in other.slots.items():
            self.slots[rid] = max(self.slots[rid], cnt)

    def __le__(self, other: "GCounter") -> bool:
        # Lattice order: componentwise <=. (Missing slot counts as 0.)
        ids = set(self.slots) | set(other.slots)
        return all(self.slots[i] <= other.slots[i] for i in ids)

    def snapshot(self) -> Dict[str, int]:
        return dict(self.slots)


class PNCounter:
    """Positive-Negative counter = two G-Counters. value = sum(P) - sum(N)."""

    def __init__(self, replica_id: str) -> None:
        self.replica_id = replica_id
        self.P = GCounter(replica_id)  # increments
        self.N = GCounter(replica_id)  # decrements

    def increment(self, by: int = 1) -> None:
        self.add(by)

    def decrement(self, by: int = 1) -> None:
        self.add(-by)

    def add(self, delta: int) -> None:
        # Split signed delta by sign; each part inflates a grow-only vector.
        if delta >= 0:
            self.P.increment(delta)
        else:
            self.N.increment(-delta)

    def value(self) -> int:
        return self.P.value() - self.N.value()

    def merge(self, other: "PNCounter") -> None:
        # Product-lattice join: merge P with P, N with N (each componentwise max).
        self.P.merge(other.P)
        self.N.merge(other.N)


def merge_all(target, states: Iterable) -> None:
    for s in states:
        target.merge(s)


# ---------------------------------------------------------------------------
# Demonstration: G-Counter partition + heal (the §9.1 scenario)
# ---------------------------------------------------------------------------
def demo_gcounter() -> None:
    A, B, C = GCounter("A"), GCounter("B"), GCounter("C")

    # pre-partition
    A.increment()                 # A=1
    B.merge(A); C.merge(A)
    B.increment()                 # B=1
    A.merge(B); C.merge(B)

    # partition: {A} vs {B,C}
    A.increment(); A.increment(); A.increment()   # A side: A slot -> 4
    B.increment()                                  # B slot -> 2 (had 1)
    C.merge(B)
    C.increment(); C.increment()                   # C slot -> 2
    B.merge(C)

    # heal
    A.merge(B); A.merge(C)
    B.merge(A); C.merge(A)

    assert A.value() == B.value() == C.value() == 8, (A.value(), B.value(), C.value())
    assert A.snapshot() == B.snapshot() == C.snapshot() == {"A": 4, "B": 2, "C": 2}

    # Idempotency / reordering: re-merging in any order changes nothing.
    before = A.snapshot()
    A.merge(C); A.merge(B); A.merge(C)  # duplicates and reorders
    assert A.snapshot() == before
    print("G-Counter converged to value", A.value())


# ---------------------------------------------------------------------------
# Demonstration: PN-Counter partition + heal (the §9.2 scenario)
# ---------------------------------------------------------------------------
def demo_pncounter() -> None:
    A, B, C = PNCounter("A"), PNCounter("B"), PNCounter("C")

    A.increment(6); B.increment(4)         # stock -> 10
    for r in (A, B, C):
        for s in (A, B, C):
            r.merge(s)                     # everyone sees 10

    # partition {A} vs {B,C}
    A.decrement(2)                         # A sells 2
    B.decrement(3); C.decrement(1)         # B,C sell 3 and 1
    B.merge(C); C.merge(B)                 # B,C still talk to each other

    # heal: all-to-all merge
    for r in (A, B, C):
        for s in (A, B, C):
            r.merge(s)

    assert A.value() == B.value() == C.value() == 4, (A.value(), B.value(), C.value())
    print("PN-Counter converged to value", A.value())  # 10 added - 6 sold = 4


if __name__ == "__main__":
    demo_gcounter()
    demo_pncounter()
```

### 10.2 Python — op-based counter over a delivery simulator

This shows the redelivery trap of §6.3 concretely: with naïve apply, a duplicated message double-counts; with dedup, it is safe.

```python
from dataclasses import dataclass, field
from typing import Dict, List, Set
import random


@dataclass
class Op:
    op_id: str        # globally unique operation id
    delta: int        # increment amount (can be negative)


class OpCounter:
    """Operation-based counter. State is a single integer + a dedup set."""

    def __init__(self, dedup: bool) -> None:
        self.value = 0
        self.dedup = dedup
        self.applied: Set[str] = set()

    def apply(self, op: Op) -> None:
        if self.dedup and op.op_id in self.applied:
            return  # already seen this exact op; addition is NOT idempotent,
                    # so re-applying would double-count. Dedup makes it safe.
        self.applied.add(op.op_id)
        self.value += op.delta  # commutative, but NOT idempotent


class UnreliableBus:
    """Delivers each broadcast op to every replica, but may DUPLICATE and REORDER."""

    def __init__(self, replicas: List[OpCounter], dup_prob: float, seed: int) -> None:
        self.replicas = replicas
        self.dup_prob = dup_prob
        self.rng = random.Random(seed)
        self.queue: List[Op] = []

    def broadcast(self, op: Op) -> None:
        # enqueue at least once, maybe twice (duplication)
        self.queue.append(op)
        if self.rng.random() < self.dup_prob:
            self.queue.append(op)

    def deliver_all(self) -> None:
        self.rng.shuffle(self.queue)              # reordering
        for op in self.queue:
            for r in self.replicas:
                r.apply(op)
        self.queue.clear()


def run(dedup: bool) -> int:
    r1, r2, r3 = OpCounter(dedup), OpCounter(dedup), OpCounter(dedup)
    bus = UnreliableBus([r1, r2, r3], dup_prob=0.7, seed=42)

    ops = [Op("a1", +5), Op("b1", +3), Op("c1", -2), Op("a2", +4)]
    expected = sum(o.delta for o in ops)  # 5 + 3 - 2 + 4 = 10

    for op in ops:
        bus.broadcast(op)
    bus.deliver_all()

    converged = (r1.value == r2.value == r3.value)
    assert converged, "replicas must converge regardless of dedup"
    return r1.value if converged else -1, expected


if __name__ == "__main__":
    got_no_dedup, expected = run(dedup=False)
    got_dedup, _ = run(dedup=True)

    print(f"expected value          : {expected}")
    print(f"op-based WITHOUT dedup  : {got_no_dedup}  (duplicates double-count!)")
    print(f"op-based WITH dedup     : {got_dedup}  (correct)")

    # All replicas converge in BOTH runs (they apply the same ops the same way),
    # but only the dedup'd run converges to the CORRECT value.
    assert got_dedup == expected
    assert got_no_dedup != expected  # demonstrates the redelivery trap
```

Running it prints something like:

```
expected value          : 10
op-based WITHOUT dedup  : 17  (duplicates double-count!)
op-based WITH dedup     : 10  (correct)
```

The replicas *agree* in both runs — op-based increments commute, so order and even duplication leave all replicas in the *same* state — but without dedup that agreed-upon value is **wrong**. Convergence is not correctness; the op-based counter needs dedup (or exactly-once) to be *correct*, whereas the state-based counter gets correctness for free from idempotent merge.

### 10.3 Go — PN-Counter (state-based)

```go
package main

import "fmt"

// GCounter is a grow-only counter: replica id -> count (sparse N^n vector).
type GCounter struct {
	id    string
	slots map[string]int
}

func NewGCounter(id string) *GCounter {
	return &GCounter{id: id, slots: map[string]int{}}
}

func (g *GCounter) Increment(by int) {
	if by < 0 {
		panic("GCounter cannot decrement")
	}
	g.slots[g.id] += by // inflate only this replica's own slot
}

func (g *GCounter) Value() int {
	sum := 0
	for _, v := range g.slots {
		sum += v
	}
	return sum
}

// Merge = componentwise max (lattice join). Commutative, associative, idempotent.
func (g *GCounter) Merge(o *GCounter) {
	for id, c := range o.slots {
		if c > g.slots[id] {
			g.slots[id] = c
		}
	}
}

// PNCounter = two GCounters; value = sum(P) - sum(N).
type PNCounter struct {
	P *GCounter
	N *GCounter
}

func NewPNCounter(id string) *PNCounter {
	return &PNCounter{P: NewGCounter(id), N: NewGCounter(id)}
}

func (p *PNCounter) Add(delta int) {
	if delta >= 0 {
		p.P.Increment(delta) // positive part inflates P
	} else {
		p.N.Increment(-delta) // negative part inflates N
	}
}

func (p *PNCounter) Value() int { return p.P.Value() - p.N.Value() }

// Product-lattice join: merge P with P and N with N.
func (p *PNCounter) Merge(o *PNCounter) {
	p.P.Merge(o.P)
	p.N.Merge(o.N)
}

func mustEqual(a, b int) {
	if a != b {
		panic(fmt.Sprintf("not converged: %d != %d", a, b))
	}
}

func main() {
	A, B, C := NewPNCounter("A"), NewPNCounter("B"), NewPNCounter("C")

	A.Add(6)
	B.Add(4) // stock -> 10
	all := []*PNCounter{A, B, C}
	for _, r := range all {
		for _, s := range all {
			r.Merge(s)
		}
	}

	// partition {A} vs {B,C}
	A.Add(-2)
	B.Add(-3)
	C.Add(-1)
	B.Merge(C)
	C.Merge(B)

	// heal: all-to-all merge
	for _, r := range all {
		for _, s := range all {
			r.Merge(s)
		}
	}

	mustEqual(A.Value(), B.Value())
	mustEqual(B.Value(), C.Value())
	mustEqual(A.Value(), 4) // 10 added - 6 sold = 4
	fmt.Println("PN-Counter converged to value", A.Value())
}
```

### 10.4 Java — PN-Counter (state-based)

```java
import java.util.HashMap;
import java.util.Map;

final class GCounter {
    private final String id;
    private final Map<String, Long> slots = new HashMap<>();

    GCounter(String id) { this.id = id; }

    void increment(long by) {
        if (by < 0) throw new IllegalArgumentException("GCounter cannot decrement");
        slots.merge(id, by, Long::sum);          // inflate own slot only
    }

    long value() {
        long sum = 0;
        for (long v : slots.values()) sum += v;  // query = sum of slots
        return sum;
    }

    void merge(GCounter o) {                      // componentwise max = lattice join
        for (Map.Entry<String, Long> e : o.slots.entrySet())
            slots.merge(e.getKey(), e.getValue(), Math::max);
    }
}

final class PNCounter {
    private final GCounter p, n;

    PNCounter(String id) { this.p = new GCounter(id); this.n = new GCounter(id); }

    void add(long delta) {                        // split signed delta by sign
        if (delta >= 0) p.increment(delta);
        else            n.increment(-delta);
    }

    long value() { return p.value() - n.value(); }

    void merge(PNCounter o) {                      // product-lattice join
        p.merge(o.p);
        n.merge(o.n);
    }
}

public class CounterDemo {
    public static void main(String[] args) {
        PNCounter A = new PNCounter("A"), B = new PNCounter("B"), C = new PNCounter("C");
        PNCounter[] all = {A, B, C};

        A.add(6); B.add(4);                        // stock -> 10
        for (PNCounter r : all) for (PNCounter s : all) r.merge(s);

        A.add(-2); B.add(-3); C.add(-1);           // partitioned sells
        B.merge(C); C.merge(B);

        for (PNCounter r : all) for (PNCounter s : all) r.merge(s);  // heal

        if (A.value() != B.value() || B.value() != C.value() || A.value() != 4)
            throw new AssertionError("not converged: " + A.value());
        System.out.println("PN-Counter converged to value " + A.value());
    }
}
```

---

## 11. Misconceptions, mistakes, cheat sheet, summary

### 11.1 Misconceptions

- **"Merge takes the bigger total."** No. Merge is **per-slot** max, *then* sum. `max((4,1,0)) = ...` is meaningless; you take `max` coordinatewise and sum the *result*. Comparing totals would lose concurrent increments in different slots.
- **"A counter is just one integer with a clever merge."** A single integer cannot distinguish "we both reached 6" from "one of us reached 6." The per-replica vector *is* the cleverness; you can't compress it away without losing the merge.
- **"Decrement is increment by −1 on the same vector."** That breaks monotonicity and gets undone by max-merge. Decrement must be an *increment on a second grow-only vector* (`N`).
- **"Op-based counters are just easier, full stop."** They're easier *to make commute* (addition commutes natively) but *harder to deliver* — they need exactly-once or dedup because the effect isn't idempotent. State-based pushes the cost the other way.
- **"PN-Counters prevent the value going negative."** They don't. They converge to a correct value that *may* be negative. Enforcing a floor (no oversell) is a different, coordination-needing problem.
- **"Metadata is O(number of replicas running now)."** It's O(number of replica IDs *ever seen*), which only grows. That gap is the actor-id problem.

### 11.2 Common mistakes

- Defining `merge` as `s[i] + t[i]` (componentwise add). Breaks idempotency; duplicate gossip double-counts. **Always `max`.**
- Letting a client mint a fresh actor ID per request. The vector grows unbounded; use a small stable set of server-owned actor IDs.
- Using an op-based counter over an at-least-once bus **without** dedup. Silent, permanent over-count.
- Computing `value` by reading a single replica's own slot instead of summing all slots.
- Sharing one replica ID across two processes that increment concurrently — both write the same slot, and one's increments are lost to the other's `max`. **Each concurrent writer needs its own slot.**
- Forgetting that PN-Counter `P` and `N` grow even when the value oscillates around a constant; budget metadata for *operation count*, not *value*.

### 11.3 Cheat sheet

```
G-COUNTER (grow-only)
  state    : N^n           (one N per replica, sparse map id -> count)
  order    : s ⊑ t  iff  s[i] ≤ t[i]  for all i         (componentwise ≤)
  join ⊔   : (s ⊔ t)[i] = max(s[i], t[i])               (componentwise max = LUB)
  inc_r    : s[r] += k     (k ≥ 0; inflationary; touches only slot r)
  value    : Σ_i s[i]      (sum of slots)
  merge    : componentwise MAX  — NEVER sum (sum breaks idempotency)
  laws     : ⊔ is associative + commutative + idempotent ⇒ SEC

PN-COUNTER (positive-negative)
  state    : (P, N)        two G-Counters,  state space = N^n × N^n
  inc(k)   : P[r] += k
  dec(k)   : N[r] += k     (decrement is an INCREMENT of N)
  add(d)   : d≥0 → P[r]+=d ;  d<0 → N[r]+=(−d)           (split by sign)
  value    : ΣP − ΣN       (may be negative; that's correct)
  merge    : (P⊔P', N⊔N')  componentwise max on both     (product of lattices)

OP-BASED COUNTER
  ship     : the operation increment(k), not the state
  effect   : v += k        commutative ✔   idempotent ✘
  needs    : exactly-once  OR  at-least-once + dedup(op_id)
  vs state : tiny messages, but demands reliable/dedup'd delivery

COST
  metadata : O(n), n = replica IDs EVER seen (grows forever → actor-id bloat)
  query    : O(n) to sum   |   merge : O(n) to max
```

### 11.4 Summary

The G-Counter is the product lattice `(ℕ, ≤, max)^n`. Its merge is the **least upper bound** (componentwise max), and that single fact makes merge **associative, commutative, and idempotent** — which are precisely the three properties that neutralize message reordering, re-batching, and duplication, giving **Strong Eventual Convergence** with no coordination. The visible value is the **sum** of slots; you must merge with **max** and never with **sum**, because sum is not idempotent and would double-count duplicate gossip.

The PN-Counter recovers decrement without breaking monotonicity by **factoring the signed value into two grow-only counters** `(P, N)` and querying `ΣP − ΣN`. Its state space is the *product of two product-lattices*, so its convergence is the G-Counter's proof applied twice. The op-based counter is unusually simple because addition commutes natively — but it trades the state-based counter's free idempotency for a **delivery obligation** (exactly-once or dedup), or it double-counts. Finally, the cost is **O(n)** metadata where `n` is every replica ID ever seen — bounded correctness but unbounded *size* — which is the actor-id growth problem the [senior](senior.md) tier tackles head-on.

---

## 12. Further reading

- Shapiro, Preguiça, Baquero, Zawirski — *Conflict-free Replicated Data Types* (INRIA RR-7687, 2011), **§3** on counters. The canonical statement of the G-Counter and PN-Counter, the CvRDT/CmRDT split, and the lattice/LUB framing used throughout this page.
- Shapiro et al. — *A Comprehensive Study of Convergent and Commutative Replicated Data Types* (2011), the long companion report with full proofs.
- Companion tiers: [junior](junior.md) (intuition and first vectors), [senior](senior.md) (actor-id GC, bounded counters, delta-CRDTs, production deployments).
- Within this section: [CRDT Fundamentals](../01-crdt-fundamentals/middle.md) for the lattice/SEC framework, and [State vs Op CRDTs](../02-state-vs-operation-based-crdts/middle.md) for the delivery-vs-metadata trade-off that §6 specializes to counters.
