# CRDT Fundamentals — Interview Questions

> A Q&A bank for distributed-systems and senior-backend interviews. Answers are written
> to be **crisp, correct, and quotable** — what you'd actually say at a whiteboard, from
> "what is a CRDT" up to a full system-design framing.
>
> Related tiers: [junior](junior.md) · [senior](senior.md) · [professional](professional.md)
> Sibling topics: [Counters interview](../03-counters-g-pn/interview.md) · [Sets interview](../04-sets-or-set-lww/interview.md)

---

## Table of Contents

- [Conceptual Questions](#conceptual-questions)
- [The Lattice / Convergence Theory](#the-lattice--convergence-theory)
- [State-based vs Op-based](#state-based-vs-op-based)
- [CRDTs vs Consensus vs OT](#crdts-vs-consensus-vs-ot)
- [System Design](#system-design)
- [Gotcha / Trick Questions](#gotcha--trick-questions)
- [Rapid-Fire Q&A](#rapid-fire-qa)
- [Common Mistakes](#common-mistakes)
- [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: What is a CRDT, and what problem does it solve? *(Easy)*

**Answer**: A **CRDT** (Conflict-free Replicated Data Type) is a data type whose replicas can
be updated **independently and concurrently**, without coordination between replicas, and which
are **mathematically guaranteed to converge** to the same value once they have seen the same set
of updates.

The problem it solves is the central tension in the CAP theorem. If you want a system to remain
**available under network partitions** (the "AP" corner), replicas must accept writes even when
they cannot talk to each other. That immediately raises the question: *when the partition heals,
how do you reconcile divergent states without losing data or requiring a human to resolve
conflicts?* CRDTs answer this by constraining the data type's `merge` operation so that
reconciliation is **automatic, deterministic, and conflict-free** — convergence is a property of
the algebra, not of a lock, a coordinator, or a quorum.

One-liner to quote:

> "A CRDT lets every replica accept writes during a partition and still guarantees they all
> reach the same state afterward — availability without coordination, convergence without
> consensus."

---

### Q2: Define strong eventual consistency. How does it differ from plain eventual consistency? *(Medium)*

**Answer**: **Eventual consistency (EC)** promises only that *if updates stop, replicas will
eventually agree* — but it says nothing about *how* they agree. Classic EC systems resolve
conflicts with application logic, last-writer-wins heuristics, read-repair, or manual
intervention, and two replicas that received the same updates **in a different order** may
transiently (or even permanently) hold different values.

**Strong eventual consistency (SEC)** adds a much stronger, *deterministic* guarantee:

> Any two replicas that have received the **same set of updates** are in the **same state** —
> immediately, regardless of the order or batching in which those updates arrived, and with **no
> conflict-resolution step exposed to the application**.

The key differences:

| Property | Eventual Consistency | Strong Eventual Consistency |
|---|---|---|
| Convergence guaranteed? | Eventually, if updates stop | Yes |
| Order-independent? | No — order can matter | **Yes** — same delivered set ⇒ same state |
| Conflict resolution | Ad hoc / app-defined / manual | Built into the type's algebra |
| Determinism | Not guaranteed | Guaranteed |

SEC is precisely the contract a CRDT provides. It is *strong* not in the linearizability sense
(it is not strong consistency) but in that convergence is **provable and order-independent**
rather than best-effort.

---

### Q3: Walk me through the three algebraic properties a CRDT merge relies on, and why each one matters operationally. *(Medium)*

**Answer**: A state-based CRDT's `merge` must form a **commutative, associative, idempotent**
operation (it's the *join* of a semilattice — see Q6). Each property maps directly to a
real-world network failure you must tolerate:

| Property | Algebra | Failure it tolerates |
|---|---|---|
| **Idempotence** | `merge(x, x) = x` | **At-least-once / duplicate delivery.** The network can redeliver the same state, and applying it twice changes nothing. |
| **Commutativity** | `merge(a, b) = merge(b, a)` | **Out-of-order delivery.** Replicas can receive states/ops in any order and still converge. |
| **Associativity** | `merge(merge(a, b), c) = merge(a, merge(b, c))` | **Arbitrary batching / regrouping.** It doesn't matter how you group merges — pairwise, all-at-once, gossiped through intermediaries. |

The punchline for an interview:

> "Real networks **reorder, duplicate, and batch** messages. Commutativity handles reorder,
> idempotence handles duplicates, associativity handles batching. A merge with all three can be
> safely applied over *any* delivery the network throws at it."

This is exactly why you don't need exactly-once delivery, ordered channels, or deduplication for
state-based CRDTs — the algebra absorbs all of those network defects.

---

### Q4: Give a concrete example of the simplest possible CRDT. *(Easy)*

**Answer**: A **grow-only counter (G-Counter)** or a **grow-only set (G-Set)**.

For a G-Set, each replica holds a set; the merge is set **union**:

```
merge(A, B) = A ∪ B
```

Union is commutative (`A ∪ B = B ∪ A`), associative, and idempotent (`A ∪ A = A`). So a
grow-only set is a CRDT for free — add elements anywhere, gossip the sets, union on receipt, and
every replica converges to the union of all additions. (The catch — *removal* — is what makes
real sets hard; see [Sets interview](../04-sets-or-set-lww/interview.md) and Q16.)

For a G-Counter, each replica owns a slot in a vector and only ever increments **its own** slot;
merge takes the element-wise **max** of the vectors, and the counter's value is the sum. See
[Counters interview](../03-counters-g-pn/interview.md) for the full treatment.

---

### Q5: Are CRDTs only about databases? Where do they actually show up in production? *(Easy)*

**Answer**: No — they're a general technique for replicated state. Real deployments include:

- **Distributed databases:** Riak (the canonical "Riak DT" implementation), Redis (CRDTs in
  Redis Enterprise / Active-Active), Azure Cosmos DB's multi-region writes.
- **Collaborative editors:** Automerge and Yjs power local-first/offline-capable apps; collab
  text editing increasingly uses sequence CRDTs (RGA, Logoot, Treedoc, Fugue) rather than OT.
- **Shopping carts:** Amazon's Dynamo paper popularized the partition-tolerant cart, and the
  "add to cart" semantics are naturally a CRDT problem.
- **Presence / metrics / telemetry:** "who's online," like counts, view counts — high-write,
  approximate, never-block-the-user features map cleanly to counters and sets.
- **CRDT-backed sync engines:** local-first frameworks (Automerge, Yjs, Replicache-style) sync
  peer-to-peer or through a relay without a central authority resolving conflicts.

---

## The Lattice / Convergence Theory

### Q6: What is a join-semilattice, and why is "merge = join" the heart of CRDT theory? *(Hard)*

**Answer**: A **join-semilattice** is a partially ordered set `(S, ≤)` in which every pair of
elements has a **least upper bound (LUB)**, called their **join** `⊔`. "Least upper bound of `a`
and `b`" means the smallest element that is `≥` both `a` and `b`.

A state-based CRDT models each replica's state as an element of such a lattice, with:

- **Updates are monotonic** — every update moves the state *upward* in the order (`s ≤ update(s)`).
- **`merge` is the join** — `merge(a, b) = a ⊔ b = LUB(a, b)`.

Why this gives you convergence *for free*: the join operation is, by the algebra of lattices,
**automatically commutative, associative, and idempotent**. Those are exactly the three
properties from Q3. So if you can express your data type as a lattice and your merge as its join,
you have *proven* SEC without writing a single proof — the math is done for you.

The mental model:

> "Every state is a point in a lattice. Updates only move you up. `merge` jumps to the lowest
> point that's above both inputs. Because joins are commutative/associative/idempotent, replicas
> that climb the lattice in any order, with any duplicates, still meet at the same least upper
> bound."

```
            ⊔ (join of A and B = LUB)
           / \
          A   B        ← two replicas diverged
           \ /
            ⊓           ← their common ancestor / meet
```

---

### Q7: Why does the lattice formulation eliminate the need for ordered or exactly-once delivery? *(Hard)*

**Answer**: Because the **end state is determined by the *set* of updates merged, not the
sequence**. Formally, `merge` is order-independent (commutative + associative) and
duplicate-insensitive (idempotent). So:

- **Reordering** a stream of states doesn't change the final join — the LUB of a set of points is
  independent of the order you take pairwise joins.
- **Duplicating** a state is absorbed by idempotence — joining the same point twice lands you at
  the same place.

Therefore the transport layer can be a lossy, unordered, at-least-once **gossip** channel. As
long as every update *eventually* reaches every replica (a liveness assumption — you do need
that), convergence is guaranteed. You trade away exactly-once/ordered delivery requirements for a
constraint on the *data type's algebra*. That's the fundamental bargain of CRDTs.

---

### Q8: Can two replicas converge to a value that *neither one ever held*? *(Hard)*

**Answer**: **Yes — and that's the whole point of the join.** The join is the *least upper
bound*, which may be strictly greater than both inputs.

Take two replicas of a G-Set:

```
Replica A = {x, y}
Replica B = {x, z}
merge(A, B) = {x, y, z}     ← neither A nor B ever held this exact set
```

Or two replicas of a PN-Counter, or two map CRDTs whose key-sets partially overlap — the merged
state combines information from both and is a *new* lattice point neither side observed in
isolation.

This is a feature, not a bug. It is precisely *because* merge produces the LUB (rather than
picking a winner) that **no update is lost**. Interviewers love this question because the naive
intuition — "merge picks one of the two values" — is wrong for well-designed CRDTs; merge
*combines* them. (LWW-style CRDTs are the exception where merge does pick a winner, which is
exactly why LWW can lose data — see Q15.)

---

### Q9: What's the difference between the *meet* and the *join*, and which one do CRDTs use? *(Medium)*

**Answer**: In lattice terms, the **join (⊔)** is the *least upper bound* and the **meet (⊓)** is
the *greatest lower bound*. CRDTs use the **join** — merging two replicas should produce a state
**at least as informed as both**, i.e., upward in the order, preserving every replica's
information.

Using the meet would *discard* information (move you to the largest state below both, losing
anything not common to both), which is the opposite of what replication wants. So when someone
says "CRDT merge," they mean a **join-semilattice** join. (Some systems are described as
meet-semilattices by flipping the order; the substance is identical — pick the direction where
"merge accumulates information.")

---

## State-based vs Op-based

### Q10: Explain state-based (CvRDT) vs operation-based (CmRDT) CRDTs. *(Medium)*

**Answer**: They are two equivalent ways to achieve the same SEC guarantee; they differ in **what
you ship over the network**.

- **State-based (CvRDT — Convergent):** A replica applies updates locally, then periodically
  ships its **entire state** to peers, which **merge** (join) it in. Correctness rests on `merge`
  being a join (commutative/associative/idempotent). Delivery can be unreliable, unordered, and
  duplicating — the lattice absorbs it.

- **Operation-based (CmRDT — Commutative):** A replica broadcasts the **operation** (e.g.,
  "increment by 3," "add element x"), and each replica applies it. Correctness rests on
  concurrent operations being **commutative** *and* on the delivery layer guaranteeing
  **exactly-once, causal-order delivery** of operations.

| Dimension | State-based (CvRDT) | Op-based (CmRDT) |
|---|---|---|
| What's sent | Full (or delta) state | Individual operations |
| Message size | Large (∝ whole state) unless delta | Small (∝ one op) |
| Delivery needed | Unreliable / unordered / duplicating OK | **Exactly-once + causal order** |
| Dedup needed? | No (idempotent merge) | **Yes** — replaying an op breaks it |
| Required algebra | `merge` is a join | Concurrent ops commute |
| Failure tolerance | Very high (gossip-friendly) | Needs a reliable causal broadcast layer |

The slogan:

> "State-based pushes hard requirements onto the **data type** (give me a join). Op-based pushes
> hard requirements onto the **network** (give me exactly-once causal delivery). Pick based on
> which one you can afford."

---

### Q11: Why isn't an op-based increment idempotent, and what does that imply? *(Medium)*

**Answer**: An op-based operation like `increment(+1)` is **not idempotent** — applying it twice
adds 2, not 1. So if the delivery layer redelivers the op (at-least-once), the counter is wrong.

This is the crux of op-based CRDTs: they **require the messaging layer to guarantee exactly-once
delivery** (or the application must deduplicate operations, e.g., by tagging each op with a unique
ID and tracking seen IDs). They also typically require **causal ordering**, because some ops only
commute *given* their causal predecessors have been applied (e.g., you can't apply "remove x"
before "add x").

Contrast with state-based: the state `merge` is idempotent by construction, so duplicate state
deliveries are harmless and *no* dedup is needed. This is the single biggest practical reason
many systems prefer state-based (often delta-state) CRDTs over op-based ones.

---

### Q12: When would you choose op-based over state-based despite the harder delivery requirements? *(Medium)*

**Answer**: When **state is large and operations are small**, and you already have (or can build)
a reliable causal-broadcast layer. Examples:

- A **collaborative text document** with megabytes of content but single-keystroke edits — you do
  *not* want to ship the whole document on every keystroke. Op-based (or delta-state) is the only
  sane choice.
- A **high-throughput counter** where the state is tiny but you want minimal per-op bandwidth and
  you're already on a message broker (Kafka/NATS/JetStream) that can give you ordered,
  deduplicated delivery.

The decision rule: **message size vs delivery cost.** State-based trades bandwidth/CPU on each
sync for relaxed delivery; op-based trades small messages for a stronger (and more expensive)
delivery contract. **Delta-state CRDTs** (Q18) were invented to give you op-like message sizes
*with* state-like delivery relaxation — they're often the best of both.

---

## CRDTs vs Consensus vs OT

### Q13: When can you NOT use a CRDT? Where do they fundamentally fail? *(Hard)*

**Answer**: CRDTs cannot enforce a **global invariant** that requires all replicas to agree
*before* an operation commits. Any constraint that two concurrent operations could **jointly
violate** — where the violation is only detectable by looking at the global state — is outside
CRDT territory. Classic examples:

- **Uniqueness:** "this username/email must be unique." Two replicas can each accept the same
  username during a partition; the merge can detect the conflict but **cannot un-create** the
  duplicate signups without a coordination policy.
- **Non-negative balance / "never overdraw":** A bank account that must not go below zero. Two
  replicas each see a balance of \$100, each withdraws \$80; the join produces a \$-60 balance.
  The invariant `balance ≥ 0` is a **bounded** constraint that no commutative merge can preserve
  under concurrency.
- **Limited inventory:** "sell at most N tickets." Concurrent sales across replicas can oversell.
- **Strict ordering / linearizable read-your-writes across replicas.**

The boundary, stated crisply:

> "CRDTs give you **convergence**, not **agreement-before-acting**. If correctness requires
> deciding a *single* value or rejecting an operation based on the *global* state at write time,
> you need **consensus** (Paxos/Raft) or a coordinating transaction — a CRDT will happily
> converge to a *consistent but invalid* state."

(Real systems often combine the two: CRDTs for the common path, escalating to consensus or a
reservation/escrow scheme only for the operations that touch a hard invariant.)

---

### Q14: How do CRDTs compare to consensus protocols like Raft/Paxos? *(Medium)*

**Answer**: They sit on **opposite sides of the CAP trade-off** and solve different problems:

| | Consensus (Raft/Paxos) | CRDT |
|---|---|---|
| CAP corner | CP — sacrifices availability under partition | AP — sacrifices linearizability |
| Coordination | Quorum / leader needed per decision | **None** — fully local writes |
| Availability under partition | Minority side **cannot** make progress | **Every** replica keeps accepting writes |
| Guarantee | Single agreed total order (linearizable) | Strong **eventual** consistency (convergence) |
| Latency | Round-trip to quorum | Local (zero coordination) |
| Use it for | Hard invariants, leader election, config | High availability, offline, low-latency writes |

A way to say it:

> "Consensus decides on *one* value by making everyone wait until they agree. A CRDT lets
> everyone act immediately and proves they'll *converge* later. Consensus buys you a linearizable
> invariant at the cost of availability; a CRDT buys you availability at the cost of any invariant
> needing global agreement."

---

### Q15: How do CRDTs compare to Operational Transformation (OT), as used in Google Docs? *(Hard)*

**Answer**: Both target **concurrent editing convergence**, but the mechanism differs:

- **OT** keeps operations and, when applying a remote op against a locally-diverged state,
  **transforms** that op against the operations it didn't know about (e.g., shift an insert's
  index because a concurrent insert happened earlier in the document). Convergence depends on a
  correct **transformation function** satisfying transformation properties (TP1/TP2). Historically
  OT implementations were notoriously hard to get right (TP2 is subtle), and many practical OT
  systems lean on a **central server** to impose an order and simplify the transforms — Google Docs
  uses a server-mediated OT.

- **CRDTs** instead make every element/character carry enough **immutable identity/metadata**
  (unique IDs, position identifiers, causal context) that operations **commute by construction** —
  no transformation function, and **no central server required**. This makes CRDTs a natural fit
  for **peer-to-peer / local-first / offline** collaboration where there is no authoritative
  server to order edits.

Trade-off summary:

| | OT | CRDT |
|---|---|---|
| Needs central server? | Typically yes (to order ops) | No — works P2P |
| Convergence mechanism | Transform ops on apply | Ops commute by design (IDs/metadata) |
| Correctness difficulty | Hard (TP1/TP2) | Shifted into metadata design |
| Cost | Less per-element metadata | **Metadata overhead** (tombstones, IDs) |

The quotable line:

> "OT transforms operations to fit a moving target; CRDTs give each operation a stable identity so
> it never needs transforming. OT favors a coordinating server; CRDTs favor true peer-to-peer —
> at the cost of carrying more metadata."

---

## System Design

### Q16: Design a **collaborative shopping cart** that stays available under partition. Which CRDT(s)? *(Hard)*

**Answer**: This is the Dynamo cart problem. Walk it in steps.

1. **Requirement:** Add/remove items from any region/device, offline-capable, never block the user,
   converge on reconnect — and crucially, **prefer keeping a desired item over silently losing it**.

2. **Naive model — a set of items.** Add = insert, remove = delete. But a *plain* set with union
   merge **cannot represent removals** (see Q22): if one replica removes an item and another still
   has it, union resurrects it.

3. **Right model — an OR-Set (Observed-Remove Set)** per cart, where each add carries a unique tag.
   A remove only cancels the *tags it has observed*, so a concurrent add (new tag) survives. This
   gives intuitive "add wins over a stale remove" semantics. For quantities, model each line item's
   count as a **PN-Counter** (or escrow counter if you must cap stock).

4. **Conflict policy choice:** Dynamo's original cart used a simpler "**add-wins / merge by
   union**" approach precisely because *resurrecting an item the user wanted is far less harmful
   than dropping it* — a deliberate business decision. State this explicitly: **CRDT choice encodes
   a business policy about which way to err.**

5. **Hard-invariant escape hatch:** "Only N in stock" is a global invariant a CRDT can't enforce
   (Q13). Handle oversell at **checkout** with a consensus/transactional reservation, not in the
   cart. Keep the cart AP; make the *purchase* CP.

> Headline: "Cart = OR-Set of line items + per-item PN-Counter; add-wins by policy; push the
> inventory invariant to a transactional checkout."

See [Sets interview](../04-sets-or-set-lww/interview.md) for OR-Set internals.

---

### Q17: Design a **"like" button / view counter** at internet scale. *(Medium)*

**Answer**: High write volume, geo-distributed, must never block the user, exact count is *not*
business-critical (monotonic and roughly-correct is fine).

1. **Likes only go up?** If likes can be undone (unlike), you need increment **and** decrement →
   a **PN-Counter** (two G-Counters, P for increments, N for decrements; value = sum(P) − sum(N)).
   If it's purely additive (views), a **G-Counter** suffices.

2. **Per-replica slots:** Each region/shard owns its own slot and only increments *its own* slot;
   merge is element-wise **max**. This makes increments coordination-free and idempotent at the
   slot level. (Naive shared integer + LWW would lose concurrent increments — Q21.)

3. **Sharding hot keys:** A viral post is a single hot counter. Shard it into K sub-counters
   (each itself a G-Counter), write to a random shard, sum on read. Classic write-fan-out.

4. **Reads:** Eventually-consistent read = sum of locally-known slots; "good enough" instantly.
   A globally-merged total trails slightly — perfectly acceptable for a like count.

5. **Why not Redis `INCR` behind a quorum?** That reintroduces coordination/latency and a CP
   dependency in the hot path; the whole point is that a like must succeed during a partition.

> Headline: "G-/PN-Counter sharded per replica, max-merge, summed on read — coordination-free
> increments that converge. See the [Counters interview](../03-counters-g-pn/interview.md)."

---

### Q18: Design a **presence system** ("who's online now") across many servers. *(Medium)*

**Answer**: Each user's presence is ephemeral, set from any server, must reconcile without a
coordinator, and tolerate churn.

1. **Model:** An **OR-Set** (or LWW-Element-Set) of online user IDs, replicated across presence
   nodes; or per-user an **LWW-Register** of `{status, lastSeen}` keyed by a logical clock.

2. **Why OR-Set / LWW here is acceptable:** Presence is *soft state* — a brief disagreement
   ("shows online for 3 extra seconds") is harmless, so even LWW's data-loss risk (Q15) is fine
   because the data is disposable and continuously refreshed by heartbeats.

3. **Expiry without tombstone bloat:** Use **TTL/heartbeat** semantics — entries self-expire,
   sidestepping the tombstone-GC problem (Q19). The natural churn *is* the garbage collector.

4. **Scale:** Gossip presence deltas between nodes; readers query their local merged view. No
   global lock, no quorum on the heartbeat path.

> Headline: "Presence = OR-Set/LWW-Register of {user, lastSeen} with TTL expiry, gossiped; soft
> state makes LWW's loss risk acceptable and TTL kills the tombstone problem."

---

### Q19: At what point in a design do you escalate *out* of CRDTs? *(Medium)*

**Answer**: The moment a requirement names a **global invariant enforced at write time**:
uniqueness, a non-negative/bounded value, a strict total order, "exactly N," or "reject if it
would violate X *globally*." (See Q13.)

The mature design **splits the system**: keep the high-volume, availability-critical path on
CRDTs; carve out the *small* set of operations that touch a hard invariant and run **those**
through consensus, a single-writer shard, or a reservation/escrow protocol. "AP by default, CP
where the business genuinely requires agreement" is the senior answer — don't make the whole
system CP because one operation needs it.

---

## Gotcha / Trick Questions

### Q20: Is a plain integer with last-write-wins a CRDT? *(Hard)*

**Answer**: It depends entirely on what you mean by "last."

- If "last" is decided by **wall-clock timestamp** and ties are broken **deterministically** (e.g.,
  by replica ID), then **yes** — an **LWW-Register** is a legitimate CRDT. Its merge "take the
  value with the greater (timestamp, replicaID)" is commutative, associative, and idempotent: it's
  a join over the lattice ordered by that timestamp pair.

- If "last" is decided **non-deterministically** — e.g., "whichever write the server happened to
  apply last," with no agreed tiebreaker — then **no**. That merge isn't well-defined; two replicas
  could disagree on which write won, and you've lost commutativity/determinism. That's just plain
  eventual consistency with a race, not a CRDT.

So: **LWW-Register with a total order on timestamps = CRDT. "Last write the database saw" = not a
CRDT.** And note that *even when it is a CRDT*, LWW deliberately **discards** the losing write
(Q21) — convergent, but lossy.

---

### Q21: Why can Last-Writer-Wins lose data, and what's the role of clock skew? *(Hard)*

**Answer**: LWW converges by **keeping one value and discarding the other** — its merge is "pick
the write with the larger timestamp." So if two replicas accept *different, both-valid* concurrent
writes, **one is silently dropped**. Unlike a counter or OR-Set, LWW does not *combine*
information; it *selects*. That's an intentional design choice, fine for fields where one value
must win (a user's display name) but disastrous for additive data (a counter, a cart).

**Clock skew** makes it worse. With wall-clock timestamps:

- A replica with a **fast clock** wins ties it shouldn't — its writes get later timestamps, so it
  systematically **overwrites** the slow-clock replica's writes, even ones that happened *after* in
  real time.
- A grossly skewed clock can let a **stale** write mask a **fresh** one forever ("a write from the
  past wins"), because the timestamp lies about ordering.

Mitigations: use **logical/hybrid logical clocks (HLC)** instead of raw wall time, break ties
deterministically by replica ID, and — most importantly — **don't use LWW for data that must not
be lost**; use a counter or OR-Set whose merge combines rather than selects.

---

### Q22: Does union-of-sets handle removals correctly? *(Hard)*

**Answer**: **No** — and this is the classic CRDT trap. Union (`A ∪ B`) only *grows*. If replica A
removes element `x` (so A = `{}`) while replica B still has `x` (B = `{x}`), then:

```
merge(A, B) = {} ∪ {x} = {x}     ← the removal is undone; x is resurrected
```

Union has no way to express "x was *deliberately* deleted" versus "x was simply never added here."
Removal is fundamentally harder than addition because a delete must be **remembered** so a later
merge doesn't resurrect the element.

Fixes:

- **2P-Set:** a "tombstone" set of removed elements; once removed, an element can never be re-added
  (permanent tombstones, no re-add — often too strict).
- **OR-Set (Observed-Remove Set):** each add gets a unique tag; remove cancels only *observed*
  tags, so a concurrent re-add (new tag) survives. **Add-wins**, intuitive, the usual choice.
- **LWW-Element-Set:** each element carries add/remove timestamps; the later one wins (lossy, like
  any LWW).

The lesson: **adds are easy (union is a join); removes need explicit metadata** — which is exactly
why tombstones and metadata growth (Q23) dominate real CRDT engineering.

---

### Q23: Why are tombstones necessary, and why are they a problem? Talk about GC. *(Hard)*

**Answer**: A **tombstone** is metadata that records "this element/op was removed (or this unique
tag was cancelled)." It's necessary because, as Q22 shows, a replica that *missed* the original
add must still learn that a later remove applies — and a replica that re-adds concurrently must be
able to win. Without persistent removal metadata, merges resurrect deleted data.

The problem: tombstones (and per-element unique tags in OR-Sets, version vectors, etc.) are
**metadata that accumulates and is hard to delete**. You cannot safely garbage-collect a tombstone
until you **know every replica has seen it** — otherwise a lagging replica's stale add could
resurrect the element. So:

- **Metadata growth:** a set that has churned through a million adds/removes can carry far more
  *removal* metadata than live data. This bloats memory, disk, and the bytes shipped on every
  state sync.
- **Safe GC requires coordination:** proving "everyone has seen this tombstone" needs a causal
  stability / version-vector watermark — which is itself a (lightweight) form of coordination,
  somewhat against the CRDT spirit. Practical systems run **periodic causal-stability GC**, use
  TTLs (presence, Q18), or bound history with epochs/compaction.

> Quote: "Removes leave scars (tombstones). You can only erase a scar once you're sure no replica
> is still living in the past — so GC quietly reintroduces a little coordination."

---

### Q24: Is idempotence of `merge` *alone* enough to make something a CRDT? *(Medium)*

**Answer**: **No.** Idempotence is necessary but not sufficient. You need all three —
**idempotent, commutative, and associative** — i.e., `merge` must be a proper **join**. A merge
that's idempotent but not commutative would still diverge under reordering (different replicas
applying updates in different orders reach different states), violating SEC. The full bundle is
what the join-semilattice formulation (Q6) *guarantees together*; cherry-picking one property
doesn't.

---

### Q25: Can a CRDT guarantee that two replicas *always* show the same value at any instant? *(Medium)*

**Answer**: **No — and that's a common misunderstanding.** CRDTs guarantee **convergence once
replicas have seen the same set of updates** (SEC), not **instant agreement**. At any given moment,
two replicas may legitimately differ because updates are still in flight or partitioned. CRDTs
provide *strong eventual* consistency, **not** strong/linearizable consistency. If you need "same
value at the same instant, globally," you need consensus or synchronous replication — and you give
up availability under partition to get it (Q14).

---

### Q26: Two replicas independently increment a counter from 5; one says 6, one says 7. After merge, what's correct — 6, 7, or 8? *(Medium)*

**Answer**: With a **proper PN/G-Counter CRDT**, the answer is **8** — both increments are
preserved because each replica increments **its own slot**, and merge sums the per-replica
contributions (max-merges each slot). Nothing is lost.

With a **naive shared integer under LWW**, the answer would be **6 or 7** — one increment is
**silently lost**, because LWW picks one writer's value and discards the other (Q21). This single
example is the cleanest demonstration of why "use a real counter CRDT, not an LWW integer" matters:
the correct CRDT *combines* (→8); LWW *selects* (→6 or 7, losing data). See the
[Counters interview](../03-counters-g-pn/interview.md).

---

## Rapid-Fire Q&A

> Short, quotable answers — the kind you fire back in 10 seconds.

1. **What does CRDT stand for?** Conflict-free (or Convergent/Commutative) Replicated Data Type.

2. **Which CAP corner?** AP — available under partition, eventually consistent.

3. **What consistency model?** Strong Eventual Consistency (SEC).

4. **The three algebraic properties?** Idempotent, commutative, associative — i.e., a join.

5. **`merge` is the ____ of a ____?** The *join* (LUB) of a *join-semilattice*.

6. **Idempotence buys you?** Tolerance of duplicate / at-least-once delivery.

7. **Commutativity buys you?** Tolerance of out-of-order delivery.

8. **Associativity buys you?** Tolerance of arbitrary batching/regrouping.

9. **CvRDT vs CmRDT?** State-based (ship state, merge) vs op-based (ship operations, apply).

10. **Op-based delivery requirement?** Exactly-once + (usually) causal order.

11. **State-based delivery requirement?** Just eventual delivery — unordered/duplicating is fine.

12. **Simplest CRDT?** G-Counter or G-Set (merge = max / union).

13. **Why is remove hard?** Union only grows; a delete must be remembered or it gets resurrected.

14. **OR-Set semantics?** Add-wins; remove cancels only *observed* unique tags.

15. **LWW's flaw?** It *selects* a winner and discards the loser → silent data loss; clock skew
    worsens it.

16. **Tombstone GC blocker?** Can't delete until *every* replica is known to have seen the removal.

17. **Delta-state CRDT in one line?** State-based correctness with op-sized messages (ship only the
    delta join-irreducible, not the whole state).

18. **When can't you use a CRDT?** When a *global invariant* (uniqueness, balance ≥ 0, "≤ N") must
    hold at write time → use consensus.

19. **CRDT vs OT?** OT transforms ops (often server-mediated); CRDTs give ops stable identities so
    they commute (P2P-friendly).

20. **Can replicas converge to a value neither held?** Yes — the join is the LUB and may exceed
    both inputs.

---

### Q27: What are delta-state CRDTs and why were they invented? *(Hard)*

**Answer**: A **delta-state CRDT (δ-CRDT)** is a state-based CRDT that, instead of shipping the
**entire** state on every sync, ships only a small **delta** — a join-irreducible fragment
representing *just the recent change* — which the receiver **joins** into its state exactly as it
would a full state.

The motivation: classic state-based CRDTs are robust (no delivery requirements, idempotent merge)
but **bandwidth-hungry** — shipping a whole large set/counter map on each gossip round is wasteful
when one element changed. Op-based CRDTs are small but demand **exactly-once causal delivery**.
Delta-state CRDTs give you the **best of both**:

- **Op-sized messages** (you send the delta, not the whole state), and
- **State-based delivery relaxation** — deltas still merge via the join, so they remain
  idempotent, commutative, associative; lost/duplicated/reordered deltas are safe, and a replica
  that falls too far behind can always fall back to a **full-state** anti-entropy sync.

This is why most modern production CRDT libraries (e.g., Automerge/Yjs-style sync, Akka
Distributed Data, Redis Active-Active) use delta-state propagation rather than naive full-state
shipping. It's the pragmatic default.

---

### Q28: How do you test a CRDT implementation? *(Medium)*

**Answer**: **Property-based testing against the algebra.** Generate random sequences of
operations across simulated replicas, then assert the laws directly:

- **Idempotence:** `merge(s, s) == s`.
- **Commutativity:** `merge(a, b) == merge(b, a)`.
- **Associativity:** `merge(merge(a, b), c) == merge(a, merge(b, c))`.
- **Convergence:** apply the *same set* of updates in **random orders / random batchings / with
  duplicates and drops (then redelivered)** to several replica copies, then assert **all replicas
  end in the identical state**.
- **Monotonicity:** every update yields `s ≤ update(s)` in the lattice order.

Tools like QuickCheck/Hypothesis/`fast-check` shine here because the correctness conditions are
*mathematical laws*, not example outputs. (See the `property-based-testing` discipline.) Add
**model-based** tests comparing the CRDT to a simple sequential reference, and **fault-injection**
of reordering/duplication/partition in the transport.

---

## Common Mistakes

- **Conflating SEC with strong/linearizable consistency.** CRDTs give *eventual* convergence, not
  instant global agreement. Never promise read-your-writes across replicas without extra machinery.
- **Using LWW for additive data.** LWW *selects a winner and drops the loser* — fine for a name,
  catastrophic for a counter or cart. Reach for a counter/OR-Set whose merge *combines*.
- **Assuming union handles removal.** Plain set union resurrects deleted elements. Removal needs
  tombstones or observed-remove tags.
- **Forgetting tombstone GC.** Metadata grows unbounded; you cannot safely GC a tombstone until
  every replica has seen the removal. Design causal-stability GC or TTLs up front.
- **Treating op-based delivery as free.** Op-based CRDTs *require* exactly-once causal delivery (or
  app-level dedup). Skipping this silently corrupts state (double-applied increments).
- **Forcing a hard invariant onto a CRDT.** Uniqueness, "balance ≥ 0," and "≤ N in stock" need
  consensus or escrow — a CRDT converges to a *consistent-but-invalid* state. Split AP/CP.
- **Picking only one algebraic property.** "merge is idempotent so it's a CRDT" is wrong — you need
  idempotent *and* commutative *and* associative (a join).
- **Shipping full state when state is large.** Use **delta-state** CRDTs; full-state gossip melts
  your network for big documents/sets.
- **Wall-clock LWW without HLC or a deterministic tiebreaker.** Clock skew silently inverts
  ordering and lets stale writes win.
- **Ignoring the business policy embedded in the merge.** "Add-wins" vs "remove-wins" vs
  "max-wins" is a *product decision* — choose deliberately, not by accident of which CRDT you grabbed.

---

## Tips & Summary

**The 60-second mental model to carry into any interview:**

1. **Problem:** Stay available under partition (AP) and still converge with **no coordination, no
   lost updates, no manual conflict resolution**.
2. **Guarantee:** **Strong Eventual Consistency** — same set of updates ⇒ same state, regardless of
   order, batching, or duplicates.
3. **Mechanism:** Model state as a **join-semilattice**; updates move **up**; `merge` is the
   **join (LUB)**. Joins are automatically **idempotent + commutative + associative**, which is
   exactly what absorbs duplicate / reordered / batched delivery.
4. **Two flavors:** **State-based** (ship state, merge — relaxed delivery, bigger messages) vs
   **op-based** (ship ops, apply — small messages, needs exactly-once causal delivery). **Delta-state**
   is the pragmatic hybrid.
5. **Limits:** No **global invariant at write time** (uniqueness, bounded balance, "≤ N") — that's
   **consensus** territory. CRDTs converge but can't *agree before acting*. Vs **OT**: CRDTs give
   ops stable identities (P2P-friendly) instead of transforming them (server-mediated).
6. **The hard parts in practice:** **removal** (tombstones / observed-remove tags) and **metadata
   GC** (can't collect until all replicas have seen the remove). **LWW** is convergent but *lossy* —
   it selects rather than combines, and clock skew makes it worse.

**The single sentence to leave them with:**

> "A CRDT trades a hard requirement on the **network** (ordered, exactly-once, coordinated delivery)
> for a hard requirement on the **data type** (its merge must be a join) — and in exchange you get
> coordination-free, conflict-free convergence: availability without consensus."

---

**Keep going:** [junior](junior.md) · [senior](senior.md) · [professional](professional.md) ·
[Counters interview](../03-counters-g-pn/interview.md) · [Sets interview](../04-sets-or-set-lww/interview.md)
