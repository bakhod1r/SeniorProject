# Distributed Counters: G-Counter, PN-Counter & Bounded Counters — Senior Level

> You already know the lattice, the join, and the convergence proofs. This tier is about the problems those proofs *do not* solve: enforcing global invariants like `balance ≥ 0`, taming actor-id explosion under ephemeral replicas, garbage-collecting dead slots safely, and shipping deltas instead of whole states. The recurring theme: **a pure CRDT counter buys you convergence, never a numeric invariant.** Everything interesting in this document is about clawing the invariant back with the *least* coordination possible.

---

## Table of Contents

1. [Recap: G/PN as Product Lattices](#1-recap-gpn-as-product-lattices)
2. [The Invariant Problem: Why PN-Counters Go Negative](#2-the-invariant-problem-why-pn-counters-go-negative)
3. [Bounded / Non-Negative Counters via Escrow (Balegas 2015)](#3-bounded--non-negative-counters-via-escrow-balegas-2015)
4. [Handoff Counters: Taming Actor-ID Explosion](#4-handoff-counters-taming-actor-id-explosion)
5. [Delta-State Counters](#5-delta-state-counters)
6. [Garbage Collection, Causal Stability & the Safety Condition](#6-garbage-collection-causal-stability--the-safety-condition)
7. [Op-Based Counters and Deduplication](#7-op-based-counters-and-deduplication)
8. [Comparison Table](#8-comparison-table)
9. [Code: Escrow Counter & Delta-State PN-Counter](#9-code-escrow-counter--delta-state-pn-counter)
10. [Pitfalls](#10-pitfalls)
11. [Cheat Sheet](#11-cheat-sheet)
12. [Summary](#12-summary)
13. [Further Reading](#13-further-reading)

---

## 1. Recap: G/PN as Product Lattices

You know this; we restate it precisely so the rest of the document can lean on the algebra.

A **G-Counter** (grow-only) over a set of replica identifiers `I` is a map `P : I → ℕ`. Replica `i` increments only its own entry `P[i]`. The value is the sum:

```
value(P) = Σ_{i ∈ I} P[i]
```

The state space is the **product lattice** `ℕ^|I|` ordered component-wise:

```
P ⊑ Q   ⟺   ∀ i. P[i] ≤ Q[i]
```

The **join** (least upper bound) is the component-wise maximum:

```
(P ⊔ Q)[i] = max(P[i], Q[i])
```

This is a join-semilattice: `⊔` is commutative, associative, and idempotent. Those three properties are *exactly* what make the merge tolerant of out-of-order, duplicated, and re-delivered messages. Convergence — the **Strong Eventual Consistency (SEC)** guarantee — falls out: any two replicas that have received the same *set* of updates (in any order, any multiplicity) compute the same state.

A **PN-Counter** is the product of two G-Counters, `(P, N)`:

```
value(P, N) = Σ_i P[i] − Σ_i N[i]
```

with the join applied independently to each component:

```
(P, N) ⊔ (P', N') = (P ⊔ P', N ⊔ N')
```

The product of two semilattices is a semilattice, so the PN-Counter inherits SEC for free. Decrement on replica `i` bumps `N[i]`; increment bumps `P[i]`. Because `P` and `N` are both grow-only, **nothing is ever subtracted from the structure** — a decrement is an *addition to the negative side*. That asymmetry (you only ever grow) is the price of monotone convergence, and as we'll see in §2, it is also the source of the invariant problem.

Mental model to carry forward:

```
PN-Counter state on 3 replicas (a, b, c)
┌─────────┬─────┬─────┬─────┐
│         │  a  │  b  │  c  │
├─────────┼─────┼─────┼─────┤
│  P      │  5  │  2  │  0  │   Σ P = 7
│  N      │  1  │  4  │  0  │   Σ N = 5
└─────────┴─────┴─────┴─────┘
value = 7 − 5 = 2
```

Two facts we will exploit relentlessly:

1. **`value` is unbounded below.** Because `N` grows independently of `P`, the algebra places no floor on the difference `ΣP − ΣN`. The lattice has *no notion* of "≥ 0."
2. **Merge never coordinates.** `max` is local. No replica ever needs to ask another's permission to merge. This is the strength and the weakness.

---

## 2. The Invariant Problem: Why PN-Counters Go Negative

The single most important sentence in this entire topic:

> **A CRDT guarantees that replicas *converge*. It guarantees nothing about *what they converge to* relative to a global numeric predicate.**

SEC says all replicas reach the same value. It does **not** say that value is non-negative, ≤ some cap, or anything else about its magnitude. Invariants of the form `value ≥ 0` are **non-local**: whether a decrement is *safe* depends on the decrements happening *concurrently elsewhere*, which a replica — by the very definition of an AP (available-under-partition) system — cannot observe.

### 2.1 A concrete divergence-into-negative scenario

Take a PN-Counter modelling a stock of **10 concert tickets**. Two replicas `A` and `B`, both starting from the converged state `value = 10`, get partitioned from each other.

```
Initial converged state (value = 10)
P = {A:10, B:0}   N = {A:0, B:0}   →   10 − 0 = 10
```

Now the partition. Each replica independently sells tickets by issuing decrements. Each *local* decrement looks perfectly valid — every replica sees `value ≥ 0` at the moment it acts.

```
─ Partition begins ─

Replica A sells 6 tickets:           Replica B sells 7 tickets:
  N[A] : 0 → 6                          N[B] : 0 → 7
  local value = 10 − 6 = 4  ✓ ≥ 0       local value = 10 − 7 = 3  ✓ ≥ 0
```

Both replicas believed they were safe. Both *were* safe with respect to *their own* observed state. Now the partition heals and they merge:

```
─ Partition heals, merge ─

P = {A:10, B:0}         (max of each: unchanged)
N = {A:6,  B:7}         (max of each: A keeps 6, B keeps 7)

value = ΣP − ΣN = 10 − (6 + 7) = 10 − 13 = −3
```

The counter has converged — both replicas agree the value is `−3` — and that converged value is **nonsense**: we sold 13 of 10 tickets, oversold by 3. The CRDT did its job perfectly (SEC holds: both replicas show `−3`) and the business is wrong.

The structural reason: **the merge took `max(N[A], N[B])` componentwise, which is `max(6, 7)`... no — it took `6` and `7` and summed them.** The two `N` entries are on *different replica slots*, so they don't conflict; the join keeps both, and the global sum reflects both decrement streams *additively*. There is no point in the lattice where the two concurrent spends "fight" — they simply both win.

### 2.2 Why no CRDT trick rescues a *plain* counter

You might reach for these — none work:

- **"Clamp on merge to `max(value, 0)`."** Clamping is *not* a join. `max(value, 0)` is not associative/idempotent with the underlying merge; it breaks SEC. Two replicas applying clamp at different times will diverge. (Clamping is a read-time *projection*, fine for display, but it doesn't make the underlying decrements legal — you've just hidden the oversell.)
- **"Validate the invariant before decrementing."** Each replica *did* validate locally and *still* oversold, because validity is non-local. Local validation under partition is structurally insufficient.
- **"Add a max-cap field."** A cap bounds magnitude but doesn't enforce a *budget* across replicas; concurrent spends still over-consume the shared budget.

The CAP-theoretic statement: enforcing a global invariant like `value ≥ 0` requires that **the act of decrementing be coordinated whenever the local state cannot prove safety alone.** A pure CRDT, by construction, never coordinates. Therefore a pure CRDT cannot enforce `value ≥ 0`.

The escape hatch is not to abandon availability entirely, but to **pre-coordinate**: hand each replica a *budget* (a reservation) it may spend without asking. Coordination is moved off the critical path of the common case and only re-appears when budgets must be rebalanced. That is the escrow / bounded-counter idea, and it is the heart of this tier.

---

## 3. Bounded / Non-Negative Counters via Escrow (Balegas 2015)

The **Bounded Counter** comes from Balegas, Duarte, Ferreira, Rodrigues, Preguiça, Najafzadeh, and Shapiro, *"Extending Eventual Consistency for Enforcing Invariants"* (Indigo / Bounded Counter, EuroSys / DSN 2015). It is built on a classic database technique: the **escrow transaction** (O'Neil, 1986).

### 3.1 The core idea: partition the budget, not the operations

The invariant we want is `value ≥ 0`, equivalently: the *total amount decremented* may never exceed the *total amount incremented*. Define the global slack as `value` itself — the headroom before we'd violate the floor.

The escrow trick: **split that slack into per-replica reservations (escrows).** Each replica `i` holds a local quota `R[i]`. The system maintains the invariant:

```
Σ_i R[i]  ≤  value          (total reserved ≤ total available)
```

Now the rule is purely local and requires **zero coordination** in the common case:

> Replica `i` may decrement by `d` **iff** `d ≤ R[i]`. On success it reduces its own reservation: `R[i] −= d`.

Because reservations are disjoint and their sum never exceeds the real value, **no combination of concurrent local spends can drive the global value below zero.** Each replica spends only from *its own* slice of the budget; two replicas physically cannot spend the same unit because that unit lives in exactly one replica's escrow.

This is the same insight as §2's failure, inverted: in §2 both replicas spent from a *shared, unpartitioned* budget; here the budget is *partitioned in advance*, so concurrency is harmless.

### 3.2 The two-tier structure

A bounded counter is, internally, **two CRDTs glued by an invariant-preserving local rule**:

1. A regular **PN-Counter** (or a pair of grow-only counters) tracking total increments and decrements — this gives the underlying convergent `value`.
2. A **reservation ledger** `R : I → ℕ⁺`, the per-replica escrows, plus a record of **transfers** of reservation between replicas.

Increments are easy: an increment of `k` increases the global value by `k`, and the incrementing replica may add `k` to its *own* reservation immediately (it created new slack, it owns it). No coordination.

Decrements consume the local reservation. The only operation that needs coordination is **transferring reservation from one replica to another** — moving slack across the partition boundary. That transfer must be a *conservative* two-party agreement: replica `i` gives up `t` units (`R[i] −= t`) and replica `j` receives them (`R[j] += t`), and the two halves must be atomic with respect to the invariant `ΣR ≤ value`. A transfer never *creates* slack, so it can never violate the floor; it only redistributes who may spend it.

```
Escrow invariant, visualised
                    value = 10
   ┌──────────────────────────────────────────┐
   │  R[A]=4    R[B]=4    R[C]=2     (ΣR = 10)  │  ← fully reserved
   └──────────────────────────────────────────┘
A may spend ≤ 4 with NO coordination.
B may spend ≤ 4 with NO coordination.
C may spend ≤ 2 with NO coordination.
A wanting to spend 6 must first acquire ≥2 more via TRANSFER from B or C.
```

### 3.3 Worked example: the ticket stock, done right

Back to the 10 tickets. Suppose we provision reservations `R = {A:4, B:4, C:2}`. Note `ΣR = 10 = value`. Partition the three replicas completely.

```
─ Partition ─
A sells 4:  4 ≤ R[A]=4  ✓   R[A] → 0   (A now blocked, must transfer-in to sell more)
B sells 3:  3 ≤ R[B]=4  ✓   R[B] → 1
C sells 2:  2 ≤ R[C]=2  ✓   R[C] → 0
A tries to sell 1 more: 1 ≤ R[A]=0 ?  ✗  → DENIED locally (no coordination available)
```

Total sold across the partition: `4 + 3 + 2 = 9 ≤ 10`. **No oversell, and A's extra request was correctly refused** — refusing-when-uncertain is exactly the availability cost we pay to keep the invariant. Compare to §2 where *every* request was accepted and we oversold by 3.

When the partition heals:

```
─ Heal ─
Underlying PN-Counter merges: total decremented = 9, value = 10 − 9 = 1.
Reservations after spends:  R = {A:0, B:1, C:0}   (ΣR = 1 ≤ value = 1)  ✓
The one remaining unit can be sold by whoever holds R[B]=1, or transferred.
```

The invariant held *throughout* the partition and *after* the merge, with coordination required **only** if a starved replica wanted to pull slack from a richer one. Under most workloads (provision reservations proportional to expected demand), the slow transfer path is rarely hit — and when a replica's reservation hits zero it can either deny, queue, or fall back to synchronous coordination, a *policy* choice the application makes.

### 3.4 Generalisation and the upper-bound case

- **Lower bound `value ≥ L`:** reserve against `value − L`. The escrow is the headroom above the floor.
- **Upper bound `value ≤ U`** (e.g. "no more than U participants"): reserve against `U − value` and treat *increments* as the constrained operation. By symmetry, increments now consume escrow and decrements freely return it.
- **Both bounds:** maintain two reservation ledgers, one per bound. The famous Indigo paper frames these as general *numeric invariants* over CRDTs with an analysis pass that decides which operations need escrow.

The reservation itself is **not** a free CRDT object — transfers are the coordinated part. But coordination is now (a) *rare*, (b) *pairwise* (or small-group), and (c) *off the latency-critical path* of normal reads/writes. That is the entire value proposition: **trade a tiny amount of background coordination for a strong invariant under an otherwise-available, partition-tolerant counter.**

---

## 4. Handoff Counters: Taming Actor-ID Explosion

### 4.1 The problem: unbounded actor-id growth

Every G-Counter entry is keyed by a **replica/actor id**. The state size is `O(|I|)` where `I` is the set of *all ids that ever incremented*. In a datacenter with a fixed, small set of long-lived servers, `|I|` is bounded and small. The pathology appears with **ephemeral replicas**:

- Mobile clients that increment a like-counter then vanish forever.
- Serverless function instances, each a fresh id.
- Browser tabs, IoT devices, short-lived workers.

Each ephemeral actor that ever touches the counter must **mint a new slot** (it cannot reuse another actor's slot without violating the grow-only-per-slot discipline that makes merge safe). Slots are never removed naively — removing a slot looks like a *decrement* to the lattice and breaks idempotent merge. Result: the map `P : I → ℕ` grows **without bound**, even though the *value* might be tiny. A counter with value 50 could carry 50,000 dead slots.

```
G-Counter on a mobile app's "likes"
P = { phone-9f3a:1, phone-77c2:1, phone-ae01:1, ... 50,000 entries ... }
value = 50,000   but the metadata is 50,000 entries that will NEVER change again.
```

You cannot just delete `phone-9f3a:1`: a delayed merge from a peer still carrying that entry would *re-introduce* it (join keeps the max, `max(0, 1) = 1`), undoing the deletion and double-counting on the way back. Slot removal needs a **safety condition** (see §6). Handoff counters are a *structural* answer that avoids the per-ephemeral-slot accumulation in the first place.

### 4.2 The mechanism (Almeida & Baquero, "Scalable Eventually Consistent Counters over Unreliable Networks")

**Handoff Counters** (Paulo Sérgio Almeida & Carlos Baquero, 2019) introduce a **tier hierarchy**. The key idea: ephemeral replicas do *not* contribute their own permanent slot to the global state. Instead, their counts are **handed off** — transferred and merged — into a stable upper tier, and the ephemeral slot is then **retired**. Concretely:

- Replicas are organised in **tiers** `0, 1, 2, …`. Tier 0 = the most ephemeral (clients); higher tiers = more stable (servers, aggregators).
- A replica accumulates increments locally. Rather than every replica keeping a permanent global slot, an ephemeral replica performs a **handoff** to a higher-tier replica: it transfers its accumulated count *into* the higher tier's counter and then **discards its own slot**.
- The protocol uses **slots and tokens** to make the handoff *exactly-once* despite message loss, duplication, and reordering — the hard part. A naive "send my count and forget" loses the count if the message is dropped, or double-counts if it's duplicated. Handoff counters solve this with a small per-pair state machine:
  - The destination issues a **slot** (a unique token, identified by a `(source, source-clock)` pair) acknowledging *intent* to receive a handoff.
  - The source, upon seeing its slot acknowledged, marks the value as *handed off* and stops counting it locally; it records that the handoff for that slot is *committed*.
  - Duplicate handoff messages are recognised by the slot identity and **ignored** (dedup), giving exactly-once accumulation.
  - Once the source confirms the destination absorbed the value, the source's transient contribution can be **dropped from global state** — its slot does not persist.

The net effect: **transient replicas never leave a permanent footprint.** Their counts flow *upward* and merge into a small, stable set of higher-tier slots. Global state size becomes `O(number of stable replicas)`, not `O(number of ephemeral replicas ever seen)`. Crucially, the handoff is done with **local pairwise coordination** that is still convergent and loss-tolerant — it does not require global consensus.

```
Handoff: 3 phones → 1 server
Tier 0:  phone-A (count 5) ─┐
         phone-B (count 3) ─┼──handoff──▶  Tier 1: server-X
         phone-C (count 2) ─┘             absorbs 5+3+2 = 10 into ITS slot,
                                          then phones' slots are retired.
Global state ends up: { server-X : 10 }   ← O(1), not O(3 phones)
```

Why slots/tokens instead of a plain merge: a plain G-Counter merge between phone and server would leave the phone's slot *in the server's state forever* (it keeps the max). Handoff explicitly *moves* the value and *invalidates* the source slot using the token machinery, so the source contribution is absorbed exactly once and then garbage-collectable.

Think of it as **CRDT counters with a retirement protocol**: ordinary counters grow slots monotonically; handoff counters add a safe, loss-tolerant way to *collapse* an ephemeral slot into a durable one without breaking SEC.

---

## 5. Delta-State Counters

### 5.1 The shipping-cost problem

State-based (CvRDT) replication, naively, ships the **entire state** on every anti-entropy round. For a counter with thousands of slots, gossiping the whole map after a single increment is absurdly wasteful — you change one entry and transmit `O(|I|)`.

**Delta-state CRDTs** (Almeida, Shoker & Baquero, *"Delta State Replicated Data Types"*, 2018) fix this: each local mutation produces a small **delta** `δ` — itself a join-semilattice element representing *just the change* — and you ship only the deltas, not the full state. The merge is still `⊔`, so all the SEC machinery is preserved; deltas are simply *partial states* that join into the same lattice.

### 5.2 Mechanics for a counter

For a G-Counter, incrementing `P[i]` from `5` to `6` produces the delta state `{i : 6}` — a one-entry map. Joining `{i:6}` into a peer's state does `max(peer[i], 6)`, exactly the same as a full-state merge but with one entry on the wire instead of `|I|`.

```
Full-state gossip (wasteful):           Delta gossip (lean):
  send {A:6, B:2, C:0, D:9, ...}          send {A:6}
  every round                             only the changed slot
```

The subtlety — and what separates a *delta-state* CRDT from a *naive* op-based one — is **anti-entropy with delta groups**:

- A replica buffers the deltas it generates *and* the deltas it receives that advance its state, accumulating them into a **delta-group** (the join of a batch of deltas).
- It tracks, per peer, an **acknowledgment sequence**: which delta-intervals each neighbour has acknowledged.
- It ships the *unacknowledged* delta-group; on ack it discards that interval from its buffer.
- **Causal consistency caveat:** for counters specifically (which are *not* causally constrained the way an add-wins set is), delta merge is safe in any order because join is still idempotent/commutative/associative. But the delta-buffer GC depends on acknowledgments — you cannot drop a buffered delta until *every* peer that needs it has confirmed receipt (or you fall back to a periodic full-state merge to repair anyone who missed deltas). The standard design keeps an occasional full-state anti-entropy as a backstop so a replica that fell too far behind (or whose deltas were GC'd) can still catch up.

The payoff: bandwidth proportional to *change rate*, not *state size*. For a high-cardinality counter this is the difference between a viable and a non-viable design. We implement a delta-state PN-Counter in §9.

---

## 6. Garbage Collection, Causal Stability & the Safety Condition

### 6.1 Why GC is hard

A slot `P[i]` can only be removed if removing it is **indistinguishable from keeping it** at every replica, *forever*. The danger: a slow or partitioned replica still holds the old slot and, on a future merge, **re-injects** it. Because join keeps the max, `max(absent≡0, oldvalue) = oldvalue` — the deleted slot springs back to life and the value double-counts.

So the question "can I drop slot `i`?" reduces to: **"is it impossible for any replica, now or in the future, to send me an update that mentions slot `i`?"**

### 6.2 Causal stability — the safety condition

The formal tool is **causal stability**. Informally:

> An update (or, here, a slot's contribution) is **causally stable** at a replica once it is known that **every** replica in the membership has *already observed it*, and therefore no future message can carry an *earlier* or *concurrent* version of it.

Operationally, a slot `i` is safe to retire (or compact / remove) when **all** of these hold:

1. **The slot's owner is permanently retired** — replica `i` will never increment again (e.g., it formally left the membership, or it was an ephemeral handoff source whose value was absorbed in §4).
2. **Its final value has been observed by every current replica.** Concretely, every replica's known state has `P[i] ≥ finalvalue_i`. This is the "everyone has seen it" condition.
3. **No in-flight message can re-introduce an older view.** Guaranteed once (2) holds *and* membership is known to be stable (no straggler can resurface carrying `i` with a value the others lack).

When all three hold, the slot's contribution is **frozen and uniformly known**; you can fold it into a compacted constant and drop the per-replica entry. Removing it is now *invisible* to convergence because every replica would compute the same join with or without the explicit slot.

```
Safety condition for retiring slot i (value 7):
  every replica's state shows P[i] ≥ 7   AND   i will never increment again
  ───────────────────────────────────────────────────────────────────────
  ⟹ fold 7 into a base constant, delete the per-replica entry for i.
     Any straggler merge that still carries {i:7} now joins to the same
     value (it's already accounted for), so deletion is observationally safe.
```

### 6.3 Membership and the practical machinery

Establishing "every replica has seen it" requires a **membership view** and an **acknowledgment / version-vector exchange** — exactly what handoff counters (§4) and delta-acks (§5) provide. In practice GC piggybacks on anti-entropy: replicas exchange version vectors (or per-slot low-watermarks), compute the *minimum* across the membership (the **causal stability frontier** / low-watermark), and retire everything below it. The minimum-across-all-replicas is the linchpin: a slot is stable only up to the *least*-advanced replica's knowledge. A single permanently-unreachable replica blocks GC forever — which is why membership management (eviction of dead nodes) is part of any production CRDT counter, not an afterthought.

---

## 7. Op-Based Counters and Deduplication

State-based counters merge with `⊔` and tolerate duplicates *for free* (idempotency). **Operation-based (CmRDT)** counters instead broadcast operations — `increment(d)`, `decrement(d)` — and apply them at each replica. This buys tiny messages (`+1`) but moves the burden onto the **delivery layer**.

The critical fact: a counter increment is **not idempotent as an operation.** Applying `increment(1)` twice adds 2. So an op-based counter is correct **only** if the broadcast layer guarantees **exactly-once, causal (or at least reliable, dedup'd) delivery**:

- **At-least-once delivery + no dedup ⟹ over-count.** A retransmitted `increment` is applied twice.
- **Reliable causal broadcast (RCB)** is the classic requirement in Shapiro et al. (2011): operations are delivered to every replica exactly once, respecting causal order.

Since the network gives at-least-once at best, op-based counters need **explicit deduplication**: tag each operation with a unique `(replica-id, sequence-number)`, and have each replica track a per-source **delivered-set** (or a contiguous low-watermark + sparse set of out-of-order ids). An operation is applied **iff** its id has not been seen.

```
Op dedup with per-source watermark:
  source A has delivered ops with seq ≤ 41 contiguously, plus {43, 44}.
  Incoming op (A, 42):  fills the gap → apply, watermark advances to 44.
  Incoming op (A, 43):  already in delivered set → DROP (duplicate).
```

The dedup metadata is itself a GC problem (you can compact the delivered-set up to the contiguous watermark, but out-of-order ids must be retained until the gaps fill). This is why many production systems prefer **state-based or delta-state** counters: dedup-for-free is worth a lot. Op-based shines when messages are small and you already run an RCB layer (e.g., on top of a reliable group-communication / consensus log).

---

## 8. Comparison Table

| Property | G-Counter | PN-Counter | Bounded (Escrow) Counter | Handoff Counter |
|---|---|---|---|---|
| **Operations** | increment only | increment + decrement | inc + dec, invariant-checked | increment (+ handoff) |
| **Enforces `value ≥ 0` / cap** | N/A (only grows) | ❌ no — can go negative | ✅ yes (per-replica reservation) | N/A (grow-only) |
| **Metadata size** | `O(replicas seen)` | `O(replicas seen)` (×2) | `O(replicas)` + reservation ledger | `O(stable replicas)` — *not* per-ephemeral |
| **Coordination in common case** | none | none | none (spend from local escrow) | local pairwise handoff (token exchange) |
| **Coordination needed** | never | never | only for **reservation transfers** | only the **handoff** (loss-tolerant, no consensus) |
| **Handles ephemeral replicas** | ❌ slot explosion | ❌ slot explosion | inherits underlying counter's | ✅ designed for it |
| **Convergence (SEC)** | ✅ | ✅ | ✅ (underlying) + invariant by construction | ✅ |
| **Duplicate-tolerant merge** | ✅ (idempotent join) | ✅ | ✅ | ✅ (slot/token dedup) |
| **Primary cite** | Shapiro 2011 | Shapiro 2011 | Balegas 2015 | Almeida & Baquero 2019 |
| **When to reach for it** | monotone metrics (views, hits) | balances that may rise/fall, no floor | stock, quotas, balances with a floor/cap | mobile / serverless / massive ephemeral fan-in |

Read the table as a decision ladder: *only grows?* → G. *Goes up and down, no invariant?* → PN. *Needs a floor or cap?* → escrow/bounded. *Drowning in dead actor slots?* → handoff. Delta-state (§5) is an orthogonal *transport* optimisation applicable to any of them.

---

## 9. Code: Escrow Counter & Delta-State PN-Counter

Two complete, runnable implementations. Both simulate a partition, show the invariant holding (escrow) and convergence under delta merge (PN).

### 9.1 Python — Bounded (Escrow) Counter with reservation transfer

```python
"""
Bounded (escrow) counter enforcing value >= 0 with NO coordination on the
common-case decrement. Coordination is needed ONLY to transfer reservation
between replicas. Demonstrates that concurrent partitioned spends cannot
oversell, unlike a plain PN-counter.
"""
from dataclasses import dataclass, field
from typing import Dict


@dataclass
class GCounter:
    """Grow-only counter: id -> count."""
    counts: Dict[str, int] = field(default_factory=dict)

    def inc(self, rid: str, d: int = 1) -> None:
        assert d >= 0
        self.counts[rid] = self.counts.get(rid, 0) + d

    def value(self) -> int:
        return sum(self.counts.values())

    def merge(self, other: "GCounter") -> None:
        for k, v in other.counts.items():
            self.counts[k] = max(self.counts.get(k, 0), v)


class BoundedCounter:
    """
    Non-negative counter (value >= 0) built from a PN-counter plus per-replica
    reservations. value() = inc.value() - dec.value(). Each replica may decrement
    only up to its local reservation R[self_id], guaranteeing the floor holds
    even under partition and concurrent spends.
    """
    def __init__(self, self_id: str, reservation: int):
        self.self_id = self_id
        self.inc = GCounter()      # total increments (convergent)
        self.dec = GCounter()      # total decrements (convergent)
        self.R: Dict[str, int] = {self_id: reservation}  # per-replica escrow

    # ----- value -----
    def value(self) -> int:
        return self.inc.value() - self.dec.value()

    def my_reservation(self) -> int:
        return self.R.get(self.self_id, 0)

    # ----- increment: creates slack, owner claims it, no coordination -----
    def increment(self, d: int = 1) -> None:
        self.inc.inc(self.self_id, d)
        self.R[self.self_id] = self.R.get(self.self_id, 0) + d

    # ----- decrement: spends LOCAL reservation only, no coordination -----
    def try_decrement(self, d: int = 1) -> bool:
        if d > self.my_reservation():
            return False  # refuse rather than risk violating value >= 0
        self.dec.inc(self.self_id, d)
        self.R[self.self_id] -= d
        return True

    # ----- reservation transfer: the ONLY coordinated op (pairwise) -----
    def transfer_out(self, amount: int) -> int:
        """Withdraw `amount` of reservation to hand to a peer. Conservative:
        never creates slack, so the floor invariant is preserved."""
        give = min(amount, self.my_reservation())
        self.R[self.self_id] -= give
        return give  # caller delivers this to the peer's transfer_in

    def transfer_in(self, amount: int) -> None:
        self.R[self.self_id] = self.R.get(self.self_id, 0) + amount

    # ----- convergence of the underlying counter -----
    def merge(self, other: "BoundedCounter") -> None:
        self.inc.merge(other.inc)
        self.dec.merge(other.dec)
        # Reservations: keep our own authoritative entry, learn others' for
        # display; spending decisions only ever use OUR own entry.
        for k, v in other.R.items():
            if k != self.self_id:
                self.R[k] = v


def demo_escrow():
    print("=== Escrow counter: 10 tickets, reservations A:4 B:4 C:2 ===")
    A = BoundedCounter("A", 4)
    B = BoundedCounter("B", 4)
    C = BoundedCounter("C", 2)
    # Seed total supply of 10 as increments on A (already reserved per replica).
    # We model the supply directly via reservations summing to value=10:
    A.inc.counts["supply"] = 10  # pretend a one-time stock load of 10
    for r in (B, C):
        r.inc.counts["supply"] = 10  # everyone agrees on the supply slot

    # Partition: each replica spends from its OWN reservation only.
    print("A sells 4:", A.try_decrement(4), " R[A]=", A.my_reservation())
    print("B sells 3:", B.try_decrement(3), " R[B]=", B.my_reservation())
    print("C sells 2:", C.try_decrement(2), " R[C]=", C.my_reservation())
    print("A tries 1 more:", A.try_decrement(1), "(denied: out of reservation)")

    # Heal + merge all three.
    A.merge(B); A.merge(C)
    B.merge(A); C.merge(A)
    print("converged value =", A.value(), "(must be >= 0)")
    assert A.value() >= 0, "INVARIANT VIOLATED"
    assert A.value() == B.value() == C.value(), "DID NOT CONVERGE"

    # Now show a transfer letting A sell again.
    given = B.transfer_out(1)        # B hands 1 unit of reservation to A
    A.transfer_in(given)
    print(f"\nB transferred {given} reservation to A; R[A]=", A.my_reservation())
    print("A sells 1:", A.try_decrement(1), " value=", A.value())
    A.merge(B); A.merge(C); B.merge(A); C.merge(A)
    assert A.value() >= 0
    print("final converged value =", A.value(), "(invariant holds)")


if __name__ == "__main__":
    demo_escrow()
```

Expected output:

```
=== Escrow counter: 10 tickets, reservations A:4 B:4 C:2 ===
A sells 4: True  R[A]= 0
B sells 3: True  R[B]= 1
C sells 2: True  R[C]= 0
A tries 1 more: False (denied: out of reservation)
converged value = 1 (must be >= 0)

B transferred 1 reservation to A; R[A]= 1
A sells 1: True  value= 0
final converged value = 0 (invariant holds)
```

Note the contrast with §2: total sold is `4+3+2+1 = 10`, never one over. The denial of A's premature 11th request is the availability cost; the transfer is the *only* place coordination appears, and it is pairwise and off the hot path.

### 9.2 Python — Delta-State PN-Counter

```python
"""
Delta-state PN-counter: each mutation emits a tiny delta (one slot), and
anti-entropy ships only buffered deltas, not the full state. Merge is still
the componentwise max join, so SEC is preserved.
"""
from dataclasses import dataclass, field
from typing import Dict, List, Tuple


def _join(a: Dict[str, int], b: Dict[str, int]) -> Dict[str, int]:
    out = dict(a)
    for k, v in b.items():
        out[k] = max(out.get(k, 0), v)
    return out


@dataclass
class DeltaPNCounter:
    rid: str
    P: Dict[str, int] = field(default_factory=dict)   # increments per replica
    N: Dict[str, int] = field(default_factory=dict)   # decrements per replica
    # delta buffer: list of (P_delta, N_delta) not yet acked by all peers
    _buffer: List[Tuple[Dict[str, int], Dict[str, int]]] = field(default_factory=list)

    def value(self) -> int:
        return sum(self.P.values()) - sum(self.N.values())

    def increment(self, d: int = 1) -> Tuple[Dict[str, int], Dict[str, int]]:
        self.P[self.rid] = self.P.get(self.rid, 0) + d
        delta = ({self.rid: self.P[self.rid]}, {})   # only the changed slot
        self._buffer.append(delta)
        return delta

    def decrement(self, d: int = 1) -> Tuple[Dict[str, int], Dict[str, int]]:
        self.N[self.rid] = self.N.get(self.rid, 0) + d
        delta = ({}, {self.rid: self.N[self.rid]})
        self._buffer.append(delta)
        return delta

    def apply_delta(self, delta: Tuple[Dict[str, int], Dict[str, int]]) -> None:
        dp, dn = delta
        before = (dict(self.P), dict(self.N))
        self.P = _join(self.P, dp)
        self.N = _join(self.N, dn)
        # If the delta advanced our state, re-buffer it for our own peers
        if (self.P, self.N) != before:
            self._buffer.append((dp, dn))

    def drain_buffer(self) -> List[Tuple[Dict[str, int], Dict[str, int]]]:
        """Return pending deltas to ship, then clear (simulating ack-on-send)."""
        out, self._buffer = self._buffer, []
        return out


def demo_delta():
    print("=== Delta-state PN-counter on 3 replicas ===")
    A = DeltaPNCounter("A")
    B = DeltaPNCounter("B")
    C = DeltaPNCounter("C")
    nodes = {"A": A, "B": B, "C": C}

    # Concurrent partitioned activity.
    A.increment(5)
    B.decrement(2)
    C.increment(3); C.decrement(1)

    # Anti-entropy: each node ships ONLY its deltas to the others.
    for src in nodes.values():
        deltas = src.drain_buffer()
        for dst in nodes.values():
            if dst is not src:
                for delta in deltas:
                    dst.apply_delta(delta)

    # A second gossip round to propagate re-buffered deltas to full closure.
    for _ in range(2):
        for src in nodes.values():
            deltas = src.drain_buffer()
            for dst in nodes.values():
                if dst is not src:
                    for delta in deltas:
                        dst.apply_delta(delta)

    print("A value =", A.value())
    print("B value =", B.value())
    print("C value =", C.value())
    expected = 5 - 2 + 3 - 1  # = 5
    assert A.value() == B.value() == C.value() == expected, "DID NOT CONVERGE"
    print("converged value =", A.value(), "(expected", expected, ")")


if __name__ == "__main__":
    demo_delta()
```

Expected output:

```
=== Delta-state PN-counter on 3 replicas ===
A value = 5
B value = 5
C value = 5
converged value = 5 (expected 5 )
```

### 9.3 Go — Bounded (Escrow) Counter

```go
// Package crdtcounter implements a non-negative bounded (escrow) counter.
// The floor invariant value >= 0 holds without coordination on decrement;
// only reservation transfers between replicas are coordinated (pairwise).
package main

import "fmt"

// GCounter is a grow-only counter keyed by replica id.
type GCounter struct {
	counts map[string]int
}

func NewGCounter() *GCounter { return &GCounter{counts: map[string]int{}} }

func (g *GCounter) Inc(rid string, d int) { g.counts[rid] += d }

func (g *GCounter) Value() int {
	s := 0
	for _, v := range g.counts {
		s += v
	}
	return s
}

func (g *GCounter) Merge(o *GCounter) {
	for k, v := range o.counts {
		if v > g.counts[k] {
			g.counts[k] = v
		}
	}
}

// BoundedCounter enforces value >= 0 via per-replica reservations (escrow).
type BoundedCounter struct {
	selfID string
	inc    *GCounter
	dec    *GCounter
	R      map[string]int // per-replica reservation (escrow)
}

func NewBoundedCounter(selfID string, reservation, supply int) *BoundedCounter {
	bc := &BoundedCounter{
		selfID: selfID,
		inc:    NewGCounter(),
		dec:    NewGCounter(),
		R:      map[string]int{selfID: reservation},
	}
	bc.inc.counts["supply"] = supply // agreed one-time stock load
	return bc
}

func (bc *BoundedCounter) Value() int    { return bc.inc.Value() - bc.dec.Value() }
func (bc *BoundedCounter) MyRes() int    { return bc.R[bc.selfID] }

// Increment creates slack; the owner claims it. No coordination.
func (bc *BoundedCounter) Increment(d int) {
	bc.inc.Inc(bc.selfID, d)
	bc.R[bc.selfID] += d
}

// TryDecrement spends from local reservation only. No coordination.
func (bc *BoundedCounter) TryDecrement(d int) bool {
	if d > bc.MyRes() {
		return false // refuse rather than risk violating value >= 0
	}
	bc.dec.Inc(bc.selfID, d)
	bc.R[bc.selfID] -= d
	return true
}

// TransferOut withdraws reservation to hand to a peer (the coordinated op).
func (bc *BoundedCounter) TransferOut(amount int) int {
	give := amount
	if give > bc.MyRes() {
		give = bc.MyRes()
	}
	bc.R[bc.selfID] -= give
	return give
}

func (bc *BoundedCounter) TransferIn(amount int) { bc.R[bc.selfID] += amount }

func (bc *BoundedCounter) Merge(o *BoundedCounter) {
	bc.inc.Merge(o.inc)
	bc.dec.Merge(o.dec)
	for k, v := range o.R {
		if k != bc.selfID {
			bc.R[k] = v // learn others' reservations for display only
		}
	}
}

func main() {
	fmt.Println("=== Go escrow counter: 10 tickets, res A:4 B:4 C:2 ===")
	A := NewBoundedCounter("A", 4, 10)
	B := NewBoundedCounter("B", 4, 10)
	C := NewBoundedCounter("C", 2, 10)

	fmt.Println("A sells 4:", A.TryDecrement(4), "R[A]=", A.MyRes())
	fmt.Println("B sells 3:", B.TryDecrement(3), "R[B]=", B.MyRes())
	fmt.Println("C sells 2:", C.TryDecrement(2), "R[C]=", C.MyRes())
	fmt.Println("A tries 1 more:", A.TryDecrement(1), "(denied)")

	A.Merge(B)
	A.Merge(C)
	B.Merge(A)
	C.Merge(A)
	fmt.Println("converged value =", A.Value())
	if A.Value() < 0 {
		panic("INVARIANT VIOLATED")
	}

	given := B.TransferOut(1)
	A.TransferIn(given)
	fmt.Printf("\nB transferred %d to A; R[A]= %d\n", given, A.MyRes())
	fmt.Println("A sells 1:", A.TryDecrement(1), "value=", A.Value())
	A.Merge(B)
	A.Merge(C)
	if A.Value() < 0 {
		panic("INVARIANT VIOLATED")
	}
	fmt.Println("final converged value =", A.Value(), "(invariant holds)")
}
```

Expected output:

```
=== Go escrow counter: 10 tickets, res A:4 B:4 C:2 ===
A sells 4: true R[A]= 0
B sells 3: true R[B]= 1
C sells 2: true R[C]= 0
A tries 1 more: false (denied)
converged value = 1

B transferred 1 to A; R[A]= 1
A sells 1: true value= 0
final converged value = 0 (invariant holds)
```

### 9.4 Go — Delta-State PN-Counter

```go
// Delta-state PN-counter: mutations emit one-slot deltas; anti-entropy ships
// only buffered deltas. Merge is the componentwise max join, preserving SEC.
package main

import "fmt"

type slotMap map[string]int

func joinInto(dst, src slotMap) bool {
	changed := false
	for k, v := range src {
		if v > dst[k] {
			dst[k] = v
			changed = true
		}
	}
	return changed
}

type Delta struct{ P, N slotMap }

type DeltaPN struct {
	rid    string
	P, N   slotMap
	buffer []Delta
}

func NewDeltaPN(rid string) *DeltaPN {
	return &DeltaPN{rid: rid, P: slotMap{}, N: slotMap{}}
}

func (d *DeltaPN) Value() int {
	s := 0
	for _, v := range d.P {
		s += v
	}
	for _, v := range d.N {
		s -= v
	}
	return s
}

func (d *DeltaPN) Increment(n int) {
	d.P[d.rid] += n
	d.buffer = append(d.buffer, Delta{P: slotMap{d.rid: d.P[d.rid]}, N: slotMap{}})
}

func (d *DeltaPN) Decrement(n int) {
	d.N[d.rid] += n
	d.buffer = append(d.buffer, Delta{P: slotMap{}, N: slotMap{d.rid: d.N[d.rid]}})
}

func (d *DeltaPN) Apply(delta Delta) {
	c1 := joinInto(d.P, delta.P)
	c2 := joinInto(d.N, delta.N)
	if c1 || c2 { // re-buffer advancing deltas for our own peers
		d.buffer = append(d.buffer, delta)
	}
}

func (d *DeltaPN) Drain() []Delta {
	out := d.buffer
	d.buffer = nil
	return out
}

func main() {
	fmt.Println("=== Go delta-state PN-counter ===")
	nodes := map[string]*DeltaPN{
		"A": NewDeltaPN("A"), "B": NewDeltaPN("B"), "C": NewDeltaPN("C"),
	}
	nodes["A"].Increment(5)
	nodes["B"].Decrement(2)
	nodes["C"].Increment(3)
	nodes["C"].Decrement(1)

	for round := 0; round < 3; round++ {
		for sid, src := range nodes {
			deltas := src.Drain()
			for did, dst := range nodes {
				if did == sid {
					continue
				}
				for _, delta := range deltas {
					dst.Apply(delta)
				}
			}
		}
	}

	for _, id := range []string{"A", "B", "C"} {
		fmt.Printf("%s value = %d\n", id, nodes[id].Value())
	}
	expected := 5 - 2 + 3 - 1
	if nodes["A"].Value() != expected ||
		nodes["B"].Value() != expected ||
		nodes["C"].Value() != expected {
		panic("DID NOT CONVERGE")
	}
	fmt.Println("converged value =", nodes["A"].Value(), "(expected", expected, ")")
}
```

Expected output:

```
=== Go delta-state PN-counter ===
A value = 5
B value = 5
C value = 5
converged value = 5 (expected 5 )
```

> **Run:** `python3 file.py` for the Python snippets; `go run file.go` for each Go program (one `main` per file). All four are self-contained and assert their own correctness.

---

## 10. Pitfalls

- **Believing convergence implies correctness.** SEC says replicas agree on *a* value; it says nothing about that value satisfying `≥ 0`, `≤ cap`, or any non-local predicate. This is the number-one senior-level trap. Always ask: *is my invariant local?* If not, a plain CRDT cannot enforce it.
- **Clamping the value as a "fix."** `max(value, 0)` is not a join; it breaks idempotency/associativity and SEC, and it merely *hides* an oversell rather than preventing it. Use escrow, not clamping.
- **Provisioning escrow uniformly under skewed load.** If one replica handles 90% of decrements but holds 1/N of the reservation, it constantly hits its limit and falls back to slow transfers. Provision reservations *proportional to expected demand*, and consider an adaptive rebalancer.
- **Forgetting the denial path is a real outcome.** A bounded counter *will* refuse operations when local reservation is exhausted and no transfer can complete (e.g., during partition). Your application must define what "denied" means — queue, reject, or escalate to synchronous coordination.
- **Naive slot deletion in a G/PN-Counter.** Removing a slot without satisfying causal stability lets a straggler re-inject it on merge, causing double-counting. Never delete a slot until the §6 safety condition holds across the *entire* membership.
- **One unreachable replica freezing GC forever.** Causal stability is gated by the *least*-advanced replica. Permanently dead nodes must be *evicted from membership*, or your metadata grows unbounded. Membership management is part of the design, not optional.
- **Op-based counters without dedup.** Increments are not idempotent; at-least-once delivery over-counts. You need reliable causal broadcast *and* per-source dedup, or use state/delta-based counters which dedup for free.
- **Delta buffers that never get GC'd.** You cannot discard a buffered delta until every peer that needs it has acked — or you keep a periodic full-state anti-entropy backstop. Forgetting the backstop strands replicas that missed deltas.
- **Ephemeral replicas in a plain G-Counter.** Mobile/serverless ids each mint a permanent slot; metadata explodes even though the value is tiny. Reach for handoff counters when fan-in is from short-lived actors.
- **Assuming handoff is free of protocol.** A "send my count and forget" handoff loses counts on drop or double-counts on duplication. The slot/token machinery exists precisely to make handoff exactly-once over an unreliable network — don't shortcut it.

---

## 11. Cheat Sheet

```
INVARIANTS
  CRDT  ⟹  convergence (SEC), NOT non-local invariants.
  value >= 0 is NON-LOCAL  ⟹  a plain PN-counter CANNOT enforce it.
  Plain PN under concurrent partitioned spends ⟹ can converge NEGATIVE.

ESCROW / BOUNDED COUNTER (Balegas 2015)
  Partition the budget into per-replica reservations R[i].
  Invariant kept:  Σ R[i] <= value   (disjoint slices of slack).
  Decrement(d) by i  ⟺  d <= R[i]; then R[i] -= d.   (NO coordination)
  Increment(d) by i  ⟹  R[i] += d.                   (NO coordination)
  ONLY coordinated op: reservation TRANSFER between replicas (pairwise).
  Floor value>=L  → reserve against value-L.  Cap value<=U → reserve U-value.

HANDOFF COUNTERS (Almeida & Baquero 2019)
  Problem: ephemeral replicas ⟹ unbounded slot growth in G-counter.
  Fix: tiers; ephemeral slot's count is HANDED OFF to a stable tier,
       then the source slot is retired. Slot/token machinery = exactly-once
       over lossy network. State size = O(stable replicas).

DELTA-STATE (Almeida, Shoker, Baquero 2018)
  Ship only changed slots (deltas), not full state. Merge still = max-join.
  Buffer deltas, ack per-peer, GC acked intervals, full-state backstop.

GC / CAUSAL STABILITY
  Retire slot i  ⟺  i will never increment again
                  AND every replica's state has P[i] >= final_i
                  AND membership stable (no straggler can re-inject).
  Frontier = MIN across all replicas; one dead node freezes GC ⟹ evict it.

OP-BASED
  increment is NOT idempotent ⟹ need reliable causal broadcast + dedup
  (per-source (id,seq) delivered-set / watermark). Else over-count.

DECISION LADDER
  only grows ............................ G-Counter
  up & down, no invariant ............... PN-Counter
  needs a floor or cap .................. Bounded (escrow) counter
  swamped by ephemeral actor ids ....... Handoff counter
  bandwidth-bound replication .......... + Delta-state transport (orthogonal)
```

---

## 12. Summary

The defining limitation of CRDT counters is that **convergence is not correctness**: SEC guarantees every replica reaches the same value, but says nothing about whether that value honours a global predicate. The classic failure is the PN-Counter that converges *negative* because two replicas, each locally valid, spent concurrently from the same unpartitioned budget under partition — overselling 13 of 10 tickets with the lattice working perfectly the entire time.

The senior-level toolkit reclaims invariants with minimal coordination:

- **Bounded / escrow counters** (Balegas 2015) partition the budget *in advance* into per-replica reservations. Decrements spend only local escrow — zero coordination in the common case — and the floor `value ≥ 0` holds by construction because reservations are disjoint and `ΣR ≤ value`. Coordination resurfaces *only* to transfer reservation between replicas, a rare, pairwise, off-the-hot-path operation. The cost of the invariant is the *denial* of operations when local escrow is exhausted: the explicit, designed availability trade.
- **Handoff counters** (Almeida & Baquero 2019) solve actor-id explosion: ephemeral replicas hand their counts off into a stable tier via slot/token machinery that is exactly-once over a lossy network, so state size is `O(stable replicas)` rather than `O(every ephemeral id ever seen)`.
- **Delta-state counters** ship only the changed slots, making replication bandwidth proportional to the *change rate*, with the same max-join merge and SEC.
- **GC** of dead slots is governed by **causal stability**: a slot is retirable only once it will never change again *and* every replica in a stable membership has observed its final value — gated by the least-advanced replica, which is why dead-node eviction is mandatory.
- **Op-based counters** trade tiny messages for a hard delivery requirement: increments are non-idempotent, so they demand reliable causal broadcast plus dedup, which is exactly the convenience state/delta-based counters give away for free.

The through-line: every design here is an explicit, principled negotiation of the same trade-off — *how much coordination must I reintroduce to recover the invariant or bound the metadata, and how far off the critical path can I push it?*

---

## 13. Further Reading

- **Shapiro, Preguiça, Baquero, Zawirski (2011)** — *Conflict-free Replicated Data Types*, INRIA RR-7687 / SSS 2011. The foundational treatment of G-Counter, PN-Counter, the CvRDT/CmRDT distinction, and the SEC proof. Start here for the lattice and convergence theorems.
- **Balegas, Duarte, Ferreira, Rodrigues, Preguiça, Najafzadeh, Shapiro (2015)** — *Putting Consistency Back into Eventual Consistency* (EuroSys 2015, the **Indigo** system) and *Extending Eventual Consistency for Enforcing Invariants* — the bounded counter / escrow-reservation design for numeric invariants over CRDTs.
- **O'Neil (1986)** — *The Escrow Transactional Method*, ACM TODS. The database ancestor of the reservation idea; worth reading to see escrow's lineage.
- **Almeida & Baquero (2019)** — *Scalable Eventually Consistent Counters over Unreliable Networks* (Distributed Computing). The **handoff counter** mechanism, slots/tokens, and the tier hierarchy for ephemeral replicas.
- **Almeida, Shoker, Baquero (2018)** — *Delta State Replicated Data Types* (JPDC). Formalises delta-mutators, delta-groups, and delta-based anti-entropy with acknowledgments.
- **Baquero, Almeida, Shoker (2014)** — *Making Operation-Based CRDTs Operation-Based* — on op-based delivery requirements and the causal-broadcast / dedup obligations behind §7.
- **Preguiça (2018)** — *Conflict-free Replicated Data Types: An Overview* — a readable modern survey tying together state/op/delta, causal stability, and GC.

---

### Cross-links

- [CRDT Fundamentals](../01-crdt-fundamentals/senior.md)
- [State vs Op CRDTs](../02-state-vs-operation-based-crdts/senior.md)
- Other tiers of this topic: [junior](junior.md) · [middle](middle.md) · [professional](professional.md)
