# CRDT Fundamentals — Senior Level

> **You already know** that CRDTs guarantee Strong Eventual Convergence (SEC) and that there are two flavors — state-based and operation-based. This tier is about the *formalism* (Shapiro et al.), the *proofs*, and the *bill*: CRDTs do not make distributed agreement free; they relocate its cost into metadata, tombstones, and causal delivery. By the end you will be able to argue precisely *when* a CRDT is the right tool, *when* you actually need consensus, and *how much* the convergence machinery costs in bytes and in delivery guarantees.

---

## Table of Contents

1. [Where we are](#1-where-we-are)
2. [The two formalisms, stated precisely](#2-the-two-formalisms-stated-precisely)
3. [Convergence proofs (sketches you can reproduce)](#3-convergence-proofs-sketches-you-can-reproduce)
4. [The causal-delivery assumption: what it buys, what breaks without it](#4-the-causal-delivery-assumption-what-it-buys-what-breaks-without-it)
5. [CRDTs vs consensus: the CAP framing](#5-crdts-vs-consensus-the-cap-framing)
6. [Anti-entropy and dissemination: gossip, Merkle trees, delta-state](#6-anti-entropy-and-dissemination-gossip-merkle-trees-delta-state)
7. [Causal stability, tombstones, and garbage collection](#7-causal-stability-tombstones-and-garbage-collection)
8. [Inflation and the monotonicity discipline at scale](#8-inflation-and-the-monotonicity-discipline-at-scale)
9. [Taxonomy: which structures are lattices, and what they cost](#9-taxonomy-which-structures-are-lattices-and-what-they-cost)
10. [Code: a DVV + tombstone-aware OR-Set with delta dissemination](#10-code-a-dvv--tombstone-aware-or-set-with-delta-dissemination)
11. [Performance and space analysis](#11-performance-and-space-analysis)
12. [Pitfalls](#12-pitfalls)
13. [Cheat sheet](#13-cheat-sheet)
14. [Summary](#14-summary)
15. [Further reading](#15-further-reading)

---

## 1. Where we are

From the lower tiers you carry three load-bearing facts:

- A **join-semilattice** is a partially ordered set `(S, ⊑)` in which every pair of elements has a **least upper bound** (LUB, the *join* `⊔`). Joins are **idempotent**, **commutative**, and **associative** (ICA).
- **Strong Eventual Convergence (SEC):** any two replicas that have *delivered the same set of updates* have *equal state*, with no consensus round and no rollback.
- **State-based (CvRDT)** ships state and merges with the join; **operation-based (CmRDT)** ships operations that must commute.

This tier replaces "intuition about merges" with the actual theorems. The reference is throughout:

> Shapiro, Preguiça, Baquero, Zawirski, *A comprehensive study of Convergent and Commutative Replicated Data Types*, INRIA RR-7506, 2011.

If you want the gentler ramps, see [junior](junior.md) and [middle](middle.md); the deployment-and-incident view is in [professional](professional.md).

---

## 2. The two formalisms, stated precisely

### 2.1 CvRDT — state-based, a monotonic join-semilattice

A **CvRDT** is a tuple `(S, ⊑, s⁰, q, u, m)`:

| Symbol | Meaning |
|--------|---------|
| `S` | the set of possible payload states |
| `⊑` | a partial order on `S` forming a **join-semilattice** |
| `s⁰` | the initial state (typically the bottom element `⊥`) |
| `q` | query functions (read-only, side-effect free) |
| `u` | update functions, each a **monotonic, inflationary** mutator: `s ⊑ u(s)` |
| `m` | the **merge** function, `m(s₁, s₂) = s₁ ⊔ s₂`, the LUB |

Three conditions make this converge:

1. **Updates inflate.** Every update moves the state *up* the lattice: `∀s. s ⊑ u(s)`. You never go down.
2. **Merge is the join.** `m` computes the LUB of its arguments under `⊑`. Because the join is ICA, `m` is idempotent (`m(s,s)=s`), commutative (`m(a,b)=m(b,a)`), and associative.
3. **Causal monotonicity of delivery.** Replicas exchange *states*; a replica only ever assigns `m(local, received)`, never an arbitrary value.

The payload is a *point in a lattice*; an update is a *climb*; a merge is *taking the higher of two climbs*. There is no notion of "old" — only "lower."

```
                 ⊤  (top, often never reached)
                 |
        a⊔b ●────────── join of two divergent states
            /  \
         a ●    ● b      ← two replicas diverged under partition
            \  /
             ●  s        ← common ancestor
             |
             ⊥  (bottom = initial state s⁰)
```

### 2.2 CmRDT — operation-based, commuting operations

A **CmRDT** is `(S, s⁰, q, t, u, P)`:

| Symbol | Meaning |
|--------|---------|
| `S`, `s⁰`, `q` | states, initial state, queries (as above) |
| `t` | **prepare** (a.k.a. *generator*): runs at the origin replica, side-effect-free, produces an op |
| `u` | **effect**: applies a prepared op to local state; must be applied **everywhere** |
| `P` | a **delivery precondition** on each op (e.g., "deliver in causal order") |

The op-based contract has *two* clauses doing the work:

1. **Concurrent operations commute.** For any two ops `f`, `g` that are **concurrent** (neither causally precedes the other), `u_f ∘ u_g = u_g ∘ u_f`. Order of application does not matter, so replicas that apply the same multiset converge.
2. **Delivery is exactly-once, in causal order.** The transport must deliver each op to each replica precisely once, and never deliver `op₂` before `op₁` if `op₁ → op₂` (happened-before). Concurrent ops may be delivered in any order — that's fine, they commute.

The crucial asymmetry: **state-based pushes the burden into the merge (idempotence + LUB); op-based pushes it into the channel (exactly-once + causal order).** The algebra is simpler for op-based (you only prove concurrent ops commute), but you now owe a reliable causal broadcast layer.

### 2.3 The equivalence result

Shapiro et al. prove the two models are **equally expressive**: any CvRDT can emulate a CmRDT and vice versa.

- **CvRDT → CmRDT.** Treat each state `s` as an op "merge with `s`." Merging is idempotent, commutative, associative, so these ops trivially commute and tolerate redelivery — the precondition `P` can be the trivial *no precondition*. (This is exactly why state-based is robust to lossy, reordering, duplicating channels: shipping a whole state *is* a self-contained, replayable op.)
- **CmRDT → CvRDT.** Encode the history of delivered operations as a lattice element — e.g., a set of unique operation identifiers ordered by inclusion, `⊑ = ⊆`, `⊔ = ∪`. Merge = set union of op-IDs; replaying state then re-derives the value. This is the standard construction and it tells you something deep: **the universal CRDT lattice is "the set of all causally-delivered events," ordered by `⊆`.** Every concrete CRDT (counter, set, sequence) is a *compression* of that event set into a smaller payload.

Equivalence is a theorem about *expressiveness*, not *cost*. The whole rest of this document is about the cost they pay differently.

---

## 3. Convergence proofs (sketches you can reproduce)

### 3.1 State-based: convergence is a lattice fact

**Claim.** If updates inflate and merge is the join, then any two replicas that have merged the same set of states reach the same state, *regardless of the order and multiplicity* of merges.

**Sketch.** Let `U = {s₁, …, sₙ}` be the set of states a replica has seen (its own updates plus received states). A replica's value is `⊔ U` — the join of everything it has folded in, because merge *is* `⊔` and `⊔` is ICA:

- *Idempotence* (`s⊔s=s`) ⇒ duplicate deliveries don't matter.
- *Commutativity* (`a⊔b=b⊔a`) ⇒ reorderings don't matter.
- *Associativity* (`(a⊔b)⊔c = a⊔(b⊔c)`) ⇒ regrouping doesn't matter.

The join of a fixed finite set is **unique** (it's the LUB, and LUBs are unique in a poset). So two replicas with the same `U` compute the same join. With enough anti-entropy, every replica's `U` grows to the same set, so all values equalize. ∎

The proof needs no assumption on the channel beyond *eventual* delivery: it can lose, reorder, and duplicate freely, because each of those failure modes is neutralized by one of the ICA laws. This is the state-based superpower — **the network can be adversarial as long as it's eventually thorough.** The price is in the payload (you ship state, §6) and in inflation discipline (§8).

### 3.2 Op-based: convergence needs the channel

**Claim.** If concurrent ops commute and the channel delivers exactly-once in causal order, replicas that have delivered the same multiset of ops converge.

**Sketch.** Take two replicas `A`, `B` that have delivered the same set of ops `O`. Sort `O` into any linear extension of the happened-before order `→`. For *causally-ordered* pairs (`f → g`), both replicas apply `f` before `g` (the channel guarantees it), so they agree on those. For *concurrent* pairs, the order may differ between `A` and `B`, but by hypothesis `u_f ∘ u_g = u_g ∘ u_f`, so the resulting state is identical. By induction over the partial order, applying all of `O` yields the same final state on both replicas. ∎

Three places this proof leans on the channel, and exactly what breaks if you remove each:

| Assumption removed | Failure |
|--------------------|---------|
| **Exactly-once** (op delivered twice) | A non-idempotent effect double-applies. "increment by 1" becomes "+2." Counters drift, sets resurrect removed elements. |
| **Causal order** (`op₂` arrives before its cause `op₁`) | An effect references state its cause hasn't created yet. `remove(x)` arrives before `add(x)` → either dropped (lost remove) or buffered indefinitely. |
| **Reliability** (op lost) | The op's update never converges; replicas permanently diverge on that update. |

> **Why op-based effects are usually *not* idempotent.** "Add element `e`" with a fresh unique tag is fine to redeliver only if you dedupe by tag — but the *raw* effect "insert into the underlying set" is idempotent, while "increment counter" is not. The general rule: op-based CRDTs assume the channel did the deduplication so the effect *may* be non-idempotent. The moment your transport can redeliver, you must re-introduce idempotence (tags, sequence numbers) — at which point you're paying state-based-like metadata anyway.

This is the heart of the engineering tradeoff: **op-based saves bandwidth but rents a causal-reliable-exactly-once broadcast; state-based pays bandwidth to rent *nothing* from the network.**

---

## 4. The causal-delivery assumption: what it buys, what breaks without it

Causal delivery means: if `op₁ → op₂` (op₁ happened-before op₂, transitively), then every replica delivers `op₁` before `op₂`. It does **not** order *concurrent* ops — that's the whole point, concurrency is allowed because concurrent ops commute.

Implementations realize causal delivery with **version vectors** (one counter per replica) or **dotted version vectors** (DVV, §7): a message carries the sender's vector; the receiver buffers the message until its own vector dominates the message's *predecessor* set, then delivers and advances.

A worked break. Two replicas, an OR-Set, op-based, *without* causal delivery:

```
Replica A:  add(x) ───────────────► (tag t1)
                         │ causally precedes
Replica A:  remove(x) ──►  (removes tag t1)

Network reorders: B receives remove(x){t1} FIRST.
B has no t1 to remove → the remove is a no-op or is dropped.
Later B receives add(x){t1} → x is present on B, absent on A.
Permanent divergence. SEC violated.
```

Causal delivery forbids exactly this reorder. Note the contrast with state-based: a state-based OR-Set ships `(adds, tombstones)` as *sets of tags*; merge is union of both sides; `remove` arriving "early" is impossible because there's no separate remove message — the tombstone travels *inside* the merged state. **State-based encodes causality structurally in the payload; op-based externalizes it to the channel.**

---

## 5. CRDTs vs consensus: the CAP framing

A senior must be able to draw the dividing line without hedging.

### 5.1 The CAP placement

Under a network partition (the `P` is not optional in any real WAN), a system must give up either consistency or availability:

| Approach | CAP | Under partition | Convergence | Coordination |
|----------|-----|-----------------|-------------|--------------|
| **Consensus** (Paxos, Raft, ZAB) | **CP** | minority side **rejects writes** (unavailable) | linearizable, single value | every committed write needs a quorum round-trip |
| **CRDT** | **AP** | *both* sides keep writing | eventual (SEC) once healed | **zero** coordination on the write path |

```
        CONSENSUS (CP)                         CRDT (AP)
   ┌──────────┐  ┌──────────┐          ┌──────────┐  ┌──────────┐
   │ Leader   │  │ Follower │          │ Replica A│  │ Replica B│
   └────┬─────┘  └────┬─────┘          └────┬─────┘  └────┬─────┘
        │  quorum     │                     │ local write │ local write
        │◄──────────► │                     │ (no wait)   │ (no wait)
   write blocks until majority         both accept; reconcile later
        │                                     │  anti-entropy  │
   PARTITION → minority                  PARTITION → both stay
   side cannot commit                    available, diverge, heal
```

### 5.2 What CRDTs structurally *cannot* do

This is where seniors separate from mid-levels. CRDTs converge to a **deterministic merge of concurrent writes** — they do **not** give you agreement on a *single* value or a *global invariant*. Concretely:

- **Uniqueness.** "This username is taken by exactly one account." Two partitions can each register `@alice`; the merge will keep *both* registrations (set union). You cannot enforce uniqueness without coordination, because uniqueness is precisely a *global agreement*. CRDTs give you AP; uniqueness is CP.
- **Global numeric invariants.** "Account balance ≥ 0." Two replicas each see balance `$100` and concurrently withdraw `$100`; the PN-Counter merges to `-$100`. The lattice has no idea your application forbids negatives — the merge is correct *as a lattice operation* but violates *your* invariant. This is the **bounded-counter** problem; it genuinely requires either reservations/escrow (split the budget across replicas ahead of time) or consensus at the boundary.
- **Total order / linearizability.** "Operation X observed effect of operation Y." Concurrent ops are, by definition, unordered. If your correctness needs "last write wins by *real* time," CRDTs give you LWW by *logical* timestamp, which can discard a write that a human would consider later.

> **The senior heuristic.** Use a CRDT when the data type's *merge of concurrent edits is a meaningful, acceptable answer* (shopping cart, presence, collaborative text, like-counts, feature flags, configuration). Use consensus when correctness depends on a *single agreed value or a crossing-zero invariant* (account uniqueness, inventory that must not oversell, leader election, sequencing money). Many real systems are **hybrids**: CRDTs for the hot, partition-tolerant path; a consensus service (or a serializable DB) guarding the few true invariants.

For the data-type-specific tradeoffs see [State-based vs Operation-based CRDTs](../02-state-vs-operation-based-crdts/senior.md), [Counters](../03-counters-g-pn/senior.md) (where the balance≥0 problem lives), and [Sets / OR-Set / LWW](../04-sets-or-set-lww/senior.md).

---

## 6. Anti-entropy and dissemination: gossip, Merkle trees, delta-state

SEC requires that updates *eventually reach everyone*. The mechanism is **anti-entropy** — background reconciliation that drives any pair of replicas toward equality. Three layers:

### 6.1 Gossip

Each replica periodically picks a random peer and exchanges state (or recent ops). Epidemic spread reaches all `n` replicas in `O(log n)` rounds with high probability. Gossip is robust (no single coordinator, tolerant of churn) and is the standard dissemination substrate (Dynamo, Riak, Cassandra).

### 6.2 The cost of shipping whole state

Naive state-based anti-entropy ships the **entire payload** every round. For an OR-Set of a million elements with tombstones, that's megabytes per gossip exchange — even when only one element changed. This is the dominant complaint against state-based CRDTs and it has two mitigations.

**Mitigation 1 — Merkle trees for *diffing*.** Instead of shipping state to discover differences, build a **Merkle tree** over the keyspace: leaves hash individual keys/segments, internal nodes hash their children. Two replicas compare roots; if equal, they're in sync (one hash exchanged). If not, they descend only into subtrees whose hashes differ, exchanging `O(d · log)` hashes to localize the divergent keys, then ship only those. This is Dynamo/Riak/Cassandra's read-repair-and-anti-entropy backbone. The Merkle idea — *summarize a large set with a small, comparable digest* — is the same family of probabilistic/compact-summary structures as the [Bloom Filter](../../21-advanced-structures/02-bloom-filter/senior.md); Bloom answers "is `x` maybe present," Merkle answers "do our sets differ, and where."

```
        root = H(L ∥ R)              compare roots:
       /             \                equal → in sync (1 hash)
   H(a∥b)          H(c∥d)             differ → recurse only the
   /    \          /    \                      differing subtree
  Ha     Hb      Hc     Hd
  |      |       |      |
 k1     k2      k3     k4   ← only k3 differs → ship k3 alone
```

**Mitigation 2 — Delta-state CRDTs.** The deeper fix, from:

> Almeida, Shoker, Baquero, *Delta State Replicated Data Types*, JPDC 2018 (and the 2016 conference version "Efficient State-based CRDTs by Delta-Mutation").

A **delta-mutator** `mδ` returns not the full new state but a **delta** — a small lattice element representing *just this change*, such that `m(s, mδ(s)) = u(s)`. Deltas are themselves join-irreducible (or close to it) lattice elements; you **join deltas into a delta-group** and ship the group, then the receiver merges the delta-group into its state with the *same* join. Because deltas merge with the ordinary LUB, **you keep all the state-based robustness (idempotent, commutative, associative, tolerant of lossy channels) while shipping op-sized messages.**

The catch deltas must handle: **delta-interval anti-entropy.** A receiver that missed delta #5 but got #6 might apply #6 to a state that's missing #5's effect; joins are idempotent and order-independent so the *value* is still safe, but the receiver must know it still needs #5. Implementations track per-neighbor *acknowledged delta intervals* and fall back to **full-state shipping** if a peer is too far behind (causal gap too large to bridge with retained deltas). So delta-CRDTs are: *op-sized in the common case, state-sized in the worst case, always state-based-safe.*

```
State-based:   ship S (whole payload) ........ big, robust, simple
Op-based:      ship op .................... tiny, needs causal+exactly-once channel
Delta-state:   ship δ (join-irreducible) .. tiny in common case,
                                            merges with the LUB → robust like state-based,
                                            full-state fallback on large gaps
```

---

## 7. Causal stability, tombstones, and garbage collection

Removes are where CRDTs get expensive, and where most production pain lives.

### 7.1 Why removes need metadata

In an **add-wins** OR-Set, "remove" cannot simply delete the element: a *concurrent* add must win, so you must distinguish "removed, and no concurrent add exists" from "removed, but someone re-added concurrently." The standard mechanism: every add creates a **unique tag** (dot), and remove records the *observed* tags as **tombstones**. The element is present iff it has at least one add-tag not covered by a tombstone.

```
add(x) → tag (A,1)         add-set:   {x:(A,1)}
remove(x) observes (A,1)   tombstone: {(A,1)}        → x absent
concurrent add(x) → (B,1)  add-set:   {x:(A,1),(B,1)} tombstone {(A,1)}
                                       → (B,1) survives → x PRESENT (add-wins)
```

The cost: **tombstones and tags accumulate.** Naively they never go away — that's the **unbounded-growth problem**. A set that has churned a million elements may store a million tombstones even if it currently holds ten elements.

### 7.2 Version vectors and dotted version vectors (DVV)

A **version vector** `VV = {A↦3, B↦5, …}` summarizes "I have seen the first 3 events from A, 5 from B." It compactly encodes *which* events a replica has observed, so a remove can say "I observed everything up to this VV" instead of listing tags.

Plain version vectors break under a subtle case: a *single* node handling *concurrent client writes* can't represent two concurrent values with one per-node counter. **Dotted Version Vectors (DVV)** fix this:

> Preguiça, Baquero, Almeida, Fonte, Gonçalves, *Dotted Version Vectors: Logical Clocks for Optimistic Replication* (2010) / *Brief Announcement: Efficient Causality Tracking in Distributed Storage* (PODC 2012).

A DVV separates each value's **dot** — a single `(replica, counter)` pair uniquely identifying *that write* — from a **version vector** summarizing its causal context. This lets you tag each individual value with its exact dot while still summarizing the rest of history compactly: metadata is `O(values + replicas)` rather than `O(events)`. DVVs are what make a tombstone-aware OR-Set scale; they back Riak's conflict tracking.

### 7.3 Causal stability: when a tombstone can be reclaimed

The garbage-collection insight: **a tombstone exists only to defeat a concurrent add. Once *no replica can ever again produce a concurrent add* for that tag, the tombstone is useless and can be reclaimed.**

An update is **causally stable** when *every* replica has observed it (equivalently, it is in the causal past of all replicas — the "stable" frontier of the causal history). Once an add-and-its-remove are causally stable across the whole membership, no future concurrent add referencing that tag can arrive (anything that *would* be concurrent has already been delivered or never will be), so:

- the tombstone can be **dropped**, and
- the corresponding entries can be **compacted out** of the version vector (collapse a contiguous prefix into the vector counter).

Computing causal stability requires knowing the **minimum** of all replicas' version vectors — i.e., the "everyone has at least this." That demands **stable membership knowledge** and liveness: a single permanently-down replica that never acks freezes the stable frontier and **blocks all GC**, so tombstones grow without bound. This is the operational Achilles' heel of CRDT removes, and why production systems impose membership timeouts, "tombstone TTL" heuristics, or fall back to anti-entropy that treats a long-absent node as removed.

```
Causal history (per add-tag):
   created ──► removed ──► [tombstone retained] ──► causally stable ──► GC
                                  ▲                        ▲
            still needed: a concurrent      every replica has seen it;
            add could reference this tag     no new concurrent add possible
```

---

## 8. Inflation and the monotonicity discipline at scale

State-based correctness rests on one discipline: **state only ever moves up the lattice, and merge is exactly the join.** Violate it and SEC silently dies. The failure modes worth memorizing:

**Failure 1 — A non-idempotent "merge."** Suppose someone implements a counter merge as `a + b` instead of `max`/per-replica-max. Now `merge(s, s) = 2s ≠ s` — not idempotent. Re-delivering the same state (which anti-entropy *will* do) double-counts. The fix is the G-Counter rule: payload is a vector of per-replica counters; merge is element-wise **max** (idempotent), value is the sum.

```
WRONG merge (scalar add):           RIGHT merge (per-replica max):
 s=5, redeliver s  → 5+5 = 10        s={A:5}, redeliver → max(5,5)=5  ✓
 NOT idempotent, diverges            idempotent, stable
```

**Failure 2 — A non-monotonic update.** An update that can *decrease* a coordinate (e.g., a "set counter to N" that lowers it) breaks `s ⊑ u(s)`. Two replicas concurrently "set" then merge → the join is `max`, so the *lower* set is silently lost or, worse, a later-but-smaller value disappears. Anything that needs decrement must be modeled as *two* monotone counters (PN-Counter: P up, N up, value = P − N).

**Failure 3 — A merge that isn't the LUB.** If `m(a,b)` returns something that is *not* the least upper bound (say it picks `a` when `a ⋢ b`), you lose associativity/commutativity and convergence collapses: replica order now matters. The contract is non-negotiable: **`m` must compute the join of a genuine semilattice.**

The discipline, stated as a checklist you can apply to any candidate type:

1. Is the payload a **join-semilattice**? (Is there a LUB for every pair?)
2. Is **merge exactly the LUB**? (Test `m(s,s)=s`, `m(a,b)=m(b,a)`, `m(m(a,b),c)=m(a,m(b,c))`.)
3. Does **every update inflate** (`s ⊑ u(s)`)?

If all three hold, SEC follows from §3.1 *for free*. If any fails, no amount of testing will save you — divergence shows up only under the specific reorder/duplicate the test suite didn't hit. (This is exactly where [property-based testing](../../README.md) earns its keep: generate random op interleavings and assert ICA + inflation.)

---

## 9. Taxonomy: which structures are lattices, and what they cost

Every CRDT is "some application value projected onto a lattice." The table below is the senior's mental index: the lattice underneath, and the metadata you pay for it.

| Structure | Underlying lattice / join | Concurrent semantics | Metadata cost | Tombstones? |
|-----------|---------------------------|----------------------|----------------|-------------|
| **G-Counter** | vector of per-replica counters; join = element-wise `max` | sum of all increments | `O(replicas)` | none |
| **PN-Counter** | two G-Counters (P, N); value = ΣP − ΣN | sum of inc − sum of dec | `O(replicas)` (×2) | none |
| **Bounded counter** | PN-Counter + per-replica reservations/escrow | enforces ≥0 via pre-split budget; needs coordination at boundary | `O(replicas)` + reservation state | none |
| **LWW-Register** | `(value, timestamp)`; join = max by timestamp | last writer (by logical clock) wins; silently drops the other | `O(1)` + clock | none (but loses data) |
| **MV-Register** | set of `(value, dot)`; join keeps causally-maximal | keeps *all* concurrent values for app to resolve | `O(concurrent values)` | none |
| **G-Set** | set; join = `∪` | union; add-only | `O(elements)` | n/a (no remove) |
| **2P-Set** | (add-set, remove-set); join = (`∪`, `∪`) | remove permanent (can't re-add) | `O(adds + removes)` | yes, **forever** |
| **OR-Set** | (elements×dots, tombstones); join = union, presence = uncovered dot | **add-wins** | `O(elements × tags + tombstones)` | yes, reclaim at causal stability |
| **OR-Map** | keys → CRDT values; join per-key | per-key add-wins; nested CRDT values | sum of value costs + key tags | yes (per key) |
| **RGA / sequence (text)** | tree/linked list of positioned, tagged elements; join by causal insertion | concurrent inserts interleave deterministically | `O(total chars ever inserted)` incl. tombstoned chars | yes (deleted chars tombstoned) |

Two readings of this table:

- **Counters and registers are cheap** (`O(replicas)` or `O(1)`) because their lattice is small and *removeless*. They never accumulate tombstones.
- **Sets, maps, and especially sequences are expensive** because their lattice must remember *identity* (dots) to make concurrent add/remove commute — and identity must outlive the element (tombstone) until causal stability. Sequence/text CRDTs are the worst: tombstones for *every character ever deleted* until GC, which is why long-lived collaborative documents need aggressive stability-driven compaction. See [Counters](../03-counters-g-pn/senior.md), [Sets / OR-Set / LWW](../04-sets-or-set-lww/senior.md), and [Sequence/Text CRDTs](../05-sequences-and-text-crdts/senior.md) for the full treatments.

---

## 10. Code: a DVV + tombstone-aware OR-Set with delta dissemination

A runnable sketch demonstrating the load-bearing senior concepts at once: **dotted tracking**, **add-wins removes**, **delta-mutators** (we ship deltas, not full state), **causal-stability-driven GC**, and a **partition-then-heal** simulation. Python primary; a compact Go merge core follows.

```python
"""
Delta-state, add-wins OR-Set with dotted version vectors (DVV-flavored)
and causal-stability garbage collection.

Concepts demonstrated:
  - Each add mints a unique DOT = (replica_id, seq). Dots are never reused.
  - Presence = element has >=1 dot NOT covered by the context (tombstone proxy).
  - merge = join: union of (dotted) elements, union of contexts. Idempotent,
    commutative, associative -> SEC.
  - delta-mutators return a SMALL CRDT representing just the change; we ship
    the delta, the receiver joins it with the SAME merge -> state-based-safe,
    op-sized messages.
  - GC: a dot is causally stable once EVERY replica's context covers it; then
    it can be compacted out of the context (prefix collapse). We expose the
    minimum-context computation that drives it.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, Set, Tuple, Iterable

Dot = Tuple[str, int]  # (replica_id, sequence)


@dataclass
class ORSet:
    replica_id: str
    # element -> set of dots currently asserting its presence
    dots: Dict[str, Set[Dot]] = field(default_factory=dict)
    # causal context: per-replica highest contiguous seq seen (a version vector).
    # A dot (r, n) is "known" iff n <= context[r]. Removed/observed dots that are
    # NOT in `dots` but ARE in the context act as tombstones implicitly.
    context: Dict[str, int] = field(default_factory=dict)

    # ----- internal: mint the next dot for this replica -----
    def _next_dot(self) -> Dot:
        seq = self.context.get(self.replica_id, 0) + 1
        self.context[self.replica_id] = seq
        return (self.replica_id, seq)

    # ----- delta-mutators: return a small ORSet (the delta) -----
    def add(self, e: str) -> "ORSet":
        d = self._next_dot()
        self.dots.setdefault(e, set()).add(d)
        delta = ORSet(self.replica_id)
        delta.dots[e] = {d}
        delta.context = {d[0]: d[1]}  # delta carries only its own causal info
        return delta

    def remove(self, e: str) -> "ORSet":
        # Add-wins remove: drop the dots we OBSERVE for e; their presence in the
        # context (and absence from `dots`) makes them tombstones. A concurrent
        # add (a dot we have NOT observed) survives.
        observed = self.dots.pop(e, set())
        delta = ORSet(self.replica_id)
        # delta's context covers the observed dots -> tells peers "these are gone"
        for (r, n) in observed:
            delta.context[r] = max(delta.context.get(r, 0), n)
        return delta

    def contains(self, e: str) -> bool:
        return bool(self.dots.get(e))

    def elements(self) -> Set[str]:
        return {e for e, ds in self.dots.items() if ds}

    # ----- the JOIN: merge another ORSet (or a delta) into self -----
    def merge(self, other: "ORSet") -> None:
        all_elems = set(self.dots) | set(other.dots)
        for e in all_elems:
            mine = self.dots.get(e, set())
            theirs = other.dots.get(e, set())
            # Keep a dot if: it's in BOTH, OR it's in one side and the OTHER
            # side has NOT observed it (not covered by the other's context).
            kept: Set[Dot] = set()
            for d in (mine | theirs):
                in_mine = d in mine
                in_theirs = d in theirs
                covered_by_other = (not in_theirs) and self._covers(other.context, d)
                covered_by_mine = (not in_mine) and self._covers(self.context, d)
                if in_mine and in_theirs:
                    kept.add(d)                       # both still assert it
                elif in_mine and not covered_by_other:
                    kept.add(d)                       # other never saw it -> survives
                elif in_theirs and not covered_by_mine:
                    kept.add(d)                       # we never saw it -> survives
                # else: one side removed it (covered) -> drop (tombstone wins)
            if kept:
                self.dots[e] = kept
            else:
                self.dots.pop(e, None)
        # contexts join by element-wise max (version-vector LUB)
        for r, n in other.context.items():
            self.context[r] = max(self.context.get(r, 0), n)

    @staticmethod
    def _covers(context: Dict[str, int], d: Dot) -> bool:
        r, n = d
        return context.get(r, 0) >= n

    # ----- GC: compact dots that are causally stable across all replicas -----
    def gc(self, min_context: Dict[str, int]) -> int:
        """Remove tombstone bookkeeping for dots every replica has observed.
        `min_context` = element-wise MIN of all replicas' contexts (the stable
        frontier). Returns count of compacted tombstone-dots. Live dots are NOT
        removed; only the implicit-tombstone slack in the context is reclaimable
        here we report how many observed-but-dead dots became stable."""
        reclaimed = 0
        for e, ds in list(self.dots.items()):
            # A *live* dot stays. Stability only lets us drop the need to
            # remember REMOVED dots, which we model implicitly via the context;
            # we count context positions now globally stable.
            pass
        # count stable positions (each replica's stable prefix is reclaimable
        # from explicit tombstone lists in a fuller impl).
        for r, n in min_context.items():
            reclaimed += max(0, n)  # illustrative: stable prefix length
        return reclaimed


def min_context(replicas: Iterable[ORSet]) -> Dict[str, int]:
    """The causally-stable frontier: a dot is stable iff EVERY replica covers it,
    i.e. element-wise MIN of all contexts. Blocks (stays low) if any replica lags."""
    rs = list(replicas)
    keys = set().union(*(r.context.keys() for r in rs)) if rs else set()
    return {k: min(r.context.get(k, 0) for r in rs) for k in keys}


# ---------------------------------------------------------------------------
# Simulation: partition, divergent edits, then heal via delta exchange.
# ---------------------------------------------------------------------------
def demo() -> None:
    A = ORSet("A")
    B = ORSet("B")

    # --- before partition: both add "milk", sync ---
    dA = A.add("milk")
    B.merge(dA)              # B learns milk via delta
    assert A.elements() == B.elements() == {"milk"}

    # --- PARTITION begins: deltas no longer flow ---
    # A: removes milk, adds eggs.  B: concurrently re-adds milk, adds bread.
    dA1 = A.remove("milk")   # A observes its milk-dot, tombstones it
    dA2 = A.add("eggs")
    dB1 = B.add("milk")      # CONCURRENT add (new dot, B unaware of A's remove)
    dB2 = B.add("bread")

    print("During partition:")
    print("  A:", sorted(A.elements()))   # {eggs}      (milk removed locally)
    print("  B:", sorted(B.elements()))   # {bread, milk}

    # --- HEAL: exchange the deltas both ways (op-sized messages) ---
    for d in (dB1, dB2):
        A.merge(d)
    for d in (dA1, dA2):
        B.merge(d)

    print("After heal:")
    print("  A:", sorted(A.elements()))
    print("  B:", sorted(B.elements()))
    assert A.elements() == B.elements(), "SEC violated!"
    # ADD-WINS: B's concurrent re-add of milk beats A's remove -> milk present.
    assert A.elements() == {"milk", "eggs", "bread"}, A.elements()
    print("Converged (add-wins): ", sorted(A.elements()))

    # --- GC: compute the stable frontier; only fully-observed dots reclaimable ---
    stable = min_context([A, B])
    print("Stable frontier (min context):", stable)
    print("A reclaimable (illustrative):", A.gc(stable))


if __name__ == "__main__":
    demo()
```

Expected output:

```
During partition:
  A: ['eggs']
  B: ['bread', 'milk']
After heal:
  A: ['bread', 'eggs', 'milk']
  B: ['bread', 'eggs', 'milk']
Converged (add-wins):  ['bread', 'eggs', 'milk']
Stable frontier (min context): {'A': 2, 'B': 2}
Reclaimable (illustrative): ...
```

The teaching points to extract:

- **`merge` is the join**, called identically for full states and for deltas — that's the delta-state guarantee (§6.2): op-sized messages, state-based safety.
- **Add-wins** falls out of the dot/context arithmetic: A's `remove("milk")` only tombstones the dot it *observed*; B's concurrent add has a *fresh, unobserved* dot, so it survives the merge.
- **Causal stability** is computed as the **min** over all contexts (`min_context`). If any replica is missing from the membership or stuck at a low counter, the frontier stays low and GC is blocked — exactly the §7.3 operational hazard, made concrete.

### Go merge core (the LUB, idempotent/commutative/associative)

```go
package orset

// Dot uniquely identifies one add: (replica, seq). Never reused.
type Dot struct {
	Replica string
	Seq     int
}

// ORSet: dotted elements + a version-vector context.
type ORSet struct {
	Dots    map[string]map[Dot]struct{} // element -> set of dots
	Context map[string]int              // replica -> highest contiguous seq
}

func covers(ctx map[string]int, d Dot) bool { return ctx[d.Replica] >= d.Seq }

// Merge is the JOIN: idempotent, commutative, associative -> SEC.
func (s *ORSet) Merge(o *ORSet) {
	elems := map[string]struct{}{}
	for e := range s.Dots {
		elems[e] = struct{}{}
	}
	for e := range o.Dots {
		elems[e] = struct{}{}
	}
	for e := range elems {
		mine, theirs := s.Dots[e], o.Dots[e]
		kept := map[Dot]struct{}{}
		seen := map[Dot]struct{}{}
		for d := range mine {
			seen[d] = struct{}{}
		}
		for d := range theirs {
			seen[d] = struct{}{}
		}
		for d := range seen {
			_, inMine := mine[d]
			_, inTheirs := theirs[d]
			switch {
			case inMine && inTheirs:
				kept[d] = struct{}{} // both still assert
			case inMine && !covers(o.Context, d):
				kept[d] = struct{}{} // other never observed it -> survives
			case inTheirs && !covers(s.Context, d):
				kept[d] = struct{}{} // we never observed it -> survives
				// else: removed by one side (covered) -> dropped (tombstone wins)
			}
		}
		if len(kept) > 0 {
			s.Dots[e] = kept
		} else {
			delete(s.Dots, e)
		}
	}
	for r, n := range o.Context { // version-vector LUB = element-wise max
		if n > s.Context[r] {
			s.Context[r] = n
		}
	}
}
```

Both implementations satisfy the §8 checklist: payload is a join-semilattice (dotted-set ∪ version-vector), merge is the LUB (set union with tombstone arithmetic + element-wise max), and every mutator inflates (adds a dot or extends the context — never decreases a counter).

---

## 11. Performance and space analysis

The single most useful senior table: the three dissemination models side by side. `m` = number of elements/ops changed since last sync, `S` = full payload size, `r` = number of replicas, `n` = total elements.

| Dimension | State-based (CvRDT) | Delta-state | Op-based (CmRDT) |
|-----------|---------------------|-------------|------------------|
| **Message size (typical)** | `O(S)` — whole payload | `O(δ)` ≈ `O(m)` — just the change | `O(op)` ≈ `O(1)` per op |
| **Message size (worst)** | `O(S)` | `O(S)` — full-state fallback on large causal gap | `O(op)` but may need replay |
| **Channel guarantees needed** | **eventual delivery only**; tolerates loss/reorder/dup | eventual delivery + delta-interval tracking; full-state fallback | **reliable, exactly-once, causal-order broadcast** |
| **Idempotent to redelivery?** | yes (merge = LUB) | yes (join) | **no** in general (effects may double-apply) |
| **Reorder-tolerant?** | yes | yes | concurrent ops yes; causal pairs **no** |
| **Metadata on disk** | full lattice incl. tombstones until GC | same as state-based | op-log / causal buffer + dedup metadata |
| **Anti-entropy cost** | high (ship state; mitigate with Merkle diff) | low (ship deltas; Merkle to localize gaps) | low (ship ops) but needs durable causal log |
| **Failure recovery** | trivial — re-merge any state | merge any retained delta or full state | must replay missing ops in causal order |
| **GC complexity** | causal-stability (min VV) | causal-stability + delta-interval pruning | causal-stability + op-log truncation |
| **Best fit** | small payloads, hostile/lossy networks, simplicity | large payloads, frequent small edits, WAN | high op-rate, you already own a reliable causal bus (e.g., Kafka with ordering, or a causal-broadcast lib) |

Worked numbers, OR-Set of `n = 1,000,000` elements, one `add` since last sync:

```
State-based gossip round:   ship ~ n entries ≈ 10s of MB   (even for 1 change!)
   + Merkle diff:           ~ log(n) hashes to localize    ≈ a few KB, then ship 1 element
Delta-state:                ship 1 delta (1 element + its dot) ≈ tens of bytes
Op-based:                   ship 1 op ≈ tens of bytes  — BUT requires causal+exactly-once channel
```

The decision collapses to one question: **do you already own a reliable causal-ordered exactly-once broadcast?** If yes, op-based is cheapest. If no (the common WAN/multi-region/offline-client reality), **delta-state is the senior default** — it gets op-sized messages while inheriting state-based's "the network can be a liar" robustness.

---

## 12. Pitfalls

- **Thinking CRDTs eliminate conflicts.** They *resolve* them deterministically; they do not *prevent* concurrent edits. LWW silently *discards* a value; OR-Set *keeps both*. Choose the type whose conflict semantics match the business meaning, and *tell the user* when a write was dropped.
- **Trying to enforce a global invariant.** "Username unique," "balance ≥ 0," "no overselling" are CP problems. A CRDT will converge to a state that violates your invariant and call it correct. Use reservations/escrow (bounded counter) or put a consensus/serializable boundary in front of those few writes.
- **Op-based over a lossy or duplicating channel.** Without exactly-once + causal delivery, non-idempotent effects double-apply and out-of-order removes resurrect data. If you can't guarantee the channel, switch to state/delta or add per-op dedup tags (and accept the metadata cost).
- **A merge that isn't the LUB.** Scalar `+` instead of per-replica `max`; "last value I received" instead of join. Both break idempotence/associativity → divergence under the *specific* reorder your tests missed. Property-test ICA + inflation.
- **Unbounded tombstone growth.** Every remove leaves metadata. Without causal-stability GC, a churn-heavy set grows forever. And GC is **blocked by any permanently-lagging replica** — so monitor the stable frontier and have a membership-eviction policy.
- **Assuming causal stability is cheap.** It needs everyone's version vector (a min over membership). Permanently-down nodes, flapping membership, and unbounded clock skew all stall GC. This is the #1 operational surprise in production CRDT stores.
- **LWW with wall-clock timestamps.** Clock skew makes "last write wins" mean "the write from the replica with the fastest clock wins." Use logical clocks / HLCs, and know that even then you *lose* the concurrent loser silently.
- **Forgetting deltas can fall back to full state.** A peer too far behind to bridge with retained deltas forces a full-state ship. Size your delta-retention window and your bandwidth budget for that worst case.

---

## 13. Cheat sheet

```
FORMALISMS
  CvRDT (state) = (S, ⊑, s⁰, q, u, m)   updates inflate (s⊑u(s)), m = LUB (join)
  CmRDT (op)    = (S, s⁰, q, t, u, P)   concurrent ops commute, deliver exactly-once causal
  EQUIVALENT in expressiveness (each emulates the other); DIFFERENT in cost.

CONVERGENCE
  State-based: SEC from join being Idempotent/Commutative/Associative
               -> tolerates LOSS, REORDER, DUPLICATE. Network may be adversarial.
  Op-based:    SEC needs channel = reliable + exactly-once + causal-order.
               Remove exactly-once -> double-apply. Remove causal -> resurrection.

CAP
  CRDT = AP (available under partition, eventual convergence)
  Consensus (Paxos/Raft) = CP (minority unavailable, single agreed value)
  CRDTs CANNOT enforce: uniqueness, balance>=0, total order. Those need CP.

DISSEMINATION
  gossip O(log n) rounds; Merkle tree to DIFF (ship only divergent keys)
  delta-state (Almeida/Baquero): ship join-irreducible δ, merge with the LUB
     -> op-sized messages + state-based robustness; full-state fallback on big gaps

REMOVES & GC
  tombstone needed to beat a CONCURRENT add (add-wins)
  version vector / DVV summarize observed events (DVV: dot per value + VV context)
  reclaim tombstone once CAUSALLY STABLE (every replica observed it = min VV)
  hazard: one lagging replica blocks GC -> unbounded growth

DISCIPLINE (checklist)
  1. payload is a join-semilattice?  2. merge == LUB (m(s,s)=s, comm, assoc)?
  3. every update inflates (s ⊑ u(s))?   all three -> SEC for free.
```

---

## 14. Summary

- **Two formalisms, one essence.** CvRDT moves the burden into the *merge* (a monotonic join-semilattice, merge = LUB, updates inflate); CmRDT moves it into the *channel* (concurrent ops commute, exactly-once causal delivery). Shapiro et al. prove them equivalent in *expressiveness* — but they pay differently, and that difference is the entire engineering decision.
- **The proofs are short and load-bearing.** State-based convergence is the uniqueness of the join of a set, neutralizing loss/reorder/duplicate via ICA. Op-based convergence needs the channel; remove exactly-once and you double-apply, remove causal order and you resurrect deleted data.
- **CRDTs are AP, not magic.** They converge on a deterministic merge of concurrent writes. They *cannot* enforce uniqueness, a `balance ≥ 0` invariant, or a total order — those are CP problems for consensus or reservations. Knowing this boundary is the senior skill.
- **The hidden costs are metadata, tombstones, and (for op-based) the channel.** State-based pays bandwidth; delta-state (Almeida/Baquero) recovers op-sized messages while keeping state-based robustness, and is the sensible WAN default. Removes cost tombstones tracked by version vectors / DVVs, reclaimable only at causal stability — which a single lagging replica can stall, producing unbounded growth.
- **The discipline is three checks:** semilattice payload, merge = LUB, inflationary updates. Satisfy them and SEC is free; violate any and divergence hides until the exact reorder your tests missed.

Next: the data-type-specific tradeoffs in [State-based vs Operation-based CRDTs](../02-state-vs-operation-based-crdts/senior.md), then the concrete types — [Counters](../03-counters-g-pn/senior.md), [Sets / OR-Set / LWW](../04-sets-or-set-lww/senior.md), and the hardest case, [Sequence/Text CRDTs](../05-sequences-and-text-crdts/senior.md). The Merkle/compact-summary machinery behind anti-entropy connects to [Bloom Filter](../../21-advanced-structures/02-bloom-filter/senior.md). For the operations-and-incident view, continue to [professional](professional.md).

---

## 15. Further reading

- **Shapiro, Preguiça, Baquero, Zawirski (2011).** *A comprehensive study of Convergent and Commutative Replicated Data Types.* INRIA Research Report RR-7506. — The canonical formalism: CvRDT/CmRDT definitions, the equivalence result, and the type zoo (counters, sets, registers, sequences). Read this one in full.
- **Shapiro, Preguiça, Baquero, Zawirski (2011).** *Conflict-free Replicated Data Types.* SSS 2011. — The shorter conference paper introducing the SEC definition and the CRDT name.
- **Almeida, Shoker, Baquero (2018).** *Delta State Replicated Data Types.* Journal of Parallel and Distributed Computing 111. (Conference version: *Efficient State-based CRDTs by Delta-Mutation*, NETYS 2015.) — Delta-mutators, delta-intervals, full-state fallback. The fix for state-based bandwidth.
- **Preguiça, Baquero, Almeida, Fonte, Gonçalves (2010 / 2012).** *Dotted Version Vectors: Logical Clocks for Optimistic Replication* and *Brief Announcement: Efficient Causality Tracking* (PODC 2012). — DVVs: per-value dots + version-vector context; the metadata that makes scalable removes possible.
- **Bieniusa, Zawirski, Preguiça, Shapiro, Baquero, Balegas, Duarte (2012).** *An Optimized Conflict-free Replicated Set.* INRIA RR-8083. — The "Optimized OR-Set": add-wins set with the version-vector trick that drops most per-element tombstones. The basis for the OR-Set in §10.
- **Baquero, Almeida, Shoker (2014/2017).** *Making Operation-based CRDTs Operation-based* / pure op-based CRDTs. — How to keep op-based correct over weaker channels (tagged reliable causal broadcast).
- **DeCandia et al. (2007).** *Dynamo: Amazon's Highly Available Key-value Store.* SOSP. — Version vectors, Merkle-tree anti-entropy, and "the application resolves conflicts" in production — the system context CRDTs grew out of.
- **Gilbert & Lynch (2002).** *Brewer's Conjecture and the Feasibility of Consistent, Available, Partition-tolerant Web Services.* — The CAP theorem proof; the formal grounding for "CRDT = AP, consensus = CP."
- **Kleppmann & Beresford (2017).** *A Conflict-Free Replicated JSON Datatype.* IEEE TPDS. — Composing CRDTs into nested maps/lists; where tombstone and metadata costs compound.
