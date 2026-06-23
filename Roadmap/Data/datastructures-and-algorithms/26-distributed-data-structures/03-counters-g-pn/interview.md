# Distributed Counters: G-Counter & PN-Counter — Interview Questions

A focused question-and-answer bank for distributed-systems interviews. Counters are the
"hello world" of CRDTs, and they show up constantly: like counts, view counts, inventory,
rate limits, and metrics aggregation. Interviewers love them because a correct answer forces
you to reason about *idempotence*, *commutativity*, *associativity*, *lattices*, and the hard
truth that **you cannot enforce a global invariant like `balance >= 0` with a plain CRDT**.

This file assumes you have skimmed the conceptual basis. If not, start with
[CRDT Fundamentals interview](../01-crdt-fundamentals/interview.md) and
[State vs Op interview](../02-state-vs-operation-based-crdts/interview.md), then come back.
For the worked mechanics and code, see [junior](junior.md), [senior](senior.md), and
[professional](professional.md).

---

## Table of Contents

1. [Conceptual](#conceptual)
2. [G-Counter mechanics](#g-counter-mechanics)
3. [PN-Counter & decrements](#pn-counter--decrements)
4. [Lattice / Convergence](#lattice--convergence)
5. [State vs Op counters](#state-vs-op-counters)
6. [Invariants & Bounded counters](#invariants--bounded-counters)
7. [System Design](#system-design)
8. [Gotcha / Trick](#gotcha--trick)
9. [Rapid-Fire](#rapid-fire)
10. [Common Mistakes](#common-mistakes)
11. [Tips & Summary](#tips--summary)

---

## Conceptual

### Q1: Why can't you just use a single shared integer counter across replicas? *(Easy)*

**Answer**: A single shared integer forces a *read-modify-write* cycle: read the current
value, add one, write it back. In a distributed system without a global lock, two replicas
can read the same value `v` concurrently, both compute `v + 1`, and both write `v + 1` back.
The two increments collapse into one — a **lost update**.

```
Replica A: read 10 ─┐
Replica B: read 10 ─┤  both see 10
Replica A: write 11 ─┤
Replica B: write 11 ─┘  final value 11, but TWO increments happened → lost update
```

You could serialize every increment through a single coordinator (a leader, a lock, a
linearizable register), but that destroys availability and throughput: every `+1` now pays a
cross-network round trip and stalls if the coordinator is unreachable. CRDT counters remove
the coordination entirely — each replica records its *own* contribution locally, and the
true value is reconstructed by combining everyone's contributions.

---

### Q2: What problem does a G-Counter actually solve, in one sentence? *(Easy)*

**Answer**: It lets multiple replicas increment a shared count **concurrently, without
coordination, with availability under partition**, and still **converge to the same correct
total** once they exchange state. "Correct" here means *no increment is ever lost and none is
double-counted* — every `+1` that any replica accepted is reflected exactly once in the
converged value.

---

### Q3: What is the core insight behind the per-replica-slot design? *(Medium)*

**Answer**: The insight is to **partition the count by author**. Instead of one shared number
that everybody mutates, the counter is a *vector* (a map) with one slot per replica:

```
state = { A: 5, B: 3, C: 7 }   // A added 5, B added 3, C added 7
```

Each replica only ever writes its **own** slot, monotonically increasing it. Because no two
replicas write the same slot, there is never a write-write conflict to resolve. The logical
value is the sum across all slots (`5 + 3 + 7 = 15`). Merging two replicas' views is then a
*conflict-free* operation because each slot has a single owner and only grows.

This is the same trick a **version vector** uses, repurposed to carry magnitudes instead of
event counts.

---

### Q4: Why does this design map naturally onto an "eventually consistent" system? *(Medium)*

**Answer**: Because the per-slot values are **monotonically increasing** and the merge is a
**join** (least upper bound) over a lattice, the counter satisfies the three properties that
make Strong Eventual Consistency (SEC) possible:

- **Commutative**: merge order does not matter.
- **Associative**: grouping of merges does not matter.
- **Idempotent**: merging the same state twice changes nothing.

Given those, any two replicas that have *seen the same set of updates* will compute the same
value, regardless of the order or multiplicity in which they received them. That is exactly
what an eventually-consistent, gossip/anti-entropy system needs: deliver-at-least-once, any
order, and convergence still holds.

---

## G-Counter mechanics

### Q5: Define the G-Counter precisely: state, value query, increment, and merge. *(Medium)*

**Answer**: Let `R` be the set of replica IDs.

- **State**: a map `P: R → ℕ`, every slot initialized to `0`. Replica `i` holds the full map
  but only writes `P[i]`.
- **value()** = `Σ_{r ∈ R} P[r]` — the sum of all slots.
- **increment(n)** on replica `i`: `P[i] := P[i] + n` (with `n ≥ 0`).
- **merge(P, Q)** = a new map `M` where `M[r] = max(P[r], Q[r])` for every `r` — **elementwise
  maximum**.

The "G" stands for **Grow-only**: slots never decrease, so the value is monotonically
non-decreasing.

---

### Q6: Walk through a concrete merge. *(Easy)*

**Answer**: Two replicas have diverged:

```
P (replica A's view) = { A: 5, B: 2, C: 0 }    value = 7
Q (replica B's view) = { A: 3, B: 4, C: 1 }    value = 8

merge:
  A: max(5, 3) = 5
  B: max(2, 4) = 4
  C: max(0, 1) = 1
M = { A: 5, B: 4, C: 1 }                        value = 10
```

A had counted its own 5 (B only knew of 3), B had counted its own 4 (A only knew of 2), and B
had seen C's 1. The merge takes the freshest knowledge of each slot. Note the merged value
(10) is **not** `7 + 8 = 15` — it correctly de-duplicates the overlapping knowledge.

---

### Q7: Why does merge take the *max* of each slot and not the *sum*? *(Hard)*

**Answer**: Because each slot is **owned by exactly one replica** and represents *that
replica's running total* of contributions — not a single delta. When two views disagree about
slot `B`, they are reporting two *snapshots* of the same monotonically-growing quantity. The
larger snapshot is simply the more recent one and already *includes* the smaller one. Taking
`max` keeps the freshest snapshot; taking `sum` would **double-count** the contributions both
views already share.

Concretely, suppose B has incremented to 4 and gossiped that fact to A. Now both A and B hold
`B: 4`.

```
max(4, 4) = 4   ✓ correct — B's total is 4
sum(4, 4) = 8   ✗ wrong   — invents 4 increments that never happened
```

`max` is also what makes merge **idempotent**: `max(x, x) = x`, so merging the same state
twice is a no-op. `sum` is not idempotent (`x + x ≠ x`), which would make the counter explode
on redelivery. The whole correctness of the structure hinges on this choice.

---

### Q8: Why must increments be non-negative in a G-Counter? *(Medium)*

**Answer**: Because merge is elementwise `max`, slots must be **monotonically increasing** for
the lattice to be well-behaved. If a slot could decrease, then `max` would silently *discard*
the decrement: imagine `P[i]` goes `5 → 5 → 5` on A because A never lowers below the highest
value it has seen. A decrement on one replica would be "outvoted" by the older, higher value
elsewhere, so the decrement would never take effect (or would flicker). Monotonic growth is a
precondition for the `max`-merge to converge correctly — that is exactly why you need a
PN-Counter (two grow-only halves) to support subtraction.

---

### Q9: How large is the metadata of a G-Counter, and why does it matter? *(Medium)*

**Answer**: The state is **O(number of replicas)** integers, because there is one slot per
replica that has ever incremented. This matters because:

- **It grows with the cluster, not with the count.** A counter at value 10 billion across 5
  replicas is still 5 slots. But 100,000 replicas means 100,000 slots regardless of value.
- **In systems where the "replica" is a client/actor** (e.g., every device or session gets a
  unique actor ID), the map grows **unbounded** as new actors appear and never shrink. This is
  the classic *actor-id explosion* problem. A like-counter keyed by user ID would accumulate a
  slot per user forever.

Mitigations: keep the replica set small and stable (slot per *server*, not per *client*);
periodically garbage-collect dead actors via a coordinated checkpoint; or use a fixed pool of
shard/server IDs and route client increments to a server slot.

---

### Q10: Is a G-Counter's value query expensive? *(Easy)*

**Answer**: `value()` is `O(#replicas)` because it sums all slots. For small replica sets this
is trivially cheap. For large maps you can cache the running sum and update it incrementally on
each local increment and on each merge (add the positive deltas). Reads are still local — no
network — so even the naive sum is far cheaper than any coordinated counter.

---

## PN-Counter & decrements

### Q11: How do you support decrements? Define the PN-Counter. *(Medium)*

**Answer**: A **PN-Counter** = **two G-Counters**, conventionally named `P` (positives/
increments) and `N` (negatives/decrements).

- **increment(n)** on replica `i`: `P[i] += n`.
- **decrement(n)** on replica `i`: `N[i] += n`.
- **value()** = `ΣP − ΣN` (sum of all P slots minus sum of all N slots).
- **merge** = merge the two G-Counters independently: `max` elementwise on `P`, and `max`
  elementwise on `N`.

Because both halves are grow-only G-Counters, the whole structure inherits commutativity,
associativity, idempotence, and convergence. Decrements become *increments of a separate
grow-only counter*, neatly sidestepping the monotonicity problem.

---

### Q12: Why can't you just decrement a slot directly instead of using two counters? *(Hard)*

**Answer**: Because directly subtracting breaks the **monotonicity** that the `max`-merge
relies on (see Q8). If a slot could go down, the `max` in merge would resurrect the higher,
older value and the decrement would be lost. By splitting into two grow-only halves, *both*
slots only ever increase, so `max`-merge stays valid, and the subtraction happens only at
**read time** (`ΣP − ΣN`), never inside the converging state. Decrements are modeled as
"adding to the negatives," which is a monotone operation.

---

### Q13: Walk through a PN-Counter merge with a decrement. *(Medium)*

**Answer**:

```
Replica A: increment(10) on A, decrement(3) on A
  P = { A: 10 }   N = { A: 3 }   value = 10 - 3 = 7

Replica B: increment(5) on B, decrement(4) on B
  P = { B: 5 }    N = { B: 4 }   value = 5 - 4 = 1

merge P:  { A: max(10,0)=10, B: max(0,5)=5 }   ΣP = 15
merge N:  { A: max(3,0)=3,   B: max(0,4)=4 }   ΣN = 7
value = 15 - 7 = 8
```

Both replicas now converge to 8, and 8 = (10+5) − (3+4), exactly the net of every operation
applied across the cluster.

---

### Q14: Can a PN-Counter's value go negative? *(Easy)*

**Answer**: **Yes.** If total decrements exceed total increments, `ΣP − ΣN` is negative. The
CRDT has no notion of a floor; it just tracks net additions and subtractions. This is fine for
metrics that can legitimately go negative (net sentiment, signed deltas) and is the root cause
of the famous invariant problem (Q19) for things like inventory or balances, which must *not*
go negative.

---

### Q15: Does a PN-Counter cost twice the metadata of a G-Counter? *(Easy)*

**Answer**: Roughly, yes — it carries two maps, so worst case `O(2 × #replicas)`. In practice
many replicas only ever touch one half (a node that never decrements has empty N slots), and
you store only non-zero/seen slots, so the constant factor is often less than literally
doubled. The asymptotic class is unchanged: still linear in the number of distinct actors.

---

## Lattice / Convergence

### Q16: What lattice does a G-Counter form, and why does that guarantee convergence? *(Hard)*

**Answer**: The state space is a **join-semilattice** under the partial order

```
P ≤ Q  ⟺  ∀r: P[r] ≤ Q[r]   (componentwise / pointwise order)
```

with **join** = elementwise `max`. This is the product of per-slot total orders (ℕ), and the
product of semilattices is a semilattice. Key facts:

- The join (merge) is **commutative, associative, and idempotent** — the algebraic definition
  of a semilattice's least-upper-bound operation.
- Updates are **inflationary**: every increment moves the state *up* in the order
  (`P ≤ increment(P)`).

By the CvRDT (state-based CRDT) convergence theorem, monotone updates plus a join-semilattice
merge guarantee **Strong Eventual Consistency**: any two replicas that received the same set
of updates compute the same join, irrespective of order or duplication. Convergence is a
*mathematical consequence* of the lattice structure, not something the code has to carefully
arrange.

---

### Q17: Which three algebraic properties does the merge need, and what does each buy you? *(Medium)*

**Answer**:

| Property | Definition | What it buys |
|---|---|---|
| **Commutative** | `merge(a,b) = merge(b,a)` | Messages can arrive in **any order** |
| **Associative** | `merge(merge(a,b),c) = merge(a,merge(b,c))` | You can **batch / regroup** merges freely |
| **Idempotent** | `merge(a,a) = a` | **Redelivery** of the same state is harmless |

Elementwise `max` satisfies all three because integer `max` does. These are exactly the
properties anti-entropy gossip needs: it can resend, reorder, and re-batch state without ever
corrupting the result.

---

### Q18: How does idempotence specifically protect a state-based counter from message redelivery? *(Hard)*

**Answer**: State-based replication ships the *entire current state* (the slot map), and merge
is `max`. If the network redelivers a state you already merged, re-merging is `max(x, x) = x`
for every slot — a **no-op**. The value cannot drift. Contrast this with a hypothetical
"ship the value and add it" scheme: redelivering `+5` twice adds 10. The idempotent
`max`-merge is precisely what makes at-least-once, lossy, reordering transports safe for
state-based counters — *no deduplication layer required*. (Op-based counters give up this free
lunch; see Q22.)

---

## State vs Op counters

### Q19: Compare state-based and operation-based counter replication. *(Medium)*

**Answer**:

| | **State-based (CvRDT)** | **Operation-based (CmRDT)** |
|---|---|---|
| What is shipped | Full slot map (the whole state) | Just the op, e.g. `inc(+3)` |
| Merge / apply | Elementwise `max` (join) | Apply delta to local value |
| Delivery needs | At-least-once, any order, dup OK | **Exactly-once, causal** (typically) |
| Bandwidth | Bigger messages (whole state) | Tiny messages (one op) |
| Dedup needed? | **No** — merge is idempotent | **Yes** — apply is not idempotent |
| Failure tolerance | Very forgiving | Needs reliable, deduplicating transport |

State-based trades bandwidth for transport simplicity; op-based trades message size for a
stronger delivery contract. Delta-state CRDTs are the modern middle ground: ship small deltas
but keep the idempotent `max`-merge.

---

### Q20: An op-based increment is `value += delta`. Why is that dangerous on an unreliable network? *(Hard)*

**Answer**: Because `value += delta` is **not idempotent**. If the transport redelivers an
`inc(+1)` op (retries, duplicate ACK loss, broker at-least-once delivery), the replica applies
it *twice* and **double-counts** the increment. Op-based counters therefore *require*
exactly-once, usually causal, delivery — which in practice means message IDs + a
dedup/de-bounce store, or an idempotency key per op. That delivery guarantee is the price you
pay for the tiny message size. State-based counters avoid the issue entirely because `max` is
idempotent (Q18), so a redelivered *state* changes nothing.

---

### Q21: For a redelivered op-based op, what is the minimal fix? *(Medium)*

**Answer**: Give each operation a globally unique ID and have each replica keep a set of
*applied op IDs*; ignore ops whose ID is already present. That restores idempotence at the
delivery layer. Causal delivery (or vector-clock dependency tracking) is additionally needed if
ops are not commutative — though pure counter increments *are* commutative, so for counters the
main requirement is exactly-once. This is exactly the bookkeeping that state-based CRDTs let
you skip.

---

## Invariants & Bounded counters

### Q22: Why can't a plain PN-Counter enforce `balance >= 0` or "never oversell inventory"? *(Hard)*

**Answer**: Because a CRDT guarantees **convergence**, not **invariant preservation under
concurrency**. Each replica decides *locally* whether a decrement is allowed, using only the
state it can see. Two replicas, each seeing inventory = 1, can both independently approve a
"sell 1" decrement while partitioned. Both decrements are valid local operations; both get
recorded; when they merge, the converged value is `−1`. The CRDT faithfully and correctly
converges to an **oversold** state. No amount of merge logic can retroactively reject one of
two operations that were each locally legal at the time they were accepted — that would require
the very coordination CRDTs are designed to avoid.

The deeper reason: invariants like `≥ 0` are **global** constraints over the *sum*, but each
replica only controls its *own* slot and sees a possibly-stale view of the others. A global
lower bound is not a property the join-semilattice can preserve.

```
Inventory = 1, partitioned:
  Replica A: approves sell(1)  → its local view says 0, fine
  Replica B: approves sell(1)  → its local view also said 1, fine
  merge → inventory = -1   (oversold!)
```

---

### Q23: So how do real systems enforce a non-negative bound without a global lock? *(Hard)*

**Answer**: With **escrow / reservation** (a.k.a. **bounded counters** or the *escrow
transactions* technique). The idea: **pre-partition the allowance** among replicas so that
each replica can spend only from its *own* local quota, which is guaranteed not to overlap with
anyone else's.

- Total stock `S` is divided into per-replica budgets: `S = Σ budget[i]`.
- Replica `i` may decrement only while `budget[i] > 0`, consuming from its local share — **no
  coordination needed** for the common case.
- If a replica's budget runs low, it **borrows** from another replica (a *rebalancing*
  protocol). Borrowing requires a small, point-to-point coordination, but only at the
  boundaries, not on every operation.
- Because the sum of locally-spendable budgets never exceeds `S`, the global invariant
  `remaining ≥ 0` **holds by construction**, even under partition.

This converts a global invariant into a set of *local* invariants that compose correctly. The
trade-off: a partitioned replica with an empty budget must reject (or block) requests even if
*other* replicas still hold stock — availability is sacrificed precisely at the invariant
boundary, which is exactly where you want the cost to land. Bounded counters (Balegas et al.)
formalize this.

---

### Q24: When is a plain PN-Counter perfectly fine despite the negative-value risk? *(Medium)*

**Answer**: When the quantity has **no hard floor** or the floor is *soft/advisory*:

- Like counts, view counts, reaction tallies (monotone-ish, floors are not safety-critical).
- Net metrics that can legitimately be negative (net votes, signed sentiment).
- Approximate dashboards where a transient slightly-wrong value self-heals on convergence.

Reach for escrow/bounded counters only when a `< 0` value is a **correctness or money bug**
(inventory, account balances, seat allocation, rate-limit budgets that must never be exceeded).

---

## System Design

### Q25: Design a like / view counter for a service at large scale. *(Hard)*

**Answer**: Treat each like as a monotone increment and use a **G-Counter**, but key the slots
by **server/shard**, not by user, to avoid actor-id explosion (Q9).

- **Sharded G-Counter**: each application server (or each of *N* fixed shards) owns one slot.
  Likes are routed to a shard (e.g., consistent hash of the post ID, or sticky per region).
  Each shard increments its own slot locally — no contention, no cross-shard lock.
- **Aggregation**: periodically (every few seconds) shards gossip / write their slot to a store;
  the displayed total is `Σ slots`. Reads are *not* strongly consistent — a like may take a
  moment to appear globally, which is acceptable for social counts.
- **Idempotence of the like itself**: dedupe at the *application* layer (one like per
  user-per-post via a per-user set), so the counter only ever receives net-new increments.
- **Hot-key handling**: a viral post concentrates writes; absorb bursts with a local in-memory
  delta per server that is flushed and merged periodically (delta-state style), turning millions
  of `+1`s into a few merged slot updates.

Why G (not PN)? Likes mostly go up; an "unlike" can be modeled as a decrement → use a
PN-Counter, but most designs instead keep the per-user like-set as the source of truth and
treat the counter as a fast, eventually-consistent cache derived from it.

---

### Q26: Design distributed inventory that never oversells. *(Hard)*

**Answer**: A plain PN-Counter **cannot** guarantee this (Q22), so use **escrow / bounded
counters**:

1. **Split the stock** `S` into per-region (or per-node) reservations: `S = Σ budget[r]`,
   allocated proportionally to expected demand.
2. **Local sells**: each node decrements only from its own `budget[r]`. While `budget[r] > 0`,
   sells are fully local, available, and **cannot oversell** because the budgets are disjoint
   and sum to ≤ `S`.
3. **Rebalance on imbalance**: a node nearing zero requests a transfer from a node with spare
   budget — a small, coordinated point-to-point move (a leader or a 2-party handoff with a
   token), not a global lock per sale.
4. **Hard stop at zero**: if a partitioned node has zero local budget and can't reach a peer,
   it **refuses** the sale (or queues it as backorder). This is the deliberate availability
   sacrifice, isolated to the exact moment the invariant is at risk.
5. **Reconciliation**: returns/cancellations add back to a node's budget; a background process
   audits `Σ budget + sold == S`.

Where does the line between "CRDT-fine" and "needs coordination" fall? **Counting** is
CRDT-friendly; **enforcing a global bound on that count** demands escrow or consensus. Some
teams instead push the bound into a strongly-consistent service (e.g., a single-leader
reservation service) for the *checkout* step while keeping a CRDT counter for *display*. Pick
based on whether overselling costs money or merely embarrasses a dashboard.

---

### Q27: How do these counters fit into a metrics / telemetry aggregation pipeline? *(Medium)*

**Answer**: Edge collectors each own a slot and increment locally (request counts, error
counts). They ship state (or deltas) up a tree; intermediate aggregators **merge** with
elementwise `max`, and the root reports `Σ slots`. Because merge is associative and idempotent,
the tree can re-merge after a collector restart or a duplicate flush without double-counting —
a redelivered partial sum is absorbed by `max`. This is why CRDT counters are attractive for
*lossy, restart-prone* metric fan-in where exactly-once delivery is impractical.

---

## Gotcha / Trick

### Q28: "To merge two counters, just add the two vectors elementwise." True or false? *(Medium)*

**Answer**: **False.** Merge is elementwise **max**, not elementwise sum. Adding the vectors
double-counts every slot the two views share (Q7) and destroys idempotence — re-merging would
keep growing the count without bound. The only place a *sum* appears is the **value query**
(`Σ slots`), which is across slots of a *single* converged state, never across two states being
merged. Confusing "sum across slots (read)" with "sum across replicas (merge)" is the single
most common counter mistake.

---

### Q29: "Reading a CRDT counter is strongly consistent." True or false? *(Easy)*

**Answer**: **False.** A CRDT read returns the **local** converged value, which may be stale:
increments accepted elsewhere but not yet merged in are invisible. CRDT counters offer **Strong
Eventual Consistency**, not linearizability. If you need "every read reflects every prior write
globally," you need coordination (consensus/leader), not a CRDT. The right framing in an
interview: *CRDTs give convergence and availability; they do not give recency/linearizable
reads.*

---

### Q30: "Because merge is idempotent, a redelivered state-based merge double-counts." True or false? *(Medium)*

**Answer**: **False — and the two clauses contradict each other.** Idempotence is precisely
what *prevents* double-counting on redelivery: `max(x, x) = x`, so re-merging an
already-seen state is a no-op (Q18). The double-counting hazard belongs to **op-based**
counters whose `value += delta` is *not* idempotent (Q20). This question tests whether you
keep the state-based vs op-based distinction straight.

---

### Q31: "Two replicas show different values, so the counter is broken." True or false? *(Easy)*

**Answer**: **False** (usually). Divergent values across replicas at a given instant are
*expected* — they simply haven't merged the latest updates yet. The guarantee is that once they
*have* exchanged the same set of updates, they converge to the same value. Temporary divergence
is the normal, healthy state of an available, partition-tolerant counter. It is only "broken"
if values *stay* different after replicas have fully exchanged state.

---

### Q32: "A G-Counter slot can be owned by two replicas if they coordinate." Should you do this? *(Hard)*

**Answer**: **No.** Single-writer-per-slot is the load-bearing invariant. If two replicas write
the same slot, they reintroduce the original lost-update / write-write conflict *inside* the
slot, and `max`-merge will silently drop one writer's increments (Q8). The entire conflict-free
property comes from *partitioning writes by owner*. If you must let multiple writers contribute,
give each a distinct slot ID — never share one.

---

## Rapid-Fire

Short, high-frequency questions. One-liners expected.

### Q33: What does the "G" in G-Counter stand for? *(Easy)*
**Answer**: Grow-only — slots never decrease.

### Q34: What is the value of a G-Counter? *(Easy)*
**Answer**: The sum of all per-replica slots, `Σ P[r]`.

### Q35: What is the merge operation? *(Easy)*
**Answer**: Elementwise maximum of the two slot maps.

### Q36: Why max and not sum on merge? *(Easy)*
**Answer**: Slots are single-owner snapshots of a monotone total; `max` keeps the freshest and stays idempotent. Sum double-counts.

### Q37: What is a PN-Counter made of? *(Easy)*
**Answer**: Two G-Counters, `P` (increments) and `N` (decrements).

### Q38: How do you compute a PN-Counter's value? *(Easy)*
**Answer**: `ΣP − ΣN`.

### Q39: Can a PN-Counter go negative? *(Easy)*
**Answer**: Yes — if `ΣN > ΣP`.

### Q40: What's the metadata size of a G-Counter? *(Easy)*
**Answer**: O(number of replicas/actors), independent of the count's magnitude.

### Q41: What lattice does a G-Counter form? *(Medium)*
**Answer**: A join-semilattice ordered pointwise, with join = elementwise max.

### Q42: Which three merge properties enable convergence? *(Medium)*
**Answer**: Commutativity, associativity, idempotence.

### Q43: Why can't you decrement a single slot directly? *(Medium)*
**Answer**: It breaks monotonicity, so `max`-merge would discard the decrement.

### Q44: State-based or op-based — which needs exactly-once delivery? *(Medium)*
**Answer**: Op-based (its apply is not idempotent).

### Q45: Can a plain CRDT enforce `balance >= 0`? *(Medium)*
**Answer**: No — it converges but cannot preserve a global lower-bound invariant.

### Q46: What technique fixes the bounded-counter problem? *(Medium)*
**Answer**: Escrow / reservation (bounded counters): pre-split the allowance per replica.

### Q47: Is a CRDT-counter read strongly consistent? *(Easy)*
**Answer**: No — it's strongly *eventually* consistent; reads may be stale.

### Q48: What's the actor-id explosion problem? *(Medium)*
**Answer**: Keying slots by ephemeral clients makes the slot map grow unbounded.

### Q49: What is the value query's relationship to sum? *(Easy)*
**Answer**: Value sums *across slots of one state*; merge never sums *across two states*.

### Q50: Modern compromise between state- and op-based shipping? *(Medium)*
**Answer**: Delta-state CRDTs — ship small deltas, keep idempotent `max`-merge.

---

## Common Mistakes

### M1: Summing vectors on merge instead of taking max

The number-one error (Q7, Q28). Adding slot-by-slot double-counts shared knowledge and breaks
idempotence, making the value balloon on every gossip round. **Merge = max; sum is only for the
read.**

### M2: Sharing a slot between writers

Two writers on one slot reintroduces lost updates and `max` silently drops one (Q32). One slot,
one owner — always.

### M3: Trying to decrement a G-Counter slot

A G-Counter is grow-only; you need a PN-Counter (two halves) for subtraction (Q11–Q12). Don't
hack negatives into a single map.

### M4: Assuming a CRDT enforces invariants

Convergence ≠ invariant preservation. A PN-Counter *will* go negative and inventory *will*
oversell under concurrency unless you add escrow/bounded counters (Q22–Q23).

### M5: Confusing state-based and op-based redelivery behavior

State-based merge is idempotent and dedup-free; op-based `+=` is not and *requires*
exactly-once (Q18, Q20, Q30). Mixing these up is a classic interview trip-up.

### M6: Expecting linearizable reads

CRDT reads are local and may be stale (Q29). If recency is a requirement, a CRDT is the wrong
tool.

### M7: Keying slots by client/user

Leads to unbounded metadata growth (Q9, Q48). Key by a small, stable set of servers/shards and
deduplicate the *operation* at the app layer.

### M8: Forgetting that increments must be non-negative

A G-Counter slot must only grow. Negative increments break the lattice (Q8).

---

## Tips & Summary

**The one-paragraph mental model.** A G-Counter is a *version-vector of magnitudes*: one
grow-only slot per replica, value = `Σ slots`, merge = elementwise `max`. The `max` is what
makes it commutative, associative, and **idempotent** — which is why state-based gossip can
lose, reorder, and duplicate messages and still converge. A PN-Counter glues two G-Counters
together so it can subtract (`ΣP − ΣN`), at the cost of letting the value go negative.

**The two things interviewers really probe:**

1. **Max vs sum, and idempotence.** Be able to explain *why* merge uses max (single-owner
   monotone snapshots) and *why* that gives idempotence (`max(x,x)=x`), and contrast with the
   op-based `+=` double-count under redelivery.
2. **The invariant wall.** Say clearly: *a plain CRDT converges but cannot enforce `≥ 0`*, then
   reach for **escrow / bounded counters** to convert a global invariant into composable local
   budgets, sacrificing availability only at the boundary.

**Decision cheat-sheet:**

| If you need… | Use… |
|---|---|
| Increment-only, coordination-free count | **G-Counter** |
| Increment + decrement, no hard floor | **PN-Counter** |
| A count with a hard `≥ 0` / `≤ cap` bound | **Escrow / bounded counter** |
| Tiny messages, reliable transport available | **Op-based** (with dedup) |
| Lossy/duplicating transport, simplicity | **State-based** (idempotent merge) |
| Both: small messages + lossy transport | **Delta-state CRDT** |
| Recent/linearizable reads | **Not a CRDT** — use consensus/leader |

**Closing line for the interview.** "Counters are CRDTs' easiest win for *counting* and their
sharpest lesson on *limits*: convergence is free, but a global invariant like never-oversell is
not — that still costs coordination, just pushed to the budget boundary via escrow."

**Keep going:**
- [CRDT Fundamentals interview](../01-crdt-fundamentals/interview.md) — lattices and SEC in general.
- [State vs Op interview](../02-state-vs-operation-based-crdts/interview.md) — the delivery-contract trade-off in depth.
- [junior](junior.md) · [senior](senior.md) · [professional](professional.md) — mechanics, edge cases, and production tuning.
