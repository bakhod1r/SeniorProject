# Set CRDTs: G-Set, 2P-Set, LWW & OR-Set — Middle Level

> **You are here.** The [junior](junior.md) tier showed you *what* these sets do and *when* you'd reach for each. This tier makes the claims rigorous: we formalize every variant as a lattice (state-based) or as a set of operations (op-based), prove that replicas converge, and analyze the add-wins / remove-wins semantics precisely enough that you could implement and test them. The [senior](senior.md) tier picks up garbage collection, causal stability, and production internals (Riak, Automerge, Redis).

---

## Table of Contents

1. [Recap and ground rules](#1-recap-and-ground-rules)
2. [G-Set as the powerset lattice](#2-g-set-as-the-powerset-lattice)
3. [2P-Set as a product of two G-Sets](#3-2p-set-as-a-product-of-two-g-sets)
4. [LWW-Element-Set](#4-lww-element-set)
5. [OR-Set: the Observed-Remove Set](#5-or-set-the-observed-remove-set)
6. [Op-based vs state-based OR-Set](#6-op-based-vs-state-based-or-set)
7. [Metadata growth and why GC is hard](#7-metadata-growth-and-why-gc-is-hard)
8. [Comparison table](#8-comparison-table)
9. [Worked concurrent scenarios](#9-worked-concurrent-scenarios)
10. [Code: lattice-merge implementations](#10-code-lattice-merge-implementations)
11. [Misconceptions, mistakes, cheat sheet, summary](#11-misconceptions-mistakes-cheat-sheet-summary)

---

## 1. Recap and ground rules

A **CRDT** (Conflict-free Replicated Data Type) is a data type replicated across nodes that can be updated *independently and concurrently* — without coordination — yet is guaranteed to converge to the same value on every replica once all updates have propagated. If you need the underlying theory (semilattices, the join operator, commutativity/associativity/idempotence, causal delivery), read [CRDT Fundamentals](../01-crdt-fundamentals/middle.md) first. The split between **state-based (CvRDT)** and **operation-based (CmRDT)** designs is covered in [State vs Op CRDTs](../02-state-vs-operation-based-crdts/middle.md), and the counter family (which we lean on for intuition) is in [Counters](../03-counters-g-pn/middle.md).

Two formal tools recur throughout this document, so let us pin them down.

**Join-semilattice.** A set `S` with a binary operator `⊔` (the *join*, or *least upper bound*) that is:

- **commutative**: `a ⊔ b = b ⊔ a`
- **associative**: `(a ⊔ b) ⊔ c = a ⊔ (b ⊔ c)`
- **idempotent**: `a ⊔ a = a`

These three properties induce a **partial order** `a ≤ b ⟺ a ⊔ b = b`. The join always moves *up* this order (or stays put). For a **state-based CRDT** we model each replica's state as an element of a join-semilattice, model every local update as a function that produces a state `≥` the current one (a property called *inflation* / monotonicity), and define `merge = ⊔`. Convergence then follows for free: any two replicas that have seen the same set of updates compute the same least upper bound, regardless of the order or multiplicity in which states arrive. That last clause — *order and multiplicity don't matter* — is exactly what commutativity, associativity, and idempotence buy us, and it is what makes networks safe to retry, reorder, and duplicate.

**Op-based CRDT.** Instead of shipping whole states, each replica broadcasts *operations*. Convergence requires that **concurrent** operations commute (so any delivery order yields the same result) and that the network provides **reliable causal broadcast** with **exactly-once** delivery for each operation (or that operations are made idempotent so duplicates are harmless). Op-based designs typically carry far less metadata on the wire but demand more from the transport.

With those tools in hand, we walk the four set variants from simplest to subtlest.

---

## 2. G-Set as the powerset lattice

The **Grow-only Set (G-Set)** supports two operations: `add(e)` and `lookup(e)`. There is deliberately no `remove`. A replica's state is simply a set `X ⊆ U`, where `U` is the universe of possible elements.

### 2.1 The lattice

Consider the **powerset** `𝒫(U)` of the universe, ordered by **subset inclusion** `⊆`. This is the canonical example of a *complete* lattice:

- The **join** of two sets is their **union**: `X ⊔ Y = X ∪ Y`.
- The **meet** (greatest lower bound) is their intersection, but a state-based CRDT only needs the join.
- The **bottom** element `⊥` is the empty set `∅`.

Union is textbook-commutative (`X ∪ Y = Y ∪ X`), associative (`(X ∪ Y) ∪ Z = X ∪ (Y ∪ Z)`), and idempotent (`X ∪ X = X`). So `(𝒫(U), ∪)` is a join-semilattice — in fact the prototypical one. Define:

```
merge(X, Y) = X ∪ Y
add(X, e)   = X ∪ {e}
lookup(X, e) = e ∈ X
```

### 2.2 Why convergence is immediate

`add` is an inflation: `X ⊆ X ∪ {e}`, so local updates only move *up* the order. Merge is the join. Because union is commutative/associative/idempotent, two replicas that have collectively observed adds `{e₁, e₂, …}` will, after enough gossip, both hold exactly `{e₁, e₂, …}` no matter what order the merges happened, how many times a state was re-delivered, or how the adds were interleaved. There is no conflict to resolve: union absorbs everything monotonically.

### 2.3 The cost of simplicity

The G-Set is the simplest possible set CRDT precisely because **it forbids removal**. Once an element is in, it is in forever on every replica. That is occasionally exactly what you want — an append-only set of observed IDs, a set of "seen" message hashes for deduplication, the membership-growing half of more complex types — but most applications need removal, which is where the next three variants earn their complexity.

---

## 3. 2P-Set as a product of two G-Sets

The **Two-Phase Set (2P-Set)** is the most direct way to bolt removal onto a G-Set: keep *two* G-Sets, one of additions and one of removals, and define presence as set difference.

### 3.1 State and operations

State is a pair `(A, R)` where:

- `A` ("add set") is a G-Set of elements that have been added.
- `R` ("remove set", also called the *tombstone set*) is a G-Set of elements that have been removed.

```
present(A, R) = A \ R         # e is present iff e ∈ A and e ∉ R
add(e):    A := A ∪ {e}
remove(e): R := R ∪ {e}       # precondition: e is currently present (e ∈ A \ R)
lookup(e): e ∈ A and e ∉ R
```

The precondition on `remove` ("you can only remove something currently present") matters: it means a remove is always *causally* preceded by the corresponding add on the replica that issues it. We return to its limits below.

### 3.2 The product lattice

A 2P-Set is the **product** of two G-Set lattices. If `L₁` and `L₂` are join-semilattices, their Cartesian product `L₁ × L₂` is a join-semilattice under the **componentwise join**:

```
(A₁, R₁) ⊔ (A₂, R₂) = (A₁ ∪ A₂, R₁ ∪ R₂)
```

with bottom `(∅, ∅)`. The product order is `(A₁,R₁) ≤ (A₂,R₂) ⟺ A₁ ⊆ A₂ and R₁ ⊆ R₂`. Componentwise join inherits commutativity, associativity, and idempotence directly from each component, so a product of semilattices is a semilattice. This is a general and useful theorem: *you can build bigger CRDTs by taking products of smaller ones*, and convergence composes automatically.

### 3.3 Convergence proof

**Claim.** Any two 2P-Set replicas that have observed the same set of `add`/`remove` operations converge to the same `(A, R)`, hence to the same `present` value.

**Proof.** Let replica `p` observe operations producing `(Aₚ, Rₚ)` and replica `q` produce `(A_q, R_q)`. Each `add(e)` inserts `e` into the local `A` (an inflation in the first component); each `remove(e)` inserts `e` into the local `R` (an inflation in the second component). After both replicas have merged in all of each other's states, by the lattice properties of `∪` in each component:

- The merged first component is `⋃` of every add ever observed = the set of all added elements.
- The merged second component is `⋃` of every remove ever observed = the set of all removed elements.

Both replicas therefore hold the identical `(A, R)`, and `present = A \ R` is a deterministic function of `(A, R)`. ∎

Convergence does **not** depend on operation order, on whether a remove "arrived before" its add, or on duplicate delivery — all absorbed by union idempotence. This is the whole appeal of the lattice framing: correctness reduces to "join is a semilattice operator."

### 3.4 The "no re-add" limitation, formally

The 2P-Set has a sharp, often surprising semantic limit: **once an element is removed, it can never be present again**, on any replica, forever. Let us prove it.

**Lemma (absorbing tombstone).** For any element `e`, once `e ∈ R` on some replica, then `e ∈ R` on every replica that has merged with it, and `R` never shrinks. Therefore `present(e) = (e ∈ A) ∧ (e ∉ R)` is permanently `false` regardless of how many times `e` is subsequently added.

**Proof.** `R` is a G-Set: the only operation on it is `R := R ∪ {e}`, and merge is union. Both are monotone-increasing — `R` can only grow. Once `e ∈ R`, no operation or merge can ever remove it from `R`. Hence `e ∉ R` is permanently false everywhere, so `e ∉ A \ R` permanently, so `present(e)` is permanently `false`. A later `add(e)` puts `e` back into `A`, but `A \ R` still excludes it because `e ∈ R` dominates. ∎

So the lifecycle of an element in a 2P-Set is strictly **two phases**: it can be added, then removed — and that's the end. Re-adding is a silent no-op (the element stays absent). This is fine for monotone use cases ("an item that has shipped can never un-ship"), but it is a footgun for general sets, e.g. a shopping cart where a user removes an item and later wants it back. The OR-Set in §5 exists precisely to fix this.

A common variant, the **U-Set** (Unique Set), constrains every element to be globally unique and added at most once; under that assumption the 2P-Set's anomalies vanish, but you've pushed the uniqueness obligation onto the caller.

---

## 4. LWW-Element-Set

The **Last-Writer-Wins Element Set (LWW-Element-Set)** sidesteps the 2P-Set's permanent-tombstone problem by attaching **timestamps** to adds and removes and letting the most recent operation win per element. This *does* allow re-add (a newer add beats an older remove), at the cost of relying on a timestamp/clock ordering.

### 4.1 State and operations

Conceptually each element `e` maps to a pair of timestamps `(addTs(e), removeTs(e))`. Equivalently — and this is how it is usually presented — keep two **timestamped G-Sets**: an add-set `A` of pairs `(e, t)` and a remove-set `R` of pairs `(e, t)`.

```
add(e, t):    A := A ∪ {(e, t)}
remove(e, t): R := R ∪ {(e, t)}

addTs(e)    = max { t : (e, t) ∈ A }   # ⊥ if e never added
removeTs(e) = max { t : (e, t) ∈ R }   # ⊥ if e never removed
```

Presence is determined by comparing the latest add against the latest remove:

```
present(e) = addTs(e) > removeTs(e)
```

### 4.2 The tie-break bias: add-wins vs remove-wins

The interesting question is what to do when `addTs(e) == removeTs(e)` — concurrent operations that happen to carry equal timestamps. The comparison operator encodes the **bias**:

- **Bias add (add-wins on ties).** `present(e) ⟺ addTs(e) ≥ removeTs(e)`. On a tie the element is present.
- **Bias remove (remove-wins on ties).** `present(e) ⟺ addTs(e) > removeTs(e)`. On a tie the element is absent.

You must pick one bias and apply it deterministically on *every* replica, or replicas with the same data could disagree on presence and break convergence. The bias only matters on exact ties; with high-resolution unique timestamps ties are rare, but a CRDT must be correct in *all* cases, not just likely ones, so the bias is part of the type's definition, not an afterthought.

> **Important distinction.** LWW's "add-wins on ties" is **not** the same as the OR-Set's "add-wins" semantics (§5). LWW's bias only breaks *equal-timestamp* ties; if a remove has a strictly later timestamp than every concurrent add, the remove wins outright and the element is gone. The OR-Set's add-wins, by contrast, makes a concurrent add beat a concurrent remove *regardless of physical time*. They sound similar and behave very differently.

### 4.3 Why it is a lattice

LWW-Element-Set is a join-semilattice. Take the per-element timestamp view: each element maps to `(addTs, removeTs) ∈ (T ∪ {⊥}) × (T ∪ {⊥})`, where `T` is a totally ordered timestamp domain and `⊥ < t` for all `t`. The join is **componentwise max**:

```
(a₁, r₁) ⊔ (a₂, r₂) = (max(a₁, a₂), max(r₁, r₂))
```

`max` over a total order is commutative, associative, and idempotent — it is the join of a totally ordered lattice (a chain). The product of two such chains, indexed over all elements (another product, one factor per element), is again a semilattice. Equivalently, in the two-G-Set presentation, merge is just `(A₁ ∪ A₂, R₁ ∪ R₂)` — a product of G-Sets exactly like the 2P-Set — and presence is a deterministic function of the merged timestamps. Either way, **merge is a well-defined join**, so convergence follows by the same argument as §3.3.

### 4.4 Data loss under clock skew — the caveat

LWW's correctness as a *CRDT* (replicas converge) is airtight. Its correctness as a *model of user intent* is not, and the gap is **clock skew**.

LWW uses physical (wall-clock) timestamps to order causally-concurrent operations. If two replicas have skewed clocks, "last writer wins" silently becomes "the writer with the faster clock wins," which can be the *causally earlier* writer. Concretely: Alice on replica P (clock running 5 seconds fast) adds `x` at apparent time `t=100`. A second later in real time, Bob on replica Q (accurate clock) removes `x` at apparent time `t=96`. LWW with `present ⟺ addTs ≥ removeTs` keeps `x` (`100 ≥ 96`), even though Bob's remove *physically happened after* Alice's add. Bob's intended deletion is **silently lost** with no error and no conflict surfaced. This is *lost-update* under the guise of convergence: every replica agrees on the wrong answer.

Mitigations (detailed at senior level): use logical or hybrid logical clocks (HLC) to bound the damage, ensure tight NTP sync, or — if you genuinely cannot tolerate silent loss — use the OR-Set instead, which orders concurrent add/remove by *causality* (add-wins) rather than by a fragile physical clock.

---

## 5. OR-Set: the Observed-Remove Set

The **OR-Set (Observed-Remove Set)** delivers the semantics most applications actually want: **re-add works**, and on a concurrent `add(e) | remove(e)` the **add wins** — *deterministically and without any clock*. The trick is to give every `add` a globally **unique tag**, and to make a `remove` delete only the tags it has *already observed*.

### 5.1 State and operations

State is a set of `(element, tag)` pairs. A `tag` (sometimes called a *dot* or *unique token*) is globally unique — typically `(replicaId, sequenceNumber)` or a UUID. In the classic state-based formulation there are two sets:

- `E` — the set of currently-live `(element, tag)` pairs ("elements").
- `T` — the **tombstone** set of `(element, tag)` pairs that have been removed ("observed-removed").

```
add(e):
    let τ = freshUniqueTag()        # minted by this replica, never reused
    E := E ∪ {(e, τ)}

remove(e):
    # remove exactly the tags for e that THIS replica currently observes
    let obs = { (e, τ) ∈ E }        # the (e,τ) pairs visible right now
    E := E \ obs
    T := T ∪ obs                    # remember them as tombstones

present(e):  ∃ τ. (e, τ) ∈ E        # e is present iff it has at least one live tag

merge((E₁,T₁), (E₂,T₂)):
    T = T₁ ∪ T₂
    E = (E₁ ∪ E₂) \ T               # union the live tags, then subtract all tombstones
```

The whole design hinges on one rule: **a remove can only kill tags it has observed**. A tag minted by a concurrent add on another replica was, by definition, *not* observed by the remove, so the remove cannot tombstone it — the element survives. That is the add-wins mechanism, and it requires no timestamps at all.

### 5.2 Re-add works

In a 2P-Set, removing `x` poisoned the element forever. In an OR-Set, each `add` mints a *fresh* tag:

1. `add(x)` → tag `a`. State: `E = {(x,a)}`. Present.
2. `remove(x)` → observes `{(x,a)}`, moves it to tombstones. `E = {}`, `T = {(x,a)}`. Absent.
3. `add(x)` again → mints a *new* tag `b`. `E = {(x,b)}`, `T = {(x,a)}`. **Present again** — because `b ∉ T`.

The new tag `b` is unrelated to the dead tag `a`, so the old tombstone has no power over it. Re-add is a first-class, fully-supported operation.

### 5.3 The add-wins proof for concurrent add | remove

**Claim.** Given a single element `x`, if `add(x)` and `remove(x)` are **concurrent** (neither causally precedes the other), then after both reach every replica, `present(x) = true` on all replicas.

**Setup.** Let replica P perform `add(x)`, minting a fresh tag `a` not seen anywhere before this add; its state gains `(x, a)`. Let replica Q perform `remove(x)` based on the tags it has observed for `x`, call that set `Obs_Q`. Since the operations are concurrent, Q's remove was *not* causally after P's add, so by the freshness of `a`, **`(x, a) ∉ Obs_Q`** — Q could not have observed a tag that P had not yet created. Q's remove therefore tombstones only `Obs_Q`, and `(x, a) ∉ Obs_Q ⊆ T` after Q's remove propagates.

**Merge.** On any replica, after both operations propagate:

```
T = (… ∪ Obs_Q)          # contains every tombstoned tag, but NOT (x, a)
E = (… ∪ {(x, a)}) \ T   # (x, a) added, and NOT subtracted because (x,a) ∉ T
```

Hence `(x, a) ∈ E`, so `present(x) = true` on every replica. The concurrent add's tag is a live witness that no remove observed. **Add wins.** ∎

Note the symmetry-break is *causal*, not temporal: had Q's remove been causally *after* P's add (i.e., Q first received P's add, then removed), Q *would* have observed `(x, a)`, tombstoned it, and the element would be absent — which is the correct sequential semantics. The OR-Set distinguishes "concurrent add then remove" (add survives) from "add then remove in causal order" (remove succeeds) purely by what tags the remove observed.

### 5.4 ORSWOT — OR-Set Without Tombstones

The classic OR-Set's flaw is `T`: tombstones accumulate forever (one per remove), so storage grows unboundedly even for elements long gone. **ORSWOT** ("Observed-Remove Set Without Tombstones," Bieniusa et al. 2012) eliminates the explicit tombstone set by replacing it with a **version vector** that summarizes *which dots each replica has generated and seen*.

The idea: instead of remembering every dead `(e, τ)` pair explicitly, keep a per-replica version vector `VV` (a map `replicaId → maxSeq`). A dot `(replicaId, seq)` is implicitly "removed/superseded" if it is *covered* by the version vector (i.e., `seq ≤ VV[replicaId]`) but is *not* among the currently-live dots. The merge rule becomes: a live dot survives if it is present in the other replica's live set **or** the other replica's version vector has not yet seen it (so it can't have removed it). This is the same "you can only remove what you've observed" logic, but the *observation* is encoded compactly in version vectors instead of an ever-growing tombstone set. Riak's `riak_dt_orswot` is the canonical production implementation; it powers Riak's distributed sets. ORSWOT keeps metadata proportional to the number of *live* elements plus the number of replicas, rather than to the total number of removes ever performed. The senior tier dissects the version-vector dominance rules and the dotted-version-vector (DVV) refinement.

---

## 6. Op-based vs state-based OR-Set

The OR-Set comes in both CRDT flavors; the difference is what travels on the wire and what the network must guarantee.

### 6.1 State-based (CvRDT) OR-Set

This is the `(E, T)` design of §5.1. Replicas periodically ship their **whole state** (or a delta); `merge` is the join shown above. Requirements:

- The network only needs to deliver states **eventually**; reordering and duplication are harmless because `merge` is a semilattice join.
- No causal delivery needed — the state itself carries the causal information (which tags exist, which are tombstoned).
- Cost: shipping full state is expensive; **delta-state CRDTs** (ship only the changed `(e, τ)` pairs) mitigate this and are how production systems actually do it.

### 6.2 Op-based (CmRDT) OR-Set

Replicas broadcast **operations** instead of states:

- `add(e)` broadcasts the operation *plus the freshly minted tag* `(e, τ)`. On delivery each replica inserts `(e, τ)` into `E`.
- `remove(e)` broadcasts the *set of observed tags* `R = {(e, τ₁), (e, τ₂), …}` for `e`. On delivery each replica removes exactly those tags from its `E`.

Carrying the tags explicitly in the operation is what lets concurrent operations commute. Requirements:

- **Reliable causal broadcast (RCB).** Each operation must be delivered to every replica exactly once, and an operation must not be delivered before operations it causally depends on. In particular a `remove`'s tags must already exist on the receiving replica when the remove arrives — which causal delivery guarantees, because the remove causally follows the adds whose tags it carries.
- Operations must be applied **exactly once** (or be idempotent); a duplicated `add` would mint... no — the tag is fixed in the broadcast op, so a duplicated `add(e,τ)` is idempotent (re-inserting the same `(e,τ)`). A duplicated `remove` re-removing already-removed tags is also idempotent. So in practice op-based OR-Set tolerates duplicates but **requires causal order** for removes.

| | State-based OR-Set | Op-based OR-Set |
|---|---|---|
| On the wire | full/delta state `(E, T)` | individual ops (add carries `(e,τ)`, remove carries observed tags) |
| Network needs | eventual delivery; reorder/dup OK | reliable **causal** broadcast; exactly-once or idempotent |
| Bandwidth | higher (state) — fixed by deltas | lower per op |
| Failure tolerance | very robust (just re-gossip) | fragile to transport bugs (missed/reordered ops break it) |

The right choice depends on your transport. If you have a solid causal-broadcast layer, op-based is lean. If your network is best-effort gossip, state/delta-based is the safer bet. See [State vs Op CRDTs](../02-state-vs-operation-based-crdts/middle.md) for the general trade-off.

---

## 7. Metadata growth and why GC is hard

Set CRDTs trade memory for their semantics, and OR-Sets trade the most.

- **G-Set / 2P-Set**: metadata is the tombstone/add sets, which **only grow**. A 2P-Set can never reclaim a removed element's tombstone (removing it would let the element be re-added, violating the type's contract). Memory is `O(total adds + total removes)`, unbounded over time.
- **Classic OR-Set**: every `add` mints a tag (lives until removed) and every `remove` parks tags in the tombstone set `T` **forever**. So memory grows with the *total number of add and remove operations*, not the live size. For a hot key churned millions of times, this is fatal.
- **ORSWOT**: replaces tombstones with version vectors, so steady-state metadata is `O(live elements + replicas)`. Far better, but the version vector still has one entry per replica that has ever written, and *retired* replica IDs need pruning.

**Garbage collection needs causal stability.** You can safely discard a tombstone (or compact a version vector) only once you are certain **no concurrent operation is still in flight that the tombstone might need to suppress**. An update is *causally stable* when every replica has acknowledged it (and everything before it), so no future concurrent operation can reference it. Computing causal stability requires tracking what every replica has seen — typically a matrix of version vectors and a stability frontier. Premature GC (deleting a tombstone while a concurrent re-add is still propagating) **resurrects deleted elements** — a real and nasty bug class. Because correct GC requires global knowledge that's expensive to maintain, this is genuinely hard and is the centerpiece of the [senior](senior.md) tier. For now, internalize the rule: *tombstones are debt; you can only pay it down once the relevant operations are causally stable across all replicas.*

---

## 8. Comparison table

| Property | G-Set | 2P-Set | LWW-Element-Set | OR-Set / ORSWOT |
|---|---|---|---|---|
| Add | yes | yes | yes | yes |
| Remove | **no** | yes (once) | yes | yes |
| **Re-add after remove** | n/a | **no** (permanent tombstone) | yes (newer add wins) | **yes** (fresh tag) |
| Concurrent add\|remove | n/a | element absent (remove wins) | wins by **timestamp** (+ tie bias) | **add wins** (causal) |
| Conflict resolution by | union only | union only | **physical clock** | **unique tags / causality** |
| Silent data-loss risk | none | none (but no re-add) | **yes (clock skew)** | none |
| Is it a lattice? | yes (`∪`) | yes (product of G-Sets) | yes (per-element max) | yes (`E∪`, `T∪`, then subtract) / VV dominance |
| Metadata | grows with adds | grows with adds + removes | grows with adds + removes | tags + tombstones (classic); `O(live + replicas)` (ORSWOT) |
| Needs synced clocks | no | no | **yes (for sane intent)** | no |
| Op-based needs causal delivery | no | no | no (timestamps order) | **yes (for removes)** |
| Typical use | seen-IDs, append-only | once-only membership | caches, presence, simple flags | general sets, carts, Riak sets |

The trajectory left-to-right is "more semantic power, more metadata, more subtlety." Choose the leftmost type that satisfies your requirements.

---

## 9. Worked concurrent scenarios

Two replicas, **P** and **Q**, partition, each take operations independently, then heal (merge). We trace the exact state.

### 9.1 LWW-Element-Set under partition/heal

Bias: **add-wins on ties**, i.e. `present ⟺ addTs ≥ removeTs`. Timestamps shown as integers.

**Before partition**, both replicas agree: `x` was added at `t=10`. So `A = {(x,10)}`, `R = {}`, `present(x) = true`.

**During partition:**

- **P** does `remove(x)` at `t=20`. P's state: `A = {(x,10)}`, `R = {(x,20)}`. Locally `addTs=10 < removeTs=20`, so `present(x)=false`.
- **Q** does `add(x)` at `t=15` (Q's clock lags). Q's state: `A = {(x,10),(x,15)}`, `R = {}`. Locally `present(x)=true`.

**Heal — merge P and Q:**

```
A = {(x,10)} ∪ {(x,10),(x,15)} = {(x,10),(x,15)}   →  addTs(x)    = 15
R = {(x,20)} ∪ {}              = {(x,20)}            →  removeTs(x) = 20
present(x) = (addTs ≥ removeTs) = (15 ≥ 20) = false
```

**Result: `x` is absent.** P's remove at `t=20` beat Q's add at `t=15` because `20 > 15` — *by physical time*. If Q's clock had instead been *ahead* and stamped the add at `t=25`, the add would have won (`25 ≥ 20`) even though it was causally unrelated to the remove. This is the clock-skew sensitivity of §4.4 made concrete: the outcome is decided by clock values, not by user intent or causality.

### 9.2 OR-Set under partition/heal — concurrent add wins; then a causal remove

We use tags `(replica, seq)`. Start empty: `E = {}`, `T = {}` on both.

**During partition:**

- **P** does `add(x)` → mints `(P,1)`. P: `E = {(x,(P,1))}`, `T = {}`.
- **Q** independently does `add(x)` → mints `(Q,1)`. Q: `E = {(x,(Q,1))}`, `T = {}`.
- Then **Q**, still partitioned, does `remove(x)`. Q observes only its own tags for `x`, namely `{(x,(Q,1))}`. Q: `E = {}`, `T = {(x,(Q,1))}`.

Note Q's remove **never saw `(P,1)`** — it was minted on the other side of the partition. This is the crux.

**Heal — merge P and Q:**

```
T = {} ∪ {(x,(Q,1))}                       = {(x,(Q,1))}
E = ({(x,(P,1))} ∪ {}) \ T
  = {(x,(P,1))} \ {(x,(Q,1))}
  = {(x,(P,1))}                            # (P,1) ∉ T, so it survives
present(x) = ∃τ.(x,τ)∈E = true
```

**Result: `x` is present**, carried by the live tag `(P,1)`. P's concurrent add beat Q's remove — **add-wins** — with no clocks involved, exactly as proved in §5.3. Q's remove only had authority over the tag it observed (`(Q,1)`), which it correctly killed.

**Now a causal remove on the merged state.** Suppose after healing, replica P does `remove(x)`. P now observes *all* live tags for `x`, which is `{(x,(P,1))}`:

```
E = {(x,(P,1))} \ {(x,(P,1))} = {}
T = {(x,(Q,1)), (x,(P,1))}
present(x) = false
```

Because this remove is **causally after** the surviving add (P had already merged in and now observes `(P,1)`), it sees and tombstones the live tag, and `x` is correctly gone. Same operation, different outcome — decided by *what was observed*, which is the entire point of the **O**bserved-**R**emove design.

---

## 10. Code: lattice-merge implementations

All three implementations make `merge` an explicit semilattice join and include **convergence asserts** that re-merge in shuffled order and with duplicates — the property that *must* hold for a state-based CRDT.

### 10.1 Python

```python
from __future__ import annotations
import itertools, random, uuid
from dataclasses import dataclass, field
from typing import Set, Tuple, Dict


# ---------- 2P-Set: product of two G-Sets ----------
@dataclass
class TwoPSet:
    A: Set[str] = field(default_factory=set)   # add-set (G-Set)
    R: Set[str] = field(default_factory=set)   # remove-set / tombstones (G-Set)

    def add(self, e: str) -> None:
        self.A.add(e)

    def remove(self, e: str) -> None:
        if e in self.A:                # precondition: only remove present elements
            self.R.add(e)

    def contains(self, e: str) -> bool:
        return e in self.A and e not in self.R

    def value(self) -> Set[str]:
        return self.A - self.R

    def merge(self, other: "TwoPSet") -> "TwoPSet":
        # componentwise union — the product-lattice join
        return TwoPSet(self.A | other.A, self.R | other.R)


# ---------- LWW-Element-Set: per-element timestamp max ----------
@dataclass
class LWWSet:
    # element -> (addTs, removeTs); merge takes max per timestamp
    ts: Dict[str, Tuple[int, int]] = field(default_factory=dict)
    bias_add: bool = True              # True = add-wins on ties

    def _entry(self, e: str) -> Tuple[int, int]:
        return self.ts.get(e, (-1, -1))   # -1 == ⊥ (never set)

    def add(self, e: str, t: int) -> None:
        a, r = self._entry(e)
        self.ts[e] = (max(a, t), r)

    def remove(self, e: str, t: int) -> None:
        a, r = self._entry(e)
        self.ts[e] = (a, max(r, t))

    def contains(self, e: str) -> bool:
        a, r = self._entry(e)
        if a < 0:                      # never added
            return False
        return a >= r if self.bias_add else a > r

    def value(self) -> Set[str]:
        return {e for e in self.ts if self.contains(e)}

    def merge(self, other: "LWWSet") -> "LWWSet":
        out = LWWSet(bias_add=self.bias_add)
        for e in set(self.ts) | set(other.ts):
            a1, r1 = self._entry(e)
            a2, r2 = other._entry(e)
            out.ts[e] = (max(a1, a2), max(r1, r2))   # componentwise max join
        return out


# ---------- OR-Set: unique tags + tombstones ----------
Tag = Tuple[str, int]                  # (replicaId, seq) — globally unique

@dataclass
class ORSet:
    E: Set[Tuple[str, Tag]] = field(default_factory=set)   # live (element, tag)
    T: Set[Tuple[str, Tag]] = field(default_factory=set)   # tombstoned (element, tag)
    replica: str = "R"
    _seq: int = 0

    def _fresh_tag(self) -> Tag:
        self._seq += 1
        return (self.replica, self._seq)

    def add(self, e: str) -> None:
        self.E.add((e, self._fresh_tag()))    # mint a brand-new tag

    def remove(self, e: str) -> None:
        observed = {(x, tag) for (x, tag) in self.E if x == e}
        self.E -= observed                    # remove only observed tags
        self.T |= observed                    # remember them as tombstones

    def contains(self, e: str) -> bool:
        return any(x == e for (x, _tag) in self.E)

    def value(self) -> Set[str]:
        return {x for (x, _tag) in self.E}

    def merge(self, other: "ORSet") -> "ORSet":
        T = self.T | other.T
        E = (self.E | other.E) - T            # union live, subtract all tombstones
        out = ORSet(E=E, T=T, replica=self.replica, _seq=self._seq)
        return out


# ---------- convergence harness ----------
def assert_converges(states, merge, value, label):
    """Merge in many orders + with duplicates; all must yield one value."""
    results = set()
    for perm in itertools.permutations(states):
        acc = perm[0]
        for s in perm[1:] + perm:             # note: re-include perm => duplicates
            acc = merge(acc, s)
        results.add(frozenset(value(acc)))
    assert len(results) == 1, f"{label}: diverged -> {results}"
    print(f"{label}: converged to {sorted(next(iter(results)))}")


if __name__ == "__main__":
    # 2P-Set: add x,y on one replica; remove x; re-add x is a no-op
    p = TwoPSet(); p.add("x"); p.add("y"); p.remove("x"); p.add("x")
    q = TwoPSet(); q.add("z")
    assert_converges([p, q], TwoPSet.merge, TwoPSet.value, "2P-Set")  # x stays gone

    # LWW: concurrent add(t=15) vs remove(t=20) -> remove wins (20 > 15)
    a = LWWSet(); a.add("x", 10); a.remove("x", 20)
    b = LWWSet(); b.add("x", 10); b.add("x", 15)
    assert_converges([a, b], LWWSet.merge, LWWSet.value, "LWW-Set")   # {} for x

    # OR-Set: concurrent add on P vs add+remove on Q -> add wins
    P = ORSet(replica="P"); P.add("x")
    Q = ORSet(replica="Q"); Q.add("x"); Q.remove("x")
    assert_converges([P, Q], ORSet.merge, ORSet.value, "OR-Set")      # {x}
```

Running it prints convergence for all three (the permutation+duplicate harness is the operational meaning of "join is a semilattice"):

```
2P-Set: converged to ['y', 'z']
LWW-Set: converged to []
OR-Set: converged to ['x']
```

### 10.2 Go

```go
package main

import (
	"fmt"
	"sort"
)

// ---------- OR-Set in Go ----------
type Tag struct {
	Replica string
	Seq     int
}

type pair struct {
	Elem string
	Tag  Tag
}

type ORSet struct {
	E       map[pair]struct{} // live (element, tag)
	T       map[pair]struct{} // tombstoned (element, tag)
	replica string
	seq     int
}

func NewORSet(replica string) *ORSet {
	return &ORSet{E: map[pair]struct{}{}, T: map[pair]struct{}{}, replica: replica}
}

func (s *ORSet) freshTag() Tag {
	s.seq++
	return Tag{Replica: s.replica, Seq: s.seq}
}

func (s *ORSet) Add(e string) {
	s.E[pair{e, s.freshTag()}] = struct{}{}
}

func (s *ORSet) Remove(e string) {
	for p := range s.E { // observe only currently-visible tags for e
		if p.Elem == e {
			delete(s.E, p)
			s.T[p] = struct{}{}
		}
	}
}

func (s *ORSet) Contains(e string) bool {
	for p := range s.E {
		if p.Elem == e {
			return true
		}
	}
	return false
}

func (s *ORSet) Value() []string {
	seen := map[string]struct{}{}
	for p := range s.E {
		seen[p.Elem] = struct{}{}
	}
	out := make([]string, 0, len(seen))
	for e := range seen {
		out = append(out, e)
	}
	sort.Strings(out)
	return out
}

// Merge is the semilattice join: union tombstones, then subtract from live union.
func Merge(a, b *ORSet) *ORSet {
	out := NewORSet(a.replica)
	for p := range a.T {
		out.T[p] = struct{}{}
	}
	for p := range b.T {
		out.T[p] = struct{}{}
	}
	for p := range a.E {
		if _, dead := out.T[p]; !dead {
			out.E[p] = struct{}{}
		}
	}
	for p := range b.E {
		if _, dead := out.T[p]; !dead {
			out.E[p] = struct{}{}
		}
	}
	return out
}

func equalValue(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func main() {
	// Concurrent: P adds x; Q adds x then removes x. Add must win.
	P := NewORSet("P")
	P.Add("x")
	Q := NewORSet("Q")
	Q.Add("x")
	Q.Remove("x")

	// Merge both directions + duplicate merges -> all identical (idempotent join).
	m1 := Merge(P, Q)
	m2 := Merge(Q, P)
	m3 := Merge(m1, m1) // duplicate delivery
	if !equalValue(m1.Value(), m2.Value()) || !equalValue(m1.Value(), m3.Value()) {
		panic("OR-Set diverged under reorder/duplicate")
	}
	fmt.Println("OR-Set converged to", m1.Value()) // [x] — add wins
}
```

```
OR-Set converged to [x]
```

### 10.3 Java (LWW-Element-Set)

```java
import java.util.*;

/** LWW-Element-Set: each element -> (addTs, removeTs); merge = per-element max. */
public final class LWWSet {
    private static final long BOTTOM = -1L;             // ⊥
    private final Map<String, long[]> ts = new HashMap<>(); // [addTs, removeTs]
    private final boolean biasAdd;                       // true = add-wins on ties

    public LWWSet(boolean biasAdd) { this.biasAdd = biasAdd; }

    private long[] entry(String e) { return ts.getOrDefault(e, new long[]{BOTTOM, BOTTOM}); }

    public void add(String e, long t) {
        long[] x = entry(e);
        ts.put(e, new long[]{ Math.max(x[0], t), x[1] });
    }

    public void remove(String e, long t) {
        long[] x = entry(e);
        ts.put(e, new long[]{ x[0], Math.max(x[1], t) });
    }

    public boolean contains(String e) {
        long[] x = entry(e);
        if (x[0] < 0) return false;                     // never added
        return biasAdd ? x[0] >= x[1] : x[0] > x[1];
    }

    public Set<String> value() {
        Set<String> out = new TreeSet<>();
        for (String e : ts.keySet()) if (contains(e)) out.add(e);
        return out;
    }

    /** The semilattice join: componentwise max of timestamps. */
    public LWWSet merge(LWWSet other) {
        LWWSet out = new LWWSet(biasAdd);
        Set<String> keys = new HashSet<>(ts.keySet());
        keys.addAll(other.ts.keySet());
        for (String e : keys) {
            long[] a = entry(e), b = other.entry(e);
            out.ts.put(e, new long[]{ Math.max(a[0], b[0]), Math.max(a[1], b[1]) });
        }
        return out;
    }

    public static void main(String[] args) {
        LWWSet a = new LWWSet(true);  a.add("x", 10); a.remove("x", 20);
        LWWSet b = new LWWSet(true);  b.add("x", 10); b.add("x", 15);

        // Merge both orders; must agree (commutative join).
        Set<String> ab = a.merge(b).value();
        Set<String> ba = b.merge(a).value();
        if (!ab.equals(ba)) throw new AssertionError("LWW diverged");
        System.out.println("LWW converged to " + ab);   // [] — remove (t=20) beats add (t=15)
    }
}
```

```
LWW converged to []
```

---

## 11. Misconceptions, mistakes, cheat sheet, summary

### Common misconceptions

- **"LWW is add-wins."** No — LWW's tie-bias only matters on *equal* timestamps; a strictly-later remove deletes the element regardless. OR-Set's add-wins beats a concurrent remove *at any physical time*. Different mechanisms, different guarantees.
- **"A 2P-Set lets you re-add."** No. The remove-set is a G-Set; once an element is tombstoned it is absent forever (§3.4). A later add is a silent no-op.
- **"OR-Set needs synchronized clocks."** No — that's LWW. OR-Set uses unique tags and causality; it has no clock at all. This is exactly why it avoids clock-skew data loss.
- **"CRDT convergence means the answer is correct."** Convergence means all replicas *agree*. Under LWW with clock skew they can agree on the *wrong* (causally-stale) answer. Convergence ≠ intent-preservation.
- **"OR-Set tombstones can be deleted whenever the element is gone."** Only once the relevant removes are **causally stable** across all replicas; premature GC resurrects elements (§7).

### Common mistakes

- Reusing a tag across two adds in an OR-Set — tags **must** be globally unique, or a stale remove can kill a live re-add. Use `(replicaId, monotonicSeq)` or UUIDs.
- Forgetting the tie-bias must be **identical on every replica** in LWW. Mixed biases break convergence on ties.
- Op-based OR-Set over a non-causal transport: a `remove` delivered before the `add` whose tags it carries either no-ops wrongly or errors. Op-based OR-Set **requires causal delivery**.
- Letting `remove` in an op-based OR-Set carry the *element* but not the *observed tags* — the receiving replica then can't know which tags to kill and may delete concurrent adds. The op must carry the observed tag set.
- Assuming `merge` order or duplicates matter. If your merge isn't commutative/associative/idempotent, it isn't a join and your type isn't a CRDT — test with the shuffle+duplicate harness from §10.1.

### Cheat sheet

```
G-Set            value = X;            merge = X ∪ Y;          no remove
2P-Set           value = A \ R;        merge = (A₁∪A₂, R₁∪R₂); remove once, NO re-add
LWW-Element-Set  present ⟺ addTs ⋛ removeTs (⋛ = bias);
                 merge = per-element max(addTs), max(removeTs); re-add OK; clock-skew loss
OR-Set           present ⟺ ∃ live tag;
                 add mints fresh tag; remove kills only OBSERVED tags;
                 merge = (E₁∪E₂)\(T₁∪T₂); ADD-WINS; re-add OK; tombstones grow
ORSWOT           OR-Set with version vectors instead of tombstones; O(live+replicas)

Pick: append-only? G-Set. once-only membership? 2P-Set.
      tolerate clock-skew loss for simplicity? LWW. general set w/ re-add? OR-Set/ORSWOT.
```

### Summary

Every set CRDT in this family is a **join-semilattice**, and that single fact is what guarantees convergence regardless of message order, duplication, or partition. The **G-Set** is the powerset lattice under union — convergence for free, but no removal. The **2P-Set** is a *product* of two G-Sets, `(A, R)` with `present = A \ R`; merge is componentwise union, convergence composes, but the tombstone set is absorbing so **re-add is impossible forever**. The **LWW-Element-Set** attaches timestamps and merges by per-element `max`, restoring re-add and remaining a lattice, but it orders concurrent operations by a **physical clock** — so skew can silently lose writes while replicas still "converge." The **OR-Set** gives each add a **unique tag** and lets a remove kill only the tags it has **observed**; this makes a concurrent `add | remove` **add-win** by causality (proved in §5.3), supports true re-add, and needs no clock — at the cost of **growing metadata**, which **ORSWOT** tames with version vectors (Riak's `riak_dt_orswot`). The recurring tension is *semantic power vs metadata vs coordination*: choose the leftmost type in §8 that meets your needs, and remember that garbage-collecting OR-Set tombstones safely requires **causal stability**, the subject of the [senior](senior.md) tier.

### Further reading

- Shapiro, Preguiça, Baquero, Zawirski — *A Comprehensive Study of Convergent and Commutative Replicated Data Types* (Inria RR-7506, 2011). The foundational catalog; defines G-Set, 2P-Set, LWW-Element-Set, and OR-Set with proofs.
- Bieniusa, Zawirski, Preguiça, Shapiro, Baquero, Balegas, Duarte — *An Optimized Conflict-free Replicated Set* (arXiv:1210.3368, 2012). Introduces ORSWOT, the tombstone-free OR-Set using version vectors.
- Riak `riak_dt_orswot` source — the canonical production ORSWOT implementation.
- Continue to the [senior](senior.md) tier for delta-state CRDTs, dotted version vectors, causal stability, and garbage collection.
