# CRDT Fundamentals — Middle Level

> **Audience:** You have read the [junior](junior.md) file. You already know what replicas are, what eventual consistency means, you have seen a Grow-only Set (G-Set), and you have the intuition that a "good" merge should be commutative, associative, and idempotent.
> **Read time:** ~45 minutes.
> **Focus:** Turn that intuition into precise algebra. By the end you will be able to read the sentence "a state-based CRDT is a join-semilattice with monotonic updates and merge = join" and know *exactly* what every word means — and prove that such a structure converges.

---

## Table of Contents

1. [Recap, and where we're going](#1-recap-and-where-were-going)
2. [Partial orders: the substrate](#2-partial-orders-the-substrate)
3. [Join-semilattices: where merge lives](#3-join-semilattices-where-merge-lives)
4. [The CvRDT convergence theorem](#4-the-cvrdt-convergence-theorem)
5. [Strong Eventual Consistency (SEC)](#5-strong-eventual-consistency-sec)
6. [Op-based CRDTs (CmRDT): a preview](#6-op-based-crdts-cmrdt-a-preview)
7. [Monotonic semantics: lattice vs non-lattice operations](#7-monotonic-semantics-lattice-vs-non-lattice-operations)
8. [Designing a CRDT as a lattice](#8-designing-a-crdt-as-a-lattice)
9. [Worked example: the G-Counter](#9-worked-example-the-g-counter)
10. [Code: a generic lattice merge](#10-code-a-generic-lattice-merge)
11. [Complexity and metadata cost](#11-complexity-and-metadata-cost)
12. [Common Misconceptions](#12-common-misconceptions)
13. [Common Mistakes](#13-common-mistakes)
14. [Cheat Sheet](#14-cheat-sheet)
15. [Summary](#15-summary)
16. [Further Reading](#16-further-reading)

---

## 1. Recap, and where we're going

At the junior level you learned the *shape* of a Conflict-free Replicated Data Type (CRDT). Several replicas each hold a copy of some state. They take local updates without coordinating with anyone. Periodically they exchange state and **merge**. The magic claim was: if the merge function is **commutative** (`merge(a, b) = merge(b, a)`), **associative** (`merge(merge(a, b), c) = merge(a, merge(b, c))`), and **idempotent** (`merge(a, a) = a`), then no matter the order, duplication, or batching of messages, all replicas that have seen the same updates end up identical.

The G-Set was the canonical example. Each replica holds a set; a local "add" inserts an element; merge is **set union**. Union is commutative, associative, and idempotent, so the G-Set converges.

That is the right intuition. But three questions were left unanswered:

1. **Where do those three properties *come from*?** Is it luck that union has all three? Or is there a structure that *guarantees* them?
2. **What exactly does "converge" mean?** "Replicas end up the same" is a slogan. What is the precise theorem, and what is its proof?
3. **How do I design a *new* CRDT?** If I want a counter, or a register, or a max, what is the recipe? When does the recipe *fail* (why can't I just replicate `x := v`)?

The answer to all three is one piece of mathematics: the **join-semilattice**. This file builds it from the ground up.

```
junior intuition                middle formalization
-----------------               --------------------
"replicas, eventual         →   partial order ⊑  ("more informed than")
 consistency, G-Set"
"merge is commutative,      →   join ⊔ = least upper bound in a
 associative, idempotent"        join-semilattice (these three laws are
                                 THEOREMS, not assumptions)
"replicas end up the same"  →   CvRDT convergence theorem
                                 + Strong Eventual Consistency (SEC)
"add to a set, take a max"  →   monotonic (inflationary) update:
                                 state only moves UP the lattice
```

Here is the destination, stated once now so you can hold it in mind. We will define everything in it precisely over the next three sections:

> **State-based CRDT (CvRDT).** Choose a join-semilattice `(S, ⊑, ⊔)`. Represent each replica's state as an element of `S`. Require every local update to be **inflationary**: it moves the state to an element `≥` the old one. Define `merge = ⊔` (the join). Then all replicas that have observed the same set of updates converge to the same element of `S`, with no consensus and no coordination.

Every word — "semilattice", "join", "inflationary" — is about to become precise.

---

## 2. Partial orders: the substrate

Before lattices we need **partial orders**, because a lattice *is* a partial order with one extra guarantee.

### 2.1 Definition

A **partial order** on a set `S` is a binary relation `⊑` (read "is below or equal to", or for us, **"is less informed than or equal to"**) satisfying three laws for all `a, b, c ∈ S`:

| Law | Statement | Meaning for replicas |
|-----|-----------|----------------------|
| **Reflexive** | `a ⊑ a` | a state knows at least as much as itself |
| **Antisymmetric** | `a ⊑ b` and `b ⊑ a` ⟹ `a = b` | if two states each know everything the other does, they are the same state |
| **Transitive** | `a ⊑ b` and `b ⊑ c` ⟹ `a ⊑ c` | knowledge accumulates: chains compose |

The pair `(S, ⊑)` is called a **partially ordered set**, or **poset**.

The word *partial* is the crux. In a **total** order (like the integers under `≤`) any two elements are comparable: for all `a, b`, either `a ≤ b` or `b ≤ a`. In a *partial* order, two elements may be **incomparable** — neither `a ⊑ b` nor `b ⊑ a` holds. We write `a ∥ b`.

Incomparability is not a defect; it is the entire point. Two replicas that took independent, concurrent updates produce incomparable states. The lattice's job is to give us a canonical way to *combine* incomparable states without throwing anything away.

### 2.2 `⊑` as "more informed than"

The mental model that makes CRDTs click: **read `a ⊑ b` as "`b` is at least as informed as `a`"**, or equivalently "`b` is a possible future of `a`."

For a G-Set, the order is subset inclusion: `A ⊑ B` iff `A ⊆ B`. If replica 1 holds `{x}` and replica 2 holds `{x, y}`, then `{x} ⊆ {x, y}`, so replica 2 is *more informed* — it has seen everything replica 1 has, plus `y`. Replica 1's state is a possible past of replica 2's.

Now suppose replica 1 holds `{x, a}` and replica 2 holds `{x, b}`. Neither is a subset of the other: `{x, a} ∥ {x, b}`. They are **concurrent**. To reconcile them we will need their join, `{x, a, b}` — the smallest set that contains both.

### 2.3 A small poset and its Hasse diagram

A **Hasse diagram** draws a finite poset compactly. Rules:

- One node per element.
- Draw an edge **upward** from `a` to `b` when `a ⊏ b` (strictly below) and there is *nothing strictly between them* — `b` **covers** `a`.
- Higher on the page means more informed. Edges that follow from transitivity are *not* drawn (they are implied by following edges upward).

Take the powerset of `{a, b}`, that is all subsets of a two-element set, ordered by `⊆`:

```
                  {a, b}            ← top: most informed (knows both)
                 /      \
              {a}        {b}        ← incomparable: {a} ∥ {b}
                 \      /
                   { }              ← bottom: least informed (knows nothing)
```

Read it: `{}` is below everything (the empty set is a subset of every set). `{a}` and `{b}` sit at the same level, side by side, with **no edge between them** — that absence *is* the statement `{a} ∥ {b}`. `{a, b}` is above both. There is no drawn edge from `{}` straight to `{a, b}`, even though `{} ⊆ {a, b}`, because that relation is *implied* by going `{} → {a} → {a, b}`.

Notice what the diamond shape encodes:

- The two incomparable middle elements `{a}` and `{b}` have a **least upper bound** — the smallest element above *both* — which is `{a, b}`. That is their **join**.
- They also have a **greatest lower bound** — `{}`. That is their **meet** (we will mostly not need meets).

This diamond is the smallest interesting lattice, and almost every CRDT you will build is, at heart, a bigger version of it.

---

## 3. Join-semilattices: where merge lives

### 3.1 Upper bounds and least upper bounds

Fix a poset `(S, ⊑)` and two elements `a, b ∈ S`.

- An **upper bound** of `a` and `b` is any `u ∈ S` with `a ⊑ u` **and** `b ⊑ u`. (`u` is at least as informed as each of them.)
- A **least upper bound** (LUB), also called the **join** and written `a ⊔ b`, is an upper bound that is below every other upper bound: for every upper bound `u`, we have `a ⊔ b ⊑ u`.

In plain words: `a ⊔ b` is the **smallest state that is at least as informed as both `a` and `b`** — it combines their knowledge and adds *nothing extra*. For G-Sets, the join of `{a}` and `{b}` is `{a, b}`: it contains everything each holds, and not one element more.

### 3.2 Why the LUB must be unique (when it exists)

Uniqueness is not assumed — it is *forced* by antisymmetry. Suppose `j₁` and `j₂` are both least upper bounds of `a` and `b`. Because `j₁` is an upper bound and `j₂` is a *least* one, `j₂ ⊑ j₁`. By the symmetric argument, `j₁ ⊑ j₂`. Antisymmetry (`x ⊑ y` and `y ⊑ x` ⟹ `x = y`) gives `j₁ = j₂`.

This is why the merge of a CRDT is **deterministic**: the join is the *unique* answer, so two replicas computing `a ⊔ b` cannot disagree even in principle. Determinism is a free gift from the algebra.

### 3.3 Definition of a join-semilattice

A **join-semilattice** is a poset `(S, ⊑)` in which **every pair of elements has a least upper bound**. We then have a binary operation `⊔ : S × S → S`, and we write the structure as `(S, ⊑, ⊔)`.

(A full **lattice** also requires every pair to have a *greatest lower bound*, the meet `⊓`. CRDTs only need joins, so "join-semilattice" is the exact object. People often say "lattice" loosely; for state-based CRDTs they mean join-semilattice.)

A **bounded** join-semilattice additionally has a **bottom** element `⊥` with `⊥ ⊑ a` for all `a`. The bottom is the "knows nothing" initial state — `{}` for a G-Set, the all-zeros vector for a G-Counter. Every CRDT we design will be bounded, with `⊥` as the starting state of a fresh replica.

### 3.4 The three algebraic laws — derived, not assumed

Here is the payoff that answers junior-question #1. The join, defined purely from the order, **automatically** satisfies the three laws you took on faith. They are theorems.

**Idempotent: `a ⊔ a = a`.**
`a` is an upper bound of `a` and `a` (since `a ⊑ a` by reflexivity). Any upper bound `u` of `a` and `a` satisfies `a ⊑ u`, so `a` is the *least* one. Hence `a ⊔ a = a`. ∎

**Commutative: `a ⊔ b = b ⊔ a`.**
"Upper bound of `a` and `b`" is the same set of conditions as "upper bound of `b` and `a`" — order does not appear in the definition. Same upper bounds ⟹ same least upper bound. ∎

**Associative: `(a ⊔ b) ⊔ c = a ⊔ (b ⊔ c)`.**
Both sides equal the least upper bound of the *three* elements `{a, b, c}`. To see it: `(a ⊔ b) ⊔ c` is above `a ⊔ b` (hence above `a` and `b`) and above `c`, so it is an upper bound of all three. Any upper bound of all three is above `a`, `b`, `c`, hence above `a ⊔ b` and above `c`, hence above their join `(a ⊔ b) ⊔ c`. So `(a ⊔ b) ⊔ c` is the LUB of `{a, b, c}`. The identical argument shows `a ⊔ (b ⊔ c)` is *also* the LUB of `{a, b, c}`, and LUBs are unique, so the two are equal. ∎

This is the single most important idea in the whole topic. **Commutativity, associativity, and idempotence are not three lucky coincidences — they are three faces of one structure.** Pick a join-semilattice and merge with its join, and you get all three for free, forever, for any CRDT.

### 3.5 The canonical example: the set-union lattice

The powerset of any universe `U`, ordered by `⊆`, is a bounded join-semilattice:

- Order: `A ⊑ B` iff `A ⊆ B`.
- Join: `A ⊔ B = A ∪ B`. (Union is the smallest set containing both — exactly the LUB.)
- Bottom: `⊥ = {}`.

Take `U = {a, b, c}`. Its lattice is the Boolean cube:

```
                       {a, b, c}                     ← top
                     /     |     \
              {a, b}    {a, c}    {b, c}             ← pairs
                |   \   /    \   /   |
                |    \ /      \ /    |
                |     X        X     |
                |    / \      / \    |
               {a}    {b}        {c}                 ← singletons
                 \     |        /
                  \    |       /
                       { }                           ← bottom
```

(The `X` crossings just indicate that, for example, `{a}` sits below both `{a, b}` and `{a, c}`; the singleton-to-pair edges interleave.) Cleaner, level by level:

```
level 3:            {a,b,c}
                  /    |    \
level 2:     {a,b}  {a,c}  {b,c}
              | \    /  \    / |
level 1:     {a}   {b}     {c}
               \    |     /
level 0:           { }
```

Trace a few joins to feel the LUB:

- `{a} ⊔ {b} = {a, b}` — smallest set above both singletons.
- `{a} ⊔ {a, c} = {a, c}` — since `{a} ⊆ {a, c}`, the join is just the bigger one (consistent: when `a ⊑ b`, the join *is* `b`).
- `{a, b} ⊔ {a, c} = {a, b, c}` — the top, because together they reach every element.

Every state-based CRDT in this file is a structured version of this picture: a poset where each pair has a unique LUB, with `⊥` at the bottom and updates that climb upward.

---

## 4. The CvRDT convergence theorem

We now state and prove the central result. **CvRDT** stands for **Convergent Replicated Data Type** — the state-based formulation, due to Shapiro, Preguiça, Baquero, and Zawirski (2011).

### 4.1 The two hypotheses

A CvRDT is built from:

1. A bounded join-semilattice `(S, ⊑, ⊔)`. Each replica's state is an element of `S`, starting at `⊥`.
2. A merge operation, **defined to be the join**: `merge(a, b) := a ⊔ b`.
3. A family of **update operations**, each required to be **inflationary** (also called **monotonic** or **non-decreasing**): if `s'` is the state after applying an update to `s`, then **`s ⊑ s'`**. The update may move the state up the lattice or leave it where it is, but it may **never move it down**.

That third condition is the heart of the discipline. State only ever climbs. A replica never "forgets." Adding to a G-Set climbs (`A ⊆ A ∪ {x}`). Taking a max climbs (`m ≤ max(m, v)`). Overwriting with a smaller value would *descend*, and would be illegal — which is exactly why naive `x := v` is not a CRDT (Section 7).

### 4.2 What "convergence" means precisely

Each replica receives a stream of two kinds of events:

- **Local updates** (inflationary, by hypothesis).
- **Merges** of a remote state into the local one.

The network is allowed to be maximally hostile within the usual liveness assumption: messages can be **reordered**, **duplicated**, **delayed**, and **batched** arbitrarily; partitions can form and heal. The only assumption is **eventual delivery**: if a replica produces a state, every other replica eventually merges that state (directly or transitively) at least once.

> **Convergence theorem.** Under these conditions, any two replicas that have **delivered the same set of updates** (each update having reached each replica at least once, in *any* order, with *any* duplication) hold **exactly equal** states.

### 4.3 The proof, cleanly

The whole proof rests on the fact, proven in Section 3.4, that `⊔` is commutative, associative, and idempotent.

**Step 1 — A replica's state is a join of update-effects.**
Each local update, by being inflationary, contributes some "increment" to the state. Concretely, after a sequence of updates and merges, a replica's state equals the **join of all the per-update contributions it has observed**. Why? Merging is join, and applying inflationary local updates can be modeled as joining-in the new information. So the state of any replica is `⊔` of the contributions `{c₁, c₂, …, cₖ}` of every update it has seen, in *some* grouping and *some* order.

**Step 2 — Order does not matter (commutativity + associativity).**
By associativity, any *parenthesization* of `c₁ ⊔ c₂ ⊔ … ⊔ cₖ` gives the same result — batching messages or merging in a different grouping is irrelevant. By commutativity, any *permutation* gives the same result — receiving updates in a different order is irrelevant. So the join depends only on the **set** `{c₁, …, cₖ}`, not the sequence.

**Step 3 — Duplication does not matter (idempotence).**
If the same contribution `cᵢ` arrives twice, the multiset `{…, cᵢ, cᵢ, …}` joins to the same value as the set, because `cᵢ ⊔ cᵢ = cᵢ`. So re-merging an already-merged state, or receiving the same message twice, changes nothing. This is what makes the protocol safe over an at-least-once network.

**Step 4 — Conclusion.**
Two replicas that have delivered the **same set of updates** are each computing the join of the **same set** of contributions. Steps 2 and 3 say that join depends *only* on the set. Therefore the two states are equal. ∎

The structure of the proof is worth memorizing, because it tells you which network pathology each law defeats:

| Network reality | Defeated by | Lattice law |
|-----------------|-------------|-------------|
| Messages arrive **out of order** | order-independence | **commutativity** |
| Messages arrive **batched / regrouped** | grouping-independence | **associativity** |
| Messages arrive **more than once** | duplicate-immunity | **idempotence** |
| Replica **re-merges old state** | re-merge is a no-op | idempotence + monotonicity |
| **Partition heals**, both sides catch up | both reach the join of the union of updates | all three |

### 4.4 Why no consensus is needed

A consensus protocol (Paxos, Raft) is required when replicas must **agree on a single ordering** of operations — when the final state depends on *who went first*. CRDTs sidestep this entirely: because the merge is order-, grouping-, and duplicate-independent, **there is no "who went first" to agree on.** Every replica computes the same join of the same set regardless. Coordination is replaced by algebra. That is the trade CRDTs make, and the trade's cost is what you spend the senior file studying (some semantics — like "remove an element" — are hard or impossible to express monotonically).

---

## 5. Strong Eventual Consistency (SEC)

Plain **eventual consistency** promises only that *if updates stop, replicas will eventually agree on some value* — but it says nothing about *how*, and reconciliation may require a conflict-resolution callback, a "last writer wins" coin flip, or even human intervention.

**Strong Eventual Consistency (SEC)** is a sharper guarantee, defined by Shapiro et al. A replicated object provides SEC if it is eventually consistent **and** additionally:

> **SEC.** Any two replicas that have **delivered the same set of updates** have **equal state** — immediately and deterministically, with no further coordination, no conflict callback, and no rollback.

The difference from ordinary eventual consistency is the phrase "same set of updates" rather than "after updates quiesce." SEC does not wait for the system to go quiet. The instant two replicas have seen the same updates — even mid-flight, while other updates are still in transit — those two agree.

The convergence theorem of Section 4 **is exactly a proof that every CvRDT provides SEC.** "Same set of updates ⟹ equal state" is the theorem's conclusion verbatim. So:

> A correctly-built state-based CRDT gives Strong Eventual Consistency *by construction*, without any consensus round, lock, or coordinator.

This is the headline property and the reason CRDTs matter for offline-first apps, multi-region databases, and collaborative editors: each replica accepts writes locally with zero latency, yet the system is guaranteed to reconcile to a single, well-defined state.

A subtlety to carry forward: SEC concerns **convergence** (all replicas agree), not **correctness of intent**. A CRDT can converge to a state nobody wanted if its semantics are poorly chosen — for example, a set where concurrent add and remove always resolves to "add" may keep an element a user thought they deleted. Convergence is guaranteed by the algebra; *good* convergence semantics is a design problem, covered in [State-based vs Operation-based CRDTs](../02-state-vs-operation-based-crdts/middle.md) and the counter/set topics.

---

## 6. Op-based CRDTs (CmRDT): a preview

State-based is one of two dual formulations. The other is **operation-based**, abbreviated **CmRDT** for **Commutative Replicated Data Type**.

| | State-based (CvRDT) | Operation-based (CmRDT) |
|---|---|---|
| **What is shipped** | the whole state (an element of `S`) | a description of each *operation* |
| **Merge requirement** | `merge = join`; updates inflationary | **concurrent operations commute** |
| **Network requirement** | eventual delivery; reorder/dup/loss OK | **reliable causal-order broadcast**, each op delivered **exactly once** |
| **Convergence from** | semilattice algebra | operation commutativity + causal delivery |
| **Message size** | grows with state | size of a single op (usually tiny) |
| **Duplicate-safe?** | yes (idempotent join) | **no** — apply-twice corrupts; needs exactly-once |

The CmRDT convergence argument is the dual of Section 4: instead of "states join in any order," it is "**operations that are concurrent commute**, and operations that are causally related are delivered in causal order." Reliable causal delivery handles the ordering that the lattice handled for state-based; commutativity of concurrent ops handles the rest. The catch is the stronger network contract: because operations are *not* generally idempotent, the delivery layer must guarantee **exactly-once, causal** delivery — which is real engineering work (deduplication, vector-clock-tagged messages, anti-entropy).

There is a deep duality: **any state-based CRDT can be emulated by an op-based one and vice versa.** Each op-based update can be expressed as "ship the state delta," and each state-based merge as "replay the missing ops." The full treatment, including when to pick which, is the next topic: [State-based vs Operation-based CRDTs](../02-state-vs-operation-based-crdts/middle.md). For now: state-based trades larger messages for a forgiving network; op-based trades a demanding network for tiny messages.

---

## 7. Monotonic semantics: lattice vs non-lattice operations

This section answers junior-question #3 — the design recipe — by first establishing the rule it must obey. **An operation can be a CRDT update only if it can be made inflationary on some join-semilattice.** Equivalently: *the operation must never destroy information; it may only add.*

### 7.1 Why `x := v` (blind assignment) is not a lattice update

Consider a single shared variable and the operation "assign `x := v`." Replica A sets `x := 5`; concurrently replica B sets `x := 9`. Now merge. What is the result?

There is **no information-preserving answer**. Assignment *overwrites* — applying it can move the state *down* the order (from `9` to `5`), violating the inflationary requirement. The two concurrent writes are incomparable, and nothing in "assign" tells us how to take their LUB. To merge we must either (a) lose one write, or (b) bolt on extra structure (a timestamp, a per-replica slot) that turns "assign" into something monotonic. Plain assignment, by itself, is **not a join-semilattice operation** — that is the precise reason it cannot be a CRDT.

The fixes are exactly the standard registers:

- **LWW-Register**: attach a timestamp; the state is a pair `(timestamp, value)` ordered by timestamp; join keeps the later timestamp. Now "assign" only climbs (you can only move to a *newer* timestamp). Information *is* lost (the older write), but the loss is deterministic, so replicas still converge. (See Section 8.3.)
- **Multi-Value Register**: keep *all* concurrent values in a set tagged by version vectors; join = union of the still-concurrent values. Nothing is lost; the application resolves the ambiguity on read.

### 7.2 Which operations *are* monotonic

The table that you should internalize:

| Operation | Lattice? | Order `⊑` | Join `⊔` | Why |
|-----------|:--------:|-----------|----------|-----|
| **Add to a set** (G-Set) | ✅ | `⊆` | `∪` | union only grows; idempotent |
| **Max of a number** | ✅ | `≤` | `max` | max never decreases |
| **Min of a number** | ✅ | `≥` (reversed!) | `min` | min never increases — order flips |
| **Logical OR of a flag** | ✅ | `false ⊑ true` | `∨` | once true, stays true |
| **Increment-only counter** | ✅ | per-replica `≤`, product | elementwise `max` | see Section 9 |
| **Union of two maps (deep-merge values)** | ✅ | key-wise lattice | per-key join | product of lattices |
| **Assign `x := v`** | ❌ | — | — | overwrites; can descend; no canonical LUB |
| **Remove from a set** (naive) | ❌ | — | — | shrinks the set; descends the order |
| **Decrement a single counter** | ❌ | — | — | can descend; need PN-Counter (two G-Counters) |
| **Subtract / general arithmetic** | ❌ | — | — | not monotone in either direction |
| **Append-at-index / overwrite list slot** | ❌ | — | — | overwrite descends; needs sequence CRDT |

The pattern: **operations that only *accumulate* (union, max, OR, increment) are monotonic and trivially become CRDTs. Operations that *destroy* (overwrite, remove, subtract) are not — and become CRDTs only by re-encoding them as accumulation.** "Remove" becomes "accumulate a tombstone" (an *add* to a removed-set); "decrement" becomes "accumulate in a second increment-only counter" (PN-Counter). The recurring trick is: *turn destruction into a new kind of growth.*

This connects to ideas you have already met. A G-Set's join is literally set union — see the set primitives behind [Hash Tables](../../05-basic-data-structures/05-hash-tables/junior.md). And the "merge two growing sets, never shrink" discipline is the same monotone-union spirit as merging components in [Disjoint Set / Union-Find](../../12-disjoint-set/01-union-find/junior.md) (optional analogy): there too, sets only ever *combine*, never split.

---

## 8. Designing a CRDT as a lattice

The recipe falls straight out of the theory:

> **CRDT design recipe.**
> 1. Pick a **join-semilattice** `(S, ⊑, ⊔)` whose elements faithfully represent your datatype's observable state.
> 2. Identify a **bottom** `⊥` as the empty/initial state.
> 3. Define each **update** so that it is **inflationary** (`s ⊑ update(s)`).
> 4. Set `merge = ⊔`.
> Then the convergence theorem (Section 4) hands you SEC for free.

Three worked instantiations:

### 8.1 G-Counter as a product lattice of per-replica maxes

A grow-only counter across `n` replicas. State is a vector `v ∈ ℕⁿ`, one slot per replica.

- **Order**: `u ⊑ v` iff `u[i] ≤ v[i]` for *every* `i`. (This is the **product order**: a vector is below another only if it is below in *all* coordinates.)
- **Join**: `(u ⊔ v)[i] = max(u[i], v[i])` — elementwise max.
- **Bottom**: the all-zeros vector.
- **Update** `inc()` on replica `r`: `v[r] += 1`. Only replica `r` writes slot `r`. This is inflationary: every coordinate stays equal except slot `r`, which strictly increases.
- **Read** (the counter's value): `Σᵢ v[i]`.

Why this is a lattice: it is the **product of `n` copies of the `(ℕ, ≤, max)` semilattice**. The product of join-semilattices is a join-semilattice, with join taken coordinate-wise — a general and very useful construction. Full proof and PN-Counter (which adds decrements) in [G-Counter / PN-Counter](../03-counters-g-pn/middle.md).

### 8.2 Max-register

The simplest non-trivial CRDT. State is a single number; you can only `assign-max(v)`, which sets `state := max(state, v)`.

- **Order**: `(ℕ, ≤)`. **Join**: `max`. **Bottom**: `0` (or `−∞`).
- Update is inflationary because `max(state, v) ≥ state` always.
- Read returns the current max.

It is a one-coordinate G-Counter-style lattice and the spiritual core of many timestamp-based CRDTs.

### 8.3 LWW-Register as a lattice on `(timestamp, value)`

Last-Writer-Wins. State is a pair `(t, x)` of a timestamp and a value. Each write stamps the current (logical) time.

- **Order**: `(t₁, x₁) ⊑ (t₂, x₂)` iff `t₁ < t₂`, or (`t₁ = t₂` and we break ties deterministically, e.g. by replica id or by `value`). This is essentially a **total order on timestamps**, lifted to pairs.
- **Join**: `(t₁, x₁) ⊔ (t₂, x₂) = ` the pair with the larger timestamp (ties broken by the fixed rule).
- **Bottom**: `(−∞, default)`.
- **Update** `set(x)`: produce `(now, x)` where `now` exceeds any timestamp this replica has issued — inflationary because the timestamp only increases.

The subtle point: this lattice is (almost) **totally ordered**, so the join just picks the later write. That is *why* LWW "loses" concurrent writes — in a total order there are no incomparable elements to merge, so one write deterministically wins. LWW trades fidelity (a concurrent write is silently dropped) for the simplest possible merge. Whether that is acceptable is a semantics decision, not a correctness one: LWW still converges (provides SEC) perfectly.

These three — max-register (one max), G-Counter (a product of maxes), LWW-register (a max over timestamps) — show the same atom, `max` over a total order, reused at different shapes. Spotting that atom is most of CRDT design.

---

## 9. Worked example: the G-Counter

Let us make the G-Counter completely concrete with three replicas — call them **A**, **B**, **C** — and follow the numbers, including a partition that heals.

State is a 3-slot vector `[A, B, C]`. `inc()` on replica X increments slot X. `merge` is elementwise max. The visible count is the sum of slots.

**Initial state.** All replicas at bottom:

```
A: [0, 0, 0]   B: [0, 0, 0]   C: [0, 0, 0]
```

**Local updates during a partition** (A and B can talk; C is isolated):

```
A does inc() ×2  →  A: [2, 0, 0]
B does inc() ×1  →  B: [0, 1, 0]
C does inc() ×3  →  C: [0, 0, 3]    (partitioned off)
```

**A and B sync** (elementwise max of `[2,0,0]` and `[0,1,0]`):

```
merge: [max(2,0), max(0,1), max(0,0)] = [2, 1, 0]
A: [2, 1, 0]   B: [2, 1, 0]         count = 2+1+0 = 3
C: [0, 0, 3]   (still isolated)     count = 3
```

Note A and B are now **equal** — they delivered the same set of updates (`A:+2`, `B:+1`), so by SEC they match, even though C is still off in the wilderness.

**More local work, still partitioned:**

```
A does inc() ×1  →  A: [3, 1, 0]    count = 4
C does inc() ×1  →  C: [0, 0, 4]    count = 4
```

**Partition heals — everyone exchanges and merges.** Take the elementwise max across all three vectors `[3,1,0]`, `[2,1,0]`, `[0,0,4]`:

```
merged = [max(3,2,0), max(1,1,0), max(0,0,4)] = [3, 1, 4]
A: [3, 1, 4]   B: [3, 1, 4]   C: [3, 1, 4]
count = 3 + 1 + 4 = 8
```

**Check.** Total increments performed: A did 3, B did 1, C did 4 → 8. The converged count is 8. Correct, and *every replica is identical*.

**Now stress the algebra — reorder and duplicate the heal.** Suppose during the heal C's vector arrives at A **twice**, and B's arrives **before** A's local one. Replay:

```
A: [3,1,0]
  ⊔ [0,0,4]  (C, 1st copy)  = [3,1,4]
  ⊔ [2,1,0]  (B)            = [3,1,4]
  ⊔ [0,0,4]  (C, DUPLICATE) = [3,1,4]   ← idempotent: no change
                          → [3,1,4]
```

Different order, a duplicate, same result `[3,1,4]`. That is the convergence theorem in action: commutativity beat the reordering, idempotence absorbed the duplicate. The number 8 was never in doubt.

| Replica | Pre-heal vector | Count | Post-heal vector | Count |
|---------|-----------------|------:|------------------|------:|
| A | `[3, 1, 0]` | 4 | `[3, 1, 4]` | 8 |
| B | `[2, 1, 0]` | 3 | `[3, 1, 4]` | 8 |
| C | `[0, 0, 4]` | 4 | `[3, 1, 4]` | 8 |

---

## 10. Code: a generic lattice merge

The point of the algebra is that **merge is the same code for every CRDT** — only the state representation and the inflationary update differ. We capture that with a `LatticeState` interface: anything that can `merge` (join) with a peer and report its `value` is a CRDT. Then G-Set and G-Counter are just two implementations.

### 10.1 Python

```python
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Dict, Set, Hashable
import random


class LatticeState(ABC):
    """A bounded join-semilattice element: the state of one CRDT replica."""

    @abstractmethod
    def merge(self, other: "LatticeState") -> "LatticeState":
        """Return self ⊔ other (the join / least upper bound).

        Must be commutative, associative, and idempotent — which it is
        automatically when it computes a genuine LUB.
        """

    @abstractmethod
    def value(self):
        """The application-visible value derived from the lattice state."""


# ---------------------------------------------------------------------------
# G-Set: the powerset(U) lattice, ordered by ⊆, join = ∪, bottom = {}.
# ---------------------------------------------------------------------------
class GSet(LatticeState):
    def __init__(self, elements: Set[Hashable] | None = None):
        self.elements: Set[Hashable] = set(elements or ())

    def add(self, x: Hashable) -> "GSet":          # inflationary: A ⊆ A ∪ {x}
        self.elements.add(x)
        return self

    def merge(self, other: "GSet") -> "GSet":       # join = set union
        return GSet(self.elements | other.elements)

    def value(self) -> Set[Hashable]:
        return set(self.elements)

    def __repr__(self) -> str:
        return f"GSet({sorted(self.elements)})"


# ---------------------------------------------------------------------------
# G-Counter: product lattice ℕⁿ, ordered coordinate-wise, join = elementwise
# max, bottom = all-zeros. State is a dict replica_id -> count.
# ---------------------------------------------------------------------------
class GCounter(LatticeState):
    def __init__(self, counts: Dict[str, int] | None = None):
        self.counts: Dict[str, int] = dict(counts or {})

    def inc(self, replica: str, by: int = 1) -> "GCounter":   # inflationary
        if by < 0:
            raise ValueError("G-Counter only grows; use a PN-Counter to decrement")
        self.counts[replica] = self.counts.get(replica, 0) + by
        return self

    def merge(self, other: "GCounter") -> "GCounter":          # elementwise max
        keys = set(self.counts) | set(other.counts)
        return GCounter({
            k: max(self.counts.get(k, 0), other.counts.get(k, 0)) for k in keys
        })

    def value(self) -> int:
        return sum(self.counts.values())

    def __repr__(self) -> str:
        return f"GCounter(sum={self.value()}, {dict(sorted(self.counts.items()))})"


# ---------------------------------------------------------------------------
# Simulate convergence under reordering, duplication, and partition healing.
# We merge an arbitrary *shuffled, duplicated* bag of states and assert that
# the result equals the join of all of them in canonical order.
# ---------------------------------------------------------------------------
def converge(states):
    """Fold-merge a list of states; the result is order/duplicate independent."""
    acc = states[0]
    for s in states[1:]:
        acc = acc.merge(s)
    return acc


def demo_gcounter():
    # Replicas A, B, C take local increments during a partition.
    A = GCounter().inc("A").inc("A")     # [A:2]
    B = GCounter().inc("B")              # [B:1]
    C = GCounter().inc("C", by=3)        # [C:3], partitioned

    # More local work while still partitioned.
    A.inc("A")                           # [A:3]
    C.inc("C")                           # [C:4]

    snapshots = [
        GCounter(A.counts), GCounter(B.counts), GCounter(C.counts),
        GCounter(C.counts),  # a DUPLICATE of C's state, as if re-delivered
    ]

    # Heal the partition many times, each with a different random order.
    results = set()
    for _ in range(1000):
        bag = snapshots[:]
        random.shuffle(bag)              # reorder
        if random.random() < 0.5:        # add another duplicate
            bag.append(GCounter(random.choice(snapshots).counts))
        results.add(converge(bag).value())

    print("G-Counter converged value over 1000 shuffled/duped merges:", results)
    assert results == {8}, results       # ALWAYS 8, regardless of order/dups


def demo_gset():
    A = GSet().add("x").add("a")
    B = GSet().add("x").add("b")
    C = GSet().add("c")

    snaps = [A, B, C, B]                 # B duplicated
    results = set()
    for _ in range(1000):
        bag = snaps[:]
        random.shuffle(bag)
        results.add(frozenset(converge(bag).value()))

    print("G-Set converged value:", set(next(iter(results))))
    assert results == {frozenset({"x", "a", "b", "c"})}


if __name__ == "__main__":
    demo_gcounter()
    demo_gset()
    print("Both CRDTs converged under every reordering and duplication.")
```

Running it prints a single converged value for each CRDT (`{8}` for the counter, `{x, a, b, c}` for the set) across a thousand shuffled, duplicated merges — an empirical witness to the convergence theorem. The assertions hold *because* `merge` computes a real join.

### 10.2 Go (secondary)

The same `LatticeState` idea, with `Merge` returning the join and a small driver showing order- and duplicate-independence for the G-Counter.

```go
package main

import (
	"fmt"
	"math/rand"
)

// LatticeState is any join-semilattice element: a CRDT replica's state.
type LatticeState interface {
	Merge(other LatticeState) LatticeState // self ⊔ other (the join)
	Value() int
}

// GCounter: product lattice over replica -> count, join = elementwise max.
type GCounter struct{ counts map[string]int }

func NewGCounter() *GCounter { return &GCounter{counts: map[string]int{}} }

func (g *GCounter) clone() *GCounter {
	c := NewGCounter()
	for k, v := range g.counts {
		c.counts[k] = v
	}
	return c
}

func (g *GCounter) Inc(replica string) *GCounter { // inflationary
	g.counts[replica]++
	return g
}

func (g *GCounter) Merge(other LatticeState) LatticeState { // elementwise max
	o := other.(*GCounter)
	out := g.clone()
	for k, v := range o.counts {
		if v > out.counts[k] {
			out.counts[k] = v
		}
	}
	return out
}

func (g *GCounter) Value() int {
	sum := 0
	for _, v := range g.counts {
		sum += v
	}
	return sum
}

func converge(states []LatticeState) LatticeState {
	acc := states[0]
	for _, s := range states[1:] {
		acc = acc.Merge(s)
	}
	return acc
}

func main() {
	a := NewGCounter().Inc("A").Inc("A").Inc("A") // A:3
	b := NewGCounter().Inc("B")                   // B:1
	c := NewGCounter()                            // C:4
	c.counts["C"] = 4

	snaps := []LatticeState{a, b, c, c} // c duplicated

	seen := map[int]bool{}
	for i := 0; i < 1000; i++ {
		bag := append([]LatticeState{}, snaps...)
		rand.Shuffle(len(bag), func(i, j int) { bag[i], bag[j] = bag[j], bag[i] })
		seen[converge(bag).Value()] = true
	}
	fmt.Println("G-Counter converged values over 1000 shuffled merges:", keys(seen))
	// Always prints: [8]
}

func keys(m map[int]bool) []int {
	out := []int{}
	for k := range m {
		out = append(out, k)
	}
	return out
}
```

Both programs encode the same lesson: **write `merge` once as a join; convergence is then a property of the math, not of the network.**

---

## 11. Complexity and metadata cost

CRDTs buy coordination-free convergence, and the bill arrives as **metadata**. The dominant cost is that the lattice state often grows with the number of replicas, not just with the data.

| CRDT | State size | Merge time | Read time | Note |
|------|-----------|-----------|-----------|------|
| **G-Set** | `O(\|elements\|)` | `O(\|A\| + \|B\|)` (union) | `O(1)`–`O(\|set\|)` | grows with data, not replicas |
| **G-Counter** | `O(n)` (one slot per replica) | `O(n)` | `O(n)` to sum | **state ∝ #replicas** |
| **PN-Counter** | `O(2n)` (two G-Counters) | `O(n)` | `O(n)` | two vectors |
| **LWW-Register** | `O(1)` | `O(1)` | `O(1)` | one `(t, value)` pair |
| **OR-Set** (senior) | `O(\|live\| + \|tombstones\|)` | `O(state)` | `O(1)` | tombstones can dominate |

Two practical truths follow:

1. **The G-Counter's vector is `O(n)` in the number of replicas that have *ever* incremented**, because every such replica needs its own slot (so its increments stay independent and the join stays correct). In a system with thousands of ephemeral clients, this metadata can dwarf the single integer it represents. Real systems prune dead replica entries, cap with server-side aggregation, or use **delta-state CRDTs** (ship only the changed slots) to keep messages small — but the *worst-case* state is fundamentally `O(n)`.

2. **Message size.** Naive state-based CRDTs ship the *entire* state on every sync — fine for a small counter, painful for a megabyte-scale set. The standard remedies are **delta-state CRDTs** (join-mergeable *deltas* instead of full state) and switching to op-based shipping (Section 6). These are senior-level concerns; the takeaway here is that *convergence is free, but bounded-size metadata is not.*

The exchange is the recurring CRDT bargain: **you trade storage/bandwidth (metadata) for the elimination of coordination (consensus latency).** Whether the bargain pays depends on your replica count and update rate.

---

## 12. Common Misconceptions

- **"Commutativity, associativity, and idempotence are three independent properties I have to check."** No. They are three theorems that all follow from one fact: your merge is the join of a partial order (Section 3.4). Check that merge is a genuine LUB and you get all three at once. If your merge *isn't* a LUB, you almost certainly violate one of them.

- **"CRDTs are eventually consistent."** They are **strongly** eventually consistent (Section 5), which is a strictly stronger guarantee — same updates means *immediately* equal state, not "eventually, after quiescence, via some conflict callback."

- **"Idempotence means applying an *update* twice is safe."** For **state-based** CRDTs, it's the *merge* that's idempotent (`a ⊔ a = a`), which makes re-receiving a state safe. Applying a local *increment* twice still increments twice. For **op-based** CRDTs there is no idempotent join at all — duplicate *operation* delivery corrupts the state, which is why CmRDTs demand exactly-once delivery (Section 6).

- **"`x := v` just needs a clever merge."** There is no information-preserving merge for blind assignment (Section 7.1). The fix is to *change the operation* into something monotone (LWW adds a timestamp; MV-Register keeps all concurrent values). You can't merge your way out of a non-lattice operation; you re-encode it.

- **"Convergence means correctness."** Convergence (SEC) only guarantees all replicas *agree*. They can agree on a result a user finds surprising (an "undeleted" element, a lost concurrent edit). Choosing semantics that converge to something *desirable* is a separate design problem.

- **"A partial order is just a broken total order."** Incomparability is a feature: concurrent, independent updates *should* be incomparable, and the join is precisely the tool that fuses them without picking an arbitrary winner.

## 13. Common Mistakes

- **A merge that isn't a LUB.** E.g. "merge two counters by *adding* their values." Addition is not idempotent (`5 + 5 ≠ 5`), so re-delivering a state double-counts. The correct G-Counter merge is elementwise **max** over per-replica slots, *then* sum on read.

- **A non-inflationary update.** Allowing a decrement on a G-Counter, or a remove on a G-Set, lets state move *down* the lattice and breaks convergence. Re-encode: decrements go in a second G-Counter (PN-Counter); removes go through tombstones (OR-Set).

- **Sharing a replica slot.** In a G-Counter, two replicas writing the *same* slot makes the elementwise max lose increments (max of two independent climbs, not their sum). Each replica must own a unique slot id.

- **Forgetting ties in LWW.** If two writes share a timestamp and you don't break the tie *deterministically* (by replica id, say), different replicas may pick different winners and diverge. The join must be a *total* function with a fixed tie rule.

- **Assuming op-based safety on a lossy channel.** Op-based updates are usually not idempotent; running them over an at-least-once channel without dedup double-applies. State-based tolerates this; op-based does not.

- **Letting metadata grow unbounded.** Never pruning dead replica slots or tombstones turns an `O(1)` value into an ever-growing state. Plan for pruning / delta-states early.

## 14. Cheat Sheet

```
PARTIAL ORDER (S, ⊑)        reflexive · antisymmetric · transitive
  a ⊑ b   ≡   "b is at least as informed as a" (a possible past of b)
  a ∥ b   ≡   incomparable = concurrent updates

JOIN-SEMILATTICE (S, ⊑, ⊔)  every pair has a Least Upper Bound (join ⊔)
  a ⊔ b   = smallest state ≥ both a and b   (unique, by antisymmetry)
  bottom ⊥ = initial "knows nothing" state

THE THREE LAWS ARE FREE (theorems, from join = LUB):
  idempotent     a ⊔ a = a          ← absorbs DUPLICATES
  commutative    a ⊔ b = b ⊔ a      ← absorbs REORDERING
  associative   (a⊔b)⊔c = a⊔(b⊔c)   ← absorbs BATCHING/REGROUPING

CvRDT (state-based) =  join-semilattice
                     + inflationary updates  (s ⊑ update(s), only climbs)
                     + merge = ⊔
  ⟹ CONVERGENCE THEOREM: same set of updates ⟹ equal state
  ⟹ STRONG EVENTUAL CONSISTENCY, no consensus

NETWORK CONTRACT (state-based): eventual delivery; reorder/dup/loss/batch OK
NETWORK CONTRACT (op-based):    reliable, causal, EXACTLY-once delivery

LATTICE-FRIENDLY ops:   add(set)=∪ · max · min · OR · increment-only
NOT lattices (re-encode): assign x:=v · remove · decrement · subtract

DESIGN RECIPE:  pick lattice → ⊥ as init → inflationary update → merge=⊔

CANONICAL LATTICES:
  G-Set       = powerset(U), ⊑=⊆, ⊔=∪, ⊥={}
  G-Counter   = ℕⁿ product,  ⊑=coordinatewise≤, ⊔=elementwise max, sum on read
  Max-Register= (ℕ,≤,max)
  LWW-Register= total order on (timestamp,value), ⊔ = later timestamp

COST: convergence is free; metadata is not (G-Counter state is O(#replicas))
```

## 15. Summary

You came in knowing that a good CRDT merge is commutative, associative, and idempotent. You now know **where those properties live**: they are not assumptions but **theorems**, all flowing from a single structure — the **join-semilattice**. A partial order `⊑` captures "more informed than"; the **join** `⊔` is the unique least upper bound that fuses two states losing nothing; and because the join is *defined by the order*, it is automatically idempotent, commutative, and associative.

From that one structure, the **CvRDT convergence theorem** drops out cleanly: if every update only climbs the lattice (inflationary) and merge is the join, then replicas that have seen the same set of updates are computing the join of the same set of contributions — and the join depends only on the *set*, so they are equal. That is precisely **Strong Eventual Consistency**, achieved **without consensus**, because there is no "who went first" left to agree on. Each of the three laws defeats a specific network pathology: commutativity beats reordering, associativity beats batching, idempotence beats duplication.

The same theory hands you a **design recipe** (pick a lattice, start at `⊥`, make updates inflationary, merge with the join) and a **diagnostic** for what *can't* be a CRDT: any operation that destroys information — blind assignment, remove, decrement — descends the lattice and must be re-encoded as a new kind of *growth* (timestamps, tombstones, a second counter). The G-Counter made it concrete: a product lattice of per-replica maxes, converging to the same total across every reordering, duplication, and partition heal. The bill for all this is **metadata** — state that grows with the number of replicas — which is the trade CRDTs make: storage and bandwidth in exchange for coordination-free, deterministic convergence.

Next: the dual formulation and when to use each, in [State-based vs Operation-based CRDTs](../02-state-vs-operation-based-crdts/middle.md); the counter family in depth in [G-Counter / PN-Counter](../03-counters-g-pn/middle.md); and the harder semantics (remove, sequences, registers) in the [senior](senior.md) file.

## 16. Further Reading

- Shapiro, Preguiça, Baquero, Zawirski — *Conflict-free Replicated Data Types* (2011). The founding paper; defines CvRDT, CmRDT, SEC, and proves the convergence theorem.
- Shapiro et al. — *A comprehensive study of Convergent and Commutative Replicated Data Types* (INRIA tech report, 2011). The long version with dozens of worked CRDT designs and full proofs.
- Baquero, Almeida, Shoker — *Making Operation-Based CRDTs Operation-Based* and the **delta-state CRDT** papers (2014+), for the metadata/message-size remedies in Section 11.
- Davey & Priestley — *Introduction to Lattices and Order* (2nd ed.). The standard reference for partial orders, Hasse diagrams, and semilattices, if you want the order theory rigorously.
- Marc Shapiro's talks and the `crdt.tech` resource hub for an indexed catalogue of CRDT designs.
- Cross-references in this roadmap: [State-based vs Operation-based CRDTs](../02-state-vs-operation-based-crdts/middle.md), [G-Counter / PN-Counter](../03-counters-g-pn/middle.md), set primitives via [Hash Tables](../../05-basic-data-structures/05-hash-tables/junior.md), and the monotone-merge analogy in [Disjoint Set / Union-Find](../../12-disjoint-set/01-union-find/junior.md).
