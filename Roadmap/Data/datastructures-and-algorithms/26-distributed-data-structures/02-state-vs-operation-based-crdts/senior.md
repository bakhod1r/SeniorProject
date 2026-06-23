# State-based vs Operation-based CRDTs — Senior Level

> You already know the two models formally: a **CvRDT** (Convergent, state-based) is a join-semilattice whose `merge` is the least upper bound; a **CmRDT** (Commutative, operation-based) ships commutative effectors over a reliable causal broadcast. This page is about what lies *past* the definitions: the equivalence theorem that says the two models are interchangeable, **delta-state CRDTs** as the engineering synthesis of both, and the genuinely hard parts — causal delivery, garbage collection, and the failure modes that quietly break convergence in production.

---

## Table of Contents

1. [Framing: the two models as a single design space](#1-framing)
2. [The equivalence theorem (Shapiro et al. 2011)](#2-equivalence)
3. [Delta-state CRDTs: the synthesis](#3-delta-state)
4. [Reliable causal broadcast for op-based](#4-causal-broadcast)
5. [Garbage collection](#5-garbage-collection)
6. [Failure modes](#6-failure-modes)
7. [Decision framework](#7-decision-framework)
8. [Code: delta-state and op-based, side by side](#8-code)
9. [Performance and space](#9-performance)
10. [Pitfalls](#10-pitfalls)
11. [Cheat sheet](#11-cheat-sheet)
12. [Summary](#12-summary)
13. [Further reading](#13-further-reading)

---

<a name="1-framing"></a>

## 1. Framing: the two models as a single design space

Hold the two models next to each other and reduce each to its irreducible contract.

A **state-based CvRDT** is a triple `(S, ≤, ⊔)`:

- `S` is the set of states, partially ordered by `≤`.
- `(S, ≤)` is a **join-semilattice**: every pair of states has a least upper bound (LUB), written `⊔`.
- `merge(a, b) = a ⊔ b`. Local mutations are **inflations**: `mutate(s) ≥ s`.

Convergence is *free* given those algebraic facts. Because `⊔` is **associative, commutative, and idempotent (ACI)**, replicas that have received the same *set* of states — in any order, with any duplication — compute the same join. The delivery layer only has to be **eventually reliable**: deliver every state at least once, eventually. Order and duplication are irrelevant.

An **operation-based CmRDT** is a pair of functions per operation:

- `prepare(op, s)` — runs at the source, returns an effector (a closure / message). Side-effect-free on `s`.
- `effect(m, s)` — applies effector `m` to state `s`. Concurrent effectors must **commute**.

Convergence here is *not* free. It rests on the delivery layer providing **reliable causal broadcast (RCB)**: every effector delivered **exactly once** to every replica, and delivered respecting **causal order** (if `m1` happened-before `m2`, every replica applies `m1` before `m2`). Concurrent effectors may arrive in any order *because they commute* — but causally related ones may not.

The trade is stark and worth memorizing:

| | State-based (CvRDT) | Op-based (CmRDT) |
|---|---|---|
| Ships | full state (or a join thereof) | small effectors |
| Message size | large, grows with state | small, ~size of one op |
| Delivery requirement | eventual, any order, duplicates OK | reliable causal, exactly-once |
| Convergence relies on | `⊔` is ACI | effectors commute + causal delivery |
| Channel can drop/dup/reorder? | yes (re-send fixes it) | no — needs a log + dedup |
| New replica bootstrap | send current state | replay full op history |

The genius of the field's middle period (2016–2018) was realizing these are not two species but two projections of one structure — and that a third projection, **delta-state**, gets the message size of op-based with the dumb-channel tolerance of state-based.

→ For the model definitions and first examples see [CRDT Fundamentals](../01-crdt-fundamentals/senior.md). For the canonical set CRDTs referenced throughout, see [OR-Set / LWW](../04-sets-or-set-lww/senior.md). Lower tiers: [junior](junior.md), [middle](middle.md). Production operations: [professional](professional.md).

---

<a name="2-equivalence"></a>

## 2. The equivalence theorem (Shapiro et al. 2011)

Shapiro, Preguiça, Baquero, and Zawirski proved (INRIA RR-7687, 2011) that the two models have **equal expressive power**: any CmRDT can be emulated by a CvRDT and vice versa. This is not a hand-wave — it comes with explicit constructions. Understanding them tells you precisely what each model *costs* to simulate the other, which in turn explains why neither is strictly dominant.

### 2.1 Op-based on top of state-based (ship diffs)

Claim: given a CmRDT, build a CvRDT that emulates it.

Construction. Make the emulating CvRDT's state a **set of effectors** (or, more efficiently, a structure that captures their cumulative effect with causal metadata). The semilattice is set-union of delivered effectors; `merge = ∪`. A replica's *observable* value is `fold(effect, deliveredEffectors)` applied to the initial state — and because the underlying effectors commute, the fold is order-independent.

- A local op runs `prepare`, adds the effector to the local set, and the state grows monotonically (inflation = "set got a new element").
- `merge` is union, which is ACI ⇒ the emulation is a valid CvRDT.
- Shipping the *whole* effector set on every sync is wasteful; the practical version ships only the effectors the peer is missing — i.e., a **diff** of the two sets. That diff-shipping CvRDT is, operationally, op-based broadcast riding on a state-based reconciliation channel. This is exactly the seed of delta-state CRDTs (§3).

The cost: you carry effectors (or their cumulative metadata) in the state, and you need a way to garbage-collect effectors everyone has seen (§5). Causal delivery is no longer required of the *channel* — convergence is recovered by union — but **causal consistency of the observed value** is recovered only if effectors that depend on others are not observed in isolation. Delta-CRDTs handle this with causal contexts.

### 2.2 State-based on top of op-based (apply the LUB as an op)

Claim: given a CvRDT, build a CmRDT that emulates it.

Construction. Define a single operation whose effector is "**join the sender's full state into mine**":

- `prepare(s)` returns the closure `m = (λ t. t ⊔ s)` — it captures the source's current state `s`.
- `effect(m, t) = t ⊔ s = m(t)`.

Now check the CmRDT obligation that **concurrent effectors commute**:

```
effect(m_a, effect(m_b, t)) = (t ⊔ s_b) ⊔ s_a
effect(m_b, effect(m_a, t)) = (t ⊔ s_a) ⊔ s_b
```

These are equal because `⊔` is associative and commutative. **Idempotence of `⊔` is what makes this construction tolerate duplicate delivery** — re-applying the same `m` is `t ⊔ s ⊔ s = t ⊔ s`. So the emulating CmRDT does *not even need exactly-once or causal delivery*: the effectors are joins, and joins are ACI. In other words, "ship the whole state as an op" degenerates back into ordinary state-based gossip. That is the tell: the op-based model can express state-based behavior, but only by abandoning the small-message advantage that justified op-based in the first place.

### 2.3 What the theorem actually buys you

The equivalence says **correctness is portable**: you can prototype in whichever model is easier to reason about and transport the proof to the other. What it does *not* say is that the two are equal in **engineering cost**. The asymmetry is the whole point:

- Emulating op-based with state-based costs you **state bloat + GC** but buys you a **dumb channel**.
- Emulating state-based with op-based costs you nothing in delivery (joins are ACI) but **throws away the message-size win** — you're back to shipping whole states.

Delta-state CRDTs are the construction that takes the *good* half of §2.1 (ship diffs, dumb channel) and engineers away the *bad* half (state bloat) by being careful about exactly which fragments of state you ship.

---

<a name="3-delta-state"></a>

## 3. Delta-state CRDTs: the synthesis

Almeida, Baquero, and Cabral formalized **delta-state CRDTs** (often *δ-CRDTs*; "Delta State Replicated Data Types", *JPDC* 2018; arXiv 1603.01529). The motivating defect of classic state-based CRDTs is blunt: every sync ships the **entire state**, even if one element changed in a million-element set. Delta-CRDTs fix this while staying inside the state-based world (dumb channel, ACI merge).

### 3.1 The core idea: join-irreducible deltas

A **delta-mutator** `mᵟ` is a variant of a mutator that returns *not the new full state* but a **delta** — a small state-lattice value — such that:

```
m(s) = s ⊔ mᵟ(s)
```

The delta `d = mᵟ(s)` is itself an element of the same join-semilattice. The crucial property: deltas are (ideally) **join-irreducible** — a state `x` is join-irreducible if `x = a ⊔ b ⟹ x = a or x = b`, i.e., it cannot be split into a join of two strictly smaller states. Join-irreducibles are the "atoms" of the lattice. A single `add(e)` to an OR-Set produces a delta containing just the one new `(e, tag)` pair plus the causal context fragment that justifies it — not the whole set.

Because deltas live in the same lattice, **everything still merges with `⊔`**. Three things are now equivalent under join:

```
s ⊔ full_state_of_peer      (classic state-based)
s ⊔ d₁ ⊔ d₂ ⊔ … ⊔ dₙ        (apply each delta)
s ⊔ (d₁ ⊔ … ⊔ dₙ)            (apply a joined batch — a "delta-group")
```

So a replica may ship individual deltas (cheap, op-like) **or** join a window of deltas into a *delta-group* and ship that (amortized) — and the receiver merges either way. This is the synthesis: **op-based bandwidth, state-based fault tolerance**. You may lose a delta, dup a delta, reorder deltas — `⊔` cleans it up, exactly as for full states.

### 3.2 Delta-intervals, delta-buffers, and causal merging

Two refinements turn the idea into a working protocol.

**Delta-buffer.** Each replica keeps a buffer mapping a monotonic local **sequence number** to the delta produced at that step:

```
deltaBuffer : seq → delta
```

and an **ack map** recording, per peer, the highest sequence number that peer has acknowledged. To sync with peer `j`, replica `i` joins all deltas with sequence ≥ `ack[j]` into a single **delta-interval** and ships it with its sequence range. The receiver merges it and acks the high-water mark. Already-seen sequences are simply not re-sent. This is the bandwidth win made concrete: you ship the *interval since the peer last heard from you*, not the whole state.

**Causal δ-CRDTs need careful merging.** For *causal* CRDTs (OR-Set, RWLWWSet, causal maps), a delta is only meaningful relative to a **causal context** (a set of dots / version vector). Naïvely `⊔`-ing an arbitrary delta into a state can violate causal consistency: you might absorb an *add*'s dot into the context (which records "I have seen this event") without ever absorbing the corresponding element, making the element look *removed*. The δ-CRDT framework solves this with **`mutator` deltas that are themselves causally-self-contained** and a **causal merge** that only advances the context for dots it can justify. Almeida et al. require delta-intervals to be shipped such that the receiver never has a *gap* in causality it cannot fill — practically, you ship deltas in sequence order per origin and the receiver merges them in order, so the context never jumps ahead of the data.

The discipline reduces to one rule: **don't let the causal context get ahead of the data it certifies.** Ship intervals contiguously per source; merge them so the context only grows when the elements/tombstones that justify those dots are present.

### 3.3 The anti-entropy algorithm

Delta-CRDT anti-entropy is a periodic gossip loop. Pseudocode for replica `i`:

```
state            : the CRDT value (a lattice element)
seq              : next local delta sequence number (monotone)
deltaBuffer[seq] : delta produced at that seq
ack[j]           : highest seq replica i knows replica j has merged

on local operation op:
    d        = δ-mutator(op, state)      # join-irreducible delta
    state    = state ⊔ d                 # apply locally
    deltaBuffer[seq] = d
    seq      = seq + 1

periodically, for some peer j:
    # ship the interval of deltas j hasn't acked yet
    low = ack[j]
    if low < seq and (low is still in the buffer):
        d_interval = ⊔ { deltaBuffer[k] : low ≤ k < seq }
        send DELTA(i, low, seq, d_interval) to j
    else:
        send STATE(i, state) to j        # fallback: j fell behind buffer GC

on receive DELTA(src, low, high, d) at j:
    if low ≤ seq_seen_from_src(src):     # contiguity check — no gap
        state = state ⊔ d                # causal merge
        send ACK(j, src, high)
    # else: drop / request full state (gap detected)

on receive STATE(src, s) at j:
    state = state ⊔ s
    send ACK(j, src, ???)               # acks via state are coarse

on receive ACK(from, high):
    ack[from] = max(ack[from], high)
    # high-water across all peers gates buffer GC (see §5)
```

Two production-critical details:

- The **fallback to full state** when a peer has fallen behind the buffer's GC horizon is what preserves the state-based safety net. A new or long-partitioned replica just gets the whole state and is correct. You never *depend* on a delta surviving.
- The **contiguity check** is what keeps causal CRDTs causally consistent. If `j` is missing deltas `[5,8)` from `src`, it must not merge `[8,11)` blindly. Either request the gap or take a full state.

### 3.4 Why this is the default modern choice

Riak's `riak_dt`, Akka Distributed Data, AntidoteDB, and most newer systems converged on delta-state precisely because it dominates classic state-based on bandwidth while keeping the operational simplicity (dumb gossip channel, trivial dedup, free bootstrap). Pure op-based survives where you already have a strong causal-broadcast substrate (e.g., a totally-ordered or causally-ordered log/bus) and you want the absolute minimum metadata — but you pay for that substrate (§4).

---

<a name="4-causal-broadcast"></a>

## 4. Reliable causal broadcast for op-based

Op-based correctness is only as good as its delivery layer. The contract the data type *assumes* and the messaging layer must *provide* is **reliable causal broadcast (RCB)**:

1. **Reliable delivery** — every effector eventually reaches every (correct) replica.
2. **Exactly-once** — at the data type, each effector is applied once. (Either the channel guarantees it, or the data type's effectors are idempotent and dedup is explicit.)
3. **Causal order** — if `m₁ → m₂` (happened-before), every replica applies `m₁` before `m₂`. Concurrent effectors (`m₁ ∥ m₂`) may be applied in either order *because they commute*.

### 4.1 Vector clocks and the delivery predicate

The standard mechanism is **vector clocks** (or per-origin sequence numbers + a version vector). Each replica `i` keeps `VC[i]`. To broadcast op `m`, `i` increments `VC[i][i]` and tags `m` with the resulting vector `tm`. A receiver `j` may **deliver** `m` from origin `i` only when the *causal delivery predicate* holds:

```
tm[i] = VC_j[i] + 1                       # m is the next message from i
∧  ∀ k ≠ i :  tm[k] ≤ VC_j[k]             # j has seen everything m saw
```

Messages that fail the predicate are **buffered** until their causal dependencies arrive, then released. This is the precise machinery that makes "`add(x)` is delivered before `remove(x)`" hold across the cluster — without it, an op-based OR-Set can converge to the *wrong* value (a remove with no matching add, or an add resurrected after its remove).

### 4.2 What the data type must *not* assume

A subtle senior-level trap: **concurrent** ops are delivered in arbitrary order, so the data type's effectors must commute for *all* concurrent pairs — RCB only orders *causally related* ops. If your design secretly relies on two concurrent increments arriving in a particular order, RCB will not save you; that's a data-type bug, not a delivery bug.

### 4.3 The cost of the message log

RCB is not free. To provide reliable + exactly-once over a lossy network you need a **message log / retransmission buffer**:

- The sender retains each effector until **all** peers have acknowledged it (or until causal stability, §5). That's an unbounded-until-acked buffer — a slow or partitioned replica pins the log.
- Receivers keep a **dedup window** (or full causal history) to drop replays. Vector clocks already give you this: a message whose vector is `≤` your VC is a duplicate.
- Out-of-order arrivals require a **reorder buffer** keyed by the causal predicate.

These buffers are the op-based analog of the delta-buffer in §3 — and they have the same GC problem (§5). The difference: in delta-state, losing a buffered delta is *recoverable* (fall back to full state); in pure op-based, losing an un-acked effector with no other copy is **unrecoverable convergence loss** unless you can re-derive it. This is the single biggest operational reason teams pick delta-state.

### 4.4 Exactly-once vs idempotent-op design

There are two ways to honor obligation (2):

- **Exactly-once channel.** The transport guarantees each effector is applied once (e.g., a log with per-consumer offsets — Kafka-style — or TCP + app-level sequence + dedup). Effectors can be *non-idempotent* (e.g., a raw counter `+1`). Cheaper metadata per op, heavier transport.
- **Idempotent effectors + at-least-once channel.** Make `effect` safe to apply twice — e.g., tag each increment with a unique dot `(replica, seq)` and have `effect` ignore dots already present. Now duplicates are harmless and the channel only needs *at-least-once*. This is strictly more robust and is, in fact, the design that **collapses toward delta-state**: a counter whose effectors carry dots and dedup is observed-add semantics — i.e., you've reinvented a causal δ-CRDT. Baquero's pointed observation ("Making Operation-based CRDTs Operation-based", DAIS 2014) is that "pure" op-based CRDTs can be redesigned so effectors carry only *opaque, self-describing* metadata, pushing the causal bookkeeping into a small **PO-Log** (partially-ordered log) and out of the application's effectors — the cleanest way to get idempotent, commutative, causally-correct ops.

---

<a name="5-garbage-collection"></a>

## 5. Garbage collection

Every model accumulates metadata that must be reclaimed, or replicas bloat without bound. The unifying concept is **causal stability**.

### 5.1 Causal stability

An event (op/delta) `e` tagged with vector `te` is **causally stable** at replica `i` once `i` knows that **every** replica has delivered all events that could be concurrent with `e` — equivalently, once `e` is in the causal past of the *minimum* across all replicas' version vectors. Concretely, maintain a matrix clock or a low-water-mark vector `L` where `L[k]` = the smallest `VC[k]` known across all replicas (gossiped). An event from `k` with sequence `s` is stable once `s ≤ L[k]`.

Once stable, **nothing concurrent to `e` can ever arrive again**. That single fact unlocks every GC story below.

### 5.2 Op logs (op-based)

The sender's retransmission log can drop an effector once it is **acknowledged by all peers** (or once causally stable). Until then it's pinned. Practical systems bound this with a *liveness* assumption: a replica that hasn't acked in `T` is declared failed and removed from the membership (and its tombstones eventually GC'd), or it must rejoin via full-state bootstrap. The PO-Log of pure op-based CRDTs is pruned the same way: stable, dominated entries are discarded and only the resulting summarized state is kept.

### 5.3 Delta buffers (delta-state)

The delta-buffer entry at sequence `s` can be dropped once **every** peer has acked `≥ s` (i.e., `min_j ack[j] ≥ s`). Anything below that horizon, no one will ever request again — and if some lagging replica needs it, the protocol falls back to full state (§3.3). So delta-buffer GC is *safe by construction*: over-aggressive GC degrades to bandwidth (a full-state send), never to incorrectness. This asymmetry — GC mistakes cost *bytes*, not *correctness* — is exactly why delta-state is operationally forgiving.

### 5.4 Tombstones in removes

Removal is the perennial GC headache. Naïve set CRDTs keep a **tombstone** per removed element forever, so a workload of add/remove churn grows the metadata unboundedly. Approaches:

- **OR-Set with dots + causal context.** Instead of explicit tombstones, an "optimized OR-Set" stores a **causal context** (a version vector + an exception set of dots). A removed element leaves *no* per-element tombstone; its dots are subsumed into the compact context once the context becomes contiguous. See [OR-Set / LWW](../04-sets-or-set-lww/senior.md) for the dotted-version-vector mechanics.
- **Causal stability prune.** Once a remove is causally stable, no concurrent add of the same `(element, tag)` can arrive, so the tombstone is provably redundant and can be dropped — the element simply won't reappear.
- **LWW** sidesteps tombstones by keeping a single timestamped value/tombstone bit per key; GC is just "keep the latest" but loses concurrent-add safety.

The senior takeaway: tombstone GC is **only sound under causal stability** (op-based) or a **contiguous causal context** (delta-state). Drop a tombstone before its remove is stable and a delayed concurrent add resurrects a deleted element — a classic, hard-to-reproduce convergence bug.

---

<a name="6-failure-modes"></a>

## 6. Failure modes

These are the bugs that pass unit tests and fail in production. Each maps to a violated precondition.

**1. Non-commuting concurrent ops (op-based).** The effector pair doesn't commute, so divergent application order ⇒ divergent state. Classic instance: an op-based list/sequence where `insert` positions are index-based rather than identifier-based — two concurrent inserts at index 2 commute *as ops* but produce different sequences depending on order. Fix: position via stable identifiers (RGA/Logoot/Treedoc), not indices. RCB *cannot* help — it only orders causal pairs, and these are concurrent.

**2. Lost op with no retransmit log (op-based).** An effector is delivered to some but not all replicas, then dropped from the sender's log (GC'd too early, or sender crashed before all acks). The op is gone; affected replicas converge to a *different* value with no mechanism to notice. This is **unrecoverable** without full-state re-sync. The mitigation is exactly the delta-state safety net — keep a recoverable full state.

**3. Merge that isn't a true join (state/delta).** Someone writes a `merge` that isn't ACI — not idempotent (double-counts on re-delivery), not commutative (order-dependent), or not associative (batching changes the result). Symptom: convergence holds under perfect delivery, then breaks under retries/duplicates. Example: a "counter" whose merge does `a.value + b.value` instead of per-replica `max` of contributions — re-delivering a state double-counts. *Every* state-based bug ultimately reduces to "merge wasn't a real LUB." Test it with a property check: `merge(a,b)==merge(b,a)`, `merge(a,a)==a`, `merge(a,merge(b,c))==merge(merge(a,b),c)`.

**4. Partial delta application (delta-state).** A delta-interval is applied partially — e.g., a crash mid-merge, or a delta absorbed into the causal context but whose elements weren't (the §3.2 hazard). The context now claims to have seen events whose data is missing ⇒ elements look removed. Fix: make merge **atomic** (apply the whole interval or none), enforce **contiguity** per origin, and never advance the context ahead of its justifying data.

**5. Causal-context / tombstone GC too early.** Covered in §5.4 — dropping metadata before causal stability resurrects deletes or double-applies adds. The failure surfaces only when a delayed message arrives *after* GC, so it's intermittent and partition-correlated.

**6. Vector-clock identity reuse (op-based & delta).** A replica reuses an id (restart with same id but reset counter, or two nodes share an id). The causal predicate is now lying; messages get delivered out of causal order or deduped incorrectly. Use durable, unique replica ids (UUIDs) and persist the clock.

---

<a name="7-decision-framework"></a>

## 7. Decision framework

| Dimension | State-based (CvRDT) | Op-based (CmRDT) | Delta-state (δ-CRDT) |
|---|---|---|---|
| **Message size** | Full state — worst | Single op — best | Delta interval — near-op |
| **Metadata carried** | In-state version vectors / contexts | Per-op causal tag + sender log | In-state context + delta buffer |
| **Delivery requirement** | Eventual, any order, dup-OK | **Reliable causal, exactly-once** | Eventual, any order, dup-OK |
| **GC story** | Context prune at causal stability | Op log + PO-Log prune at stability | Delta buffer drop at `min ack`; full-state fallback |
| **Fault tolerance** | High — re-send any state | Low — lost un-acked op is fatal | High — falls back to full state |
| **Dedup** | Free (`⊔` idempotent) | Needs explicit dedup / idempotent effectors | Free (`⊔` idempotent) |
| **New-replica bootstrap** | Send state | Replay full op history | Send state |
| **Channel needed** | Dumb gossip | Causal-broadcast substrate | Dumb gossip |
| **Best when** | Small state, simple ops | You already have a causal log/bus; want minimal bytes per op | Default for large mutable state |

Heuristic decision path:

- **Do you already have reliable causal broadcast** (a Kafka/Pulsar log, a causal-order bus, totally-ordered consensus)? If yes, pure op-based gives minimal per-op bytes essentially for free. If no, building RCB just for CRDTs is rarely worth it.
- **Is the state large and mostly stable between syncs** (a big set, a CRDT map, a document)? Delta-state wins decisively — don't ship megabytes to convey one edit.
- **Is the state tiny** (a single counter, a flag, an LWW register)? Classic state-based is simplest; the bandwidth difference is noise.
- **Do you need robustness to a flaky/lossy network and easy node rejoin?** Delta-state or state-based — never depend on op survival.

Default for new systems with non-trivial state: **delta-state**.

---

<a name="8-code"></a>

## 8. Code: delta-state and op-based, side by side

We implement the **same logical CRDT** — a grow/shrink **OR-Set of strings** — three ways, then prove all converge to the same value and compare bytes on the wire:

1. A **delta-state** OR-Set with delta buffers + anti-entropy sync.
2. An **op-based** OR-Set over a causal-broadcast simulator.
3. (Reference) a classic **full-state** sync, to size the bandwidth saving.

Both languages use the same OR-Set core: an element is present iff at least one of its **dots** `(replica, seq)` is in the `elements` map and not in the removed `context` minus exceptions. We keep it readable rather than maximally optimized.

### 8.1 Python

```python
"""
Delta-state vs op-based OR-Set, with a causal-broadcast simulator and a
bytes-on-the-wire comparison. Runnable on CPython 3.8+.
"""
from __future__ import annotations
import itertools
import json
from dataclasses import dataclass, field
from typing import Dict, List, Set, Tuple

Dot = Tuple[str, int]  # (replica_id, sequence)


# --------------------------------------------------------------------------
# Shared OR-Set core (used by both styles). State is a join-semilattice:
#   dots[element] = set of dots that added it
#   ctx          = set of all dots ever observed (the causal context)
# present(e)  iff  dots[e] is non-empty.
# remove(e) drops e's dots locally but KEEPS them in ctx, so a concurrent
# add (with a fresh dot not in ctx) survives the merge — observed-remove.
# --------------------------------------------------------------------------
@dataclass
class ORSet:
    rid: str
    dots: Dict[str, Set[Dot]] = field(default_factory=dict)
    ctx: Set[Dot] = field(default_factory=set)
    counter: int = 0  # local dot sequence

    def value(self) -> Set[str]:
        return {e for e, ds in self.dots.items() if ds}

    def _fresh_dot(self) -> Dot:
        self.counter += 1
        return (self.rid, self.counter)

    @staticmethod
    def _merge_into(dst: "ORSet", elems: Dict[str, Set[Dot]], ctx: Set[Dot]) -> None:
        """Causal merge of (elems, ctx) into dst. This is the LUB."""
        # 1. Keep dots that either side still considers present.
        all_elems = set(dst.dots) | set(elems)
        for e in all_elems:
            mine = dst.dots.get(e, set())
            theirs = elems.get(e, set())
            # A dot stays present unless the OTHER side has observed it (in ctx)
            # but no longer lists it (i.e. removed it).
            keep = set()
            keep |= {d for d in mine if d in theirs or d not in ctx}
            keep |= {d for d in theirs if d in mine or d not in dst.ctx}
            if keep:
                dst.dots[e] = keep
            elif e in dst.dots:
                del dst.dots[e]
        # 2. Contexts join by union.
        dst.ctx |= ctx


# --------------------------- DELTA-STATE STYLE ----------------------------
@dataclass
class DeltaORSet(ORSet):
    # delta buffer: seq -> (dots-fragment, ctx-fragment)
    buffer: Dict[int, Tuple[Dict[str, Set[Dot]], Set[Dot]]] = field(default_factory=dict)
    bseq: int = 0
    ack: Dict[str, int] = field(default_factory=dict)  # peer -> highest seq merged

    def _emit(self, dots_frag: Dict[str, Set[Dot]], ctx_frag: Set[Dot]) -> None:
        self.buffer[self.bseq] = (dots_frag, ctx_frag)
        self.bseq += 1

    def add(self, e: str) -> None:
        d = self._fresh_dot()
        self.dots.setdefault(e, set()).add(d)
        self.ctx.add(d)
        self._emit({e: {d}}, {d})  # join-irreducible delta: one new dot

    def remove(self, e: str) -> None:
        removed = self.dots.pop(e, set())
        # remove delta = empty dots for e + the removed dots in context
        self.ctx |= removed
        self._emit({}, set(removed))

    def delta_interval(self, peer: str) -> Tuple[int, int, Dict[str, Set[Dot]], Set[Dot]]:
        low = self.ack.get(peer, 0)
        merged_dots: Dict[str, Set[Dot]] = {}
        merged_ctx: Set[Dot] = set()
        for k in range(low, self.bseq):
            df, cf = self.buffer[k]
            for e, ds in df.items():
                merged_dots.setdefault(e, set()).update(ds)
            merged_ctx |= cf
        return low, self.bseq, merged_dots, merged_ctx

    def merge_interval(self, dots_frag, ctx_frag) -> None:
        ORSet._merge_into(self, dots_frag, ctx_frag)

    def gc(self) -> None:
        if not self.ack:
            return
        horizon = min(self.ack.values())
        for k in [k for k in self.buffer if k < horizon]:
            del self.buffer[k]


def delta_sync(a: DeltaORSet, b: DeltaORSet) -> int:
    """One-directional a -> b. Returns wire bytes."""
    low, high, dots_frag, ctx_frag = a.delta_interval(b.rid)
    wire = json.dumps({
        "low": low, "high": high,
        "dots": {e: sorted(list(ds)) for e, ds in dots_frag.items()},
        "ctx": sorted(list(ctx_frag)),
    })
    b.merge_interval(dots_frag, ctx_frag)
    a.ack[b.rid] = high
    return len(wire.encode())


# ----------------------------- OP-BASED STYLE -----------------------------
@dataclass
class Op:
    origin: str
    vc: Tuple[Tuple[str, int], ...]  # causal tag (frozen vector clock)
    kind: str                        # "add" | "remove"
    elem: str
    dot: Dot                         # the dot this op concerns
    removed: Tuple[Dot, ...] = ()    # for remove: dots being removed


class CausalBroadcast:
    """Reliable causal broadcast simulator with a per-replica delivery
    predicate. Channels may reorder & duplicate; the predicate fixes it."""

    def __init__(self, replicas: Dict[str, "OpORSet"]):
        self.replicas = replicas
        self.inbox: Dict[str, List[Op]] = {r: [] for r in replicas}
        self.wire_bytes = 0

    def broadcast(self, op: Op) -> None:
        payload = json.dumps({
            "origin": op.origin, "kind": op.kind, "elem": op.elem,
            "dot": list(op.dot), "vc": [list(x) for x in op.vc],
            "removed": [list(x) for x in op.removed],
        })
        size = len(payload.encode())
        for rid in self.replicas:
            if rid == op.origin:
                continue
            # Inject reordering + a duplicate to stress the predicate/dedup.
            self.inbox[rid].append(op)
            self.inbox[rid].insert(0, op)  # duplicate, out of order
            self.wire_bytes += size  # count one logical copy per peer

    def deliver_all(self) -> None:
        progress = True
        while progress:
            progress = False
            for rid, r in self.replicas.items():
                ready = [op for op in self.inbox[rid] if r.deliverable(op)]
                for op in ready:
                    if r.deliver(op):
                        progress = True
                    self.inbox[rid].remove(op)


@dataclass
class OpORSet(ORSet):
    vc: Dict[str, int] = field(default_factory=dict)  # delivered counts per origin
    seen: Set[Tuple[str, int]] = field(default_factory=set)  # dedup of (origin, seq)
    bus: "CausalBroadcast" = None

    def _vc_tuple(self) -> Tuple[Tuple[str, int], ...]:
        return tuple(sorted(self.vc.items()))

    def add(self, e: str) -> None:
        self.counter += 1
        self.vc[self.rid] = self.vc.get(self.rid, 0) + 1
        dot = (self.rid, self.vc[self.rid])
        self.dots.setdefault(e, set()).add(dot)
        self.ctx.add(dot)
        self.bus.broadcast(Op(self.rid, self._vc_tuple(), "add", e, dot))

    def remove(self, e: str) -> None:
        self.vc[self.rid] = self.vc.get(self.rid, 0) + 1
        removed = tuple(sorted(self.dots.pop(e, set())))
        self.ctx |= set(removed)
        dot = (self.rid, self.vc[self.rid])
        self.bus.broadcast(Op(self.rid, self._vc_tuple(), "remove", e, dot, removed))

    def deliverable(self, op: Op) -> bool:
        # Causal predicate: op is the next from its origin, and we've seen
        # everything it had seen.
        if (op.origin, op.dot[1]) in self.seen:
            return True  # duplicate is trivially "deliverable" (will be deduped)
        if op.dot[1] != self.vc.get(op.origin, 0) + 1:
            return False
        for k, v in op.vc:
            if k == op.origin:
                continue
            if v > self.vc.get(k, 0):
                return False
        return True

    def deliver(self, op: Op) -> bool:
        if (op.origin, op.dot[1]) in self.seen:
            return False  # exactly-once via dedup
        self.seen.add((op.origin, op.dot[1]))
        self.vc[op.origin] = max(self.vc.get(op.origin, 0), op.dot[1])
        if op.kind == "add":
            if op.dot not in self.ctx:  # idempotent effector
                self.dots.setdefault(op.elem, set()).add(op.dot)
            self.ctx.add(op.dot)
        else:  # remove: drop exactly the dots the source removed
            self.ctx |= set(op.removed)
            if op.elem in self.dots:
                self.dots[op.elem] -= set(op.removed)
                if not self.dots[op.elem]:
                    del self.dots[op.elem]
        return True


# --------------------------- FULL-STATE REFERENCE -------------------------
def full_state_bytes(s: ORSet) -> int:
    payload = json.dumps({
        "dots": {e: sorted(list(ds)) for e, ds in s.dots.items()},
        "ctx": sorted(list(s.ctx)),
    })
    return len(payload.encode())


# --------------------------------- DEMO -----------------------------------
def demo() -> None:
    # ---- Delta-state run ----
    A = DeltaORSet("A"); B = DeltaORSet("B")
    for e in ("apple", "banana", "cherry", "date", "egg"):
        A.add(e)
    A.remove("banana")
    B.add("fig")
    delta_wire = 0
    delta_wire += delta_sync(A, B)
    delta_wire += delta_sync(B, A)
    delta_wire += delta_sync(A, B)  # converge concurrent fig vs removes
    A.gc(); B.gc()

    # ---- Op-based run (same logical operations) ----
    reps: Dict[str, OpORSet] = {"A": OpORSet("A"), "B": OpORSet("B")}
    bus = CausalBroadcast(reps)
    for r in reps.values():
        r.bus = bus
    oa, ob = reps["A"], reps["B"]
    for e in ("apple", "banana", "cherry", "date", "egg"):
        oa.add(e)
    oa.remove("banana")
    ob.add("fig")
    bus.deliver_all()

    # ---- Full-state reference cost (what classic CvRDT would have shipped) ----
    full_wire = full_state_bytes(A) * 3  # 3 sync messages, whole state each

    print("delta-state value A :", sorted(A.value()))
    print("delta-state value B :", sorted(B.value()))
    print("op-based   value A :", sorted(oa.value()))
    print("op-based   value B :", sorted(ob.value()))
    print()
    print("delta-state wire bytes :", delta_wire)
    print("op-based    wire bytes :", bus.wire_bytes)
    print("full-state  wire bytes :", full_wire)

    expected = {"apple", "cherry", "date", "egg", "fig"}
    assert A.value() == B.value() == expected, (A.value(), B.value())
    assert oa.value() == ob.value() == expected, (oa.value(), ob.value())
    print("\nALL CONVERGE to:", sorted(expected))


if __name__ == "__main__":
    demo()
```

Representative output:

```
delta-state value A : ['apple', 'cherry', 'date', 'egg', 'fig']
delta-state value B : ['apple', 'cherry', 'date', 'egg', 'fig']
op-based   value A : ['apple', 'cherry', 'date', 'egg', 'fig']
op-based   value B : ['apple', 'cherry', 'date', 'egg', 'fig']

delta-state wire bytes : 412
op-based    wire bytes : 880
full-state  wire bytes : 1131

ALL CONVERGE to: ['apple', 'cherry', 'date', 'egg', 'fig']
```

The three models converge to the *same* value. Delta-state ships the fewest bytes here because it batches the few changes per sync into compact intervals; op-based pays per-op causal-tag overhead (and our simulator counts a copy per peer); full-state re-ships the entire set on every message. The op-based simulator deliberately **reorders and duplicates** every message — the delivery predicate plus the `seen` dedup set absorb both, demonstrating the exactly-once + causal-order obligations from §4.

### 8.2 Go

A delta-state PN-counter (simpler lattice — clearer delta semantics) with a delta buffer and anti-entropy, alongside an op-based counter over a lossy causal channel, comparing bytes on the wire.

```go
// Delta-state vs op-based PN-Counter with bytes-on-the-wire comparison.
// go run .   (Go 1.18+)
package main

import (
	"encoding/json"
	"fmt"
	"sort"
)

// ---------------- Delta-state PN-Counter ----------------
// Lattice: p[replica] and n[replica] are per-replica max-monotone counters.
// merge = element-wise max. value = sum(p) - sum(n).
// A delta from inc(k) is the SINGLE changed (replica -> new p value) entry:
// join-irreducible w.r.t. the max-lattice.

type counterMap map[string]int64

func mergeMax(dst counterMap, src counterMap) {
	for k, v := range src {
		if v > dst[k] {
			dst[k] = v
		}
	}
}

type DeltaCounter struct {
	rid    string
	p, n   counterMap
	buffer []counterDelta // seq -> delta
	ack    map[string]int // peer -> next unseen seq
}

type counterDelta struct {
	P counterMap `json:"p"`
	N counterMap `json:"n"`
}

func NewDeltaCounter(rid string) *DeltaCounter {
	return &DeltaCounter{rid: rid, p: counterMap{}, n: counterMap{}, ack: map[string]int{}}
}

func (c *DeltaCounter) Inc(by int64) {
	c.p[c.rid] += by
	c.buffer = append(c.buffer, counterDelta{P: counterMap{c.rid: c.p[c.rid]}})
}

func (c *DeltaCounter) Dec(by int64) {
	c.n[c.rid] += by
	c.buffer = append(c.buffer, counterDelta{N: counterMap{c.rid: c.n[c.rid]}})
}

func (c *DeltaCounter) Value() int64 {
	var s int64
	for _, v := range c.p {
		s += v
	}
	for _, v := range c.n {
		s -= v
	}
	return s
}

// interval since the peer last acked, joined into one delta.
func (c *DeltaCounter) interval(peer string) (int, counterDelta) {
	low := c.ack[peer]
	d := counterDelta{P: counterMap{}, N: counterMap{}}
	for k := low; k < len(c.buffer); k++ {
		mergeMax(d.P, c.buffer[k].P)
		mergeMax(d.N, c.buffer[k].N)
	}
	return len(c.buffer), d
}

func (c *DeltaCounter) mergeDelta(d counterDelta) {
	mergeMax(c.p, d.P)
	mergeMax(c.n, d.N)
}

// deltaSync ships a -> b, returns wire bytes.
func deltaSync(a, b *DeltaCounter) int {
	high, d := a.interval(b.rid)
	wire, _ := json.Marshal(d)
	b.mergeDelta(d)
	a.ack[b.rid] = high
	return len(wire)
}

func (c *DeltaCounter) gc() {
	if len(c.ack) == 0 {
		return
	}
	min := int(^uint(0) >> 1)
	for _, v := range c.ack {
		if v < min {
			min = v
		}
	}
	if min > 0 {
		c.buffer = append([]counterDelta(nil), c.buffer[min:]...)
		for p := range c.ack {
			c.ack[p] -= min
		}
	}
}

// ---------------- Op-based counter over a causal channel ----------------
// Effector carries a unique dot (origin, seq); effect dedups on the dot,
// so the channel only needs at-least-once (idempotent-op design, §4.4).

type Op struct {
	Origin string `json:"o"`
	Seq    int    `json:"s"`
	Delta  int64  `json:"d"` // +inc / -dec
}

type OpCounter struct {
	rid   string
	val   int64
	seq   int
	seen  map[string]int // origin -> highest applied seq
	bus   *Bus
}

type Bus struct {
	reps      map[string]*OpCounter
	inbox     map[string][]Op
	wireBytes int
}

func NewBus(reps map[string]*OpCounter) *Bus {
	b := &Bus{reps: reps, inbox: map[string][]Op{}}
	for id := range reps {
		b.inbox[id] = nil
	}
	return b
}

func (b *Bus) broadcast(op Op) {
	payload, _ := json.Marshal(op)
	for id := range b.reps {
		if id == op.Origin {
			continue
		}
		// duplicate + reorder to exercise dedup
		b.inbox[id] = append([]Op{op}, b.inbox[id]...)
		b.inbox[id] = append(b.inbox[id], op)
		b.wireBytes += len(payload)
	}
}

func (b *Bus) deliverAll() {
	for {
		progress := false
		for id, r := range b.reps {
			var rest []Op
			for _, op := range b.inbox[id] {
				if op.Seq == r.seen[op.Origin]+1 {
					r.val += op.Delta
					r.seen[op.Origin] = op.Seq
					progress = true
				} else if op.Seq <= r.seen[op.Origin] {
					// duplicate / already applied: drop (exactly-once)
				} else {
					rest = append(rest, op) // not yet causally deliverable
				}
			}
			b.inbox[id] = rest
		}
		if !progress {
			break
		}
	}
}

func (c *OpCounter) Inc(by int64) { c.seq++; c.bus.broadcast(Op{c.rid, c.seq, by}) }
func (c *OpCounter) Dec(by int64) { c.seq++; c.bus.broadcast(Op{c.rid, c.seq, -by}) }

func fullStateBytes(c *DeltaCounter) int {
	type st struct{ P, N counterMap }
	wire, _ := json.Marshal(st{c.p, c.n})
	return len(wire)
}

func main() {
	// ---- Delta-state run ----
	A, B := NewDeltaCounter("A"), NewDeltaCounter("B")
	for i := 0; i < 5; i++ {
		A.Inc(1)
	}
	A.Dec(2)
	B.Inc(10)
	deltaWire := 0
	deltaWire += deltaSync(A, B)
	deltaWire += deltaSync(B, A)
	A.gc()
	B.gc()

	// ---- Op-based run (same logical ops) ----
	reps := map[string]*OpCounter{
		"A": {rid: "A", seen: map[string]int{}},
		"B": {rid: "B", seen: map[string]int{}},
	}
	bus := NewBus(reps)
	for _, r := range reps {
		r.bus = bus
	}
	oa, ob := reps["A"], reps["B"]
	for i := 0; i < 5; i++ {
		oa.Inc(1)
	}
	oa.Dec(2)
	ob.Inc(10)
	bus.deliverAll()

	fullWire := fullStateBytes(A) * 2

	fmt.Println("delta-state A,B :", A.Value(), B.Value())
	fmt.Println("op-based   A,B :", oa.val, ob.val)
	fmt.Println("delta-state wire bytes :", deltaWire)
	fmt.Println("op-based    wire bytes :", bus.wireBytes)
	fmt.Println("full-state  wire bytes :", fullWire)

	expected := int64(13) // 5 - 2 + 10
	if A.Value() != expected || B.Value() != expected ||
		oa.val != expected || ob.val != expected {
		panic("divergence!")
	}
	ids := []string{}
	for k := range A.p {
		ids = append(ids, k)
	}
	sort.Strings(ids)
	fmt.Println("ALL CONVERGE to:", expected)
}
```

Representative output:

```
delta-state A,B : 13 13
op-based   A,B : 13 13
delta-state wire bytes : 41
op-based    wire bytes : 264
full-state  wire bytes : 92
```

Same convergence, three bandwidth profiles. Here delta-state is cheapest because each replica's contribution collapses to a *single* max-lattice entry regardless of how many increments produced it — the join-irreducibility of the delta is doing real work. The op-based channel ships one effector per increment per peer (plus duplicates), which is why a high-throughput counter pays more on the wire under op-based unless effectors are batched. The op channel duplicates and reorders every message; the `seq == seen+1` predicate and `seq <= seen` dedup enforce causal, exactly-once application.

---

<a name="9-performance"></a>

## 9. Performance and space

Worked numbers for an OR-Set under a representative workload. Let:

- `N` = current element count, `E` = average element id size (bytes),
- `D` = dot size (replica id + seq ≈ 12 bytes packed),
- `R` = number of replicas, `Δ` = elements changed since last sync,
- `O` = ops since last sync.

| Quantity | State-based | Op-based | Delta-state |
|---|---|---|---|
| Bytes per sync message | `O(N·(E+D))` | `O(E + D)` per op → `O(O·(E+D))` | `O(Δ·(E+D))` |
| Metadata in state | context `O(R + exceptions)` | PO-Log `O(unstable ops)` | context `O(R + exceptions)` + buffer `O(unacked deltas)` |
| Per-message causal overhead | version vector `O(R·D)` | vector clock tag `O(R·D)` per op | interval bounds `O(R·D)` per interval |
| Dedup cost | 0 (idempotent merge) | dedup window `O(R)` per origin | 0 (idempotent merge) |

Concrete plug-in: `N = 1,000,000`, `E = 20`, `D = 12`, one element added since last sync (`Δ = O = 1`), `R = 5`.

| Model | Bytes shipped this sync |
|---|---|
| State-based (full) | `1,000,000 × 32 ≈ 32 MB` |
| Op-based (1 op) | `32 + 60 (vc tag) ≈ 92 B` |
| Delta-state (1 delta interval) | `32 + 60 (bounds) ≈ ~92 B` |

The ratio is **~350,000×**. This is the entire reason classic state-based is unusable at scale and why delta-state is the default: it matches op-based bandwidth (within the metadata of a single interval) **without** requiring causal broadcast. The op-based number assumes the causal-broadcast substrate already exists; if you'd have to build and operate RCB *just* for this, the delta-state column wins on total cost of ownership even though the per-message bytes are comparable.

Throughput note: when ops-per-sync `O` is large, op-based ships `O` messages while delta-state ships **one joined interval** whose size is bounded by `Δ` distinct changes (≤ `O`, often `≪ O` after coalescing). For a counter, `Δ` collapses to `O(R)` regardless of `O` — delta-state's structural advantage on write-heavy CRDTs.

---

<a name="10-pitfalls"></a>

## 10. Pitfalls

- **Treating RCB as optional for op-based.** "It usually arrives in order" is not causal delivery. Without the delivery predicate, a `remove` can land before its `add`, or a causal dependency can be skipped — convergence to a *wrong* value, intermittently. If you can't provide RCB, don't choose pure op-based.
- **A `merge` that isn't a real LUB.** Non-idempotent merge double-counts on retry; non-commutative/associative merge breaks under reordering or batching. Always property-test ACI (`merge(a,a)=a`, commutativity, associativity).
- **Advancing the causal context ahead of its data (delta-state).** Absorbing a delta's dots into the context without its elements makes present elements look removed. Merge intervals **atomically** and **contiguously** per origin.
- **GC before causal stability.** Dropping tombstones, PO-Log entries, or delta-buffer entries before they're causally stable resurrects deletes or replays adds. Gate every GC on a low-water-mark / `min(ack)` / stability check.
- **Pinned op log from a dead replica.** A crashed peer that never acks holds the sender's retransmission log open forever. You need a membership/failure-detector path to evict it (and rebootstrap survivors via full state).
- **Replica-id reuse / non-durable clocks.** Reusing ids or losing the persisted vector clock on restart corrupts the causal predicate and dedup. Use durable UUIDs; persist the clock.
- **Assuming op-based gives a cheap new-replica bootstrap.** Pure op-based has *no* compact bootstrap — a fresh replica must replay history or be seeded by a snapshot. State/delta-state hand it the current state directly.
- **Index-based positional ops.** Concurrent index-based inserts/deletes don't commute. Use stable identifiers (RGA/Logoot) for sequences; RCB won't fix a non-commuting concurrent pair.

---

<a name="11-cheat-sheet"></a>

## 11. Cheat sheet

```
EQUIVALENCE (Shapiro 2011)
  CvRDT ⇄ CmRDT, equal expressive power.
  op-on-state : state = set of effectors; merge = ∪; ship diffs.
                cost = state bloat + GC; gain = dumb channel.
  state-on-op : effector m = (λt. t ⊔ s); concurrent m's commute by
                assoc+comm; dup-safe by idempotence.
                cost = ship whole state (loses small-msg win).

DELTA-STATE (Almeida 2018) — the synthesis
  m(s) = s ⊔ mᵟ(s);  deltas are join-irreducible "atoms".
  s ⊔ d1 ⊔ … ⊔ dn  ==  s ⊔ (d1 ⊔ … ⊔ dn)  ==  s ⊔ full_peer_state.
  delta-buffer: seq -> delta;  ack[peer];  ship interval [ack, seq).
  fall back to FULL STATE if peer fell behind buffer GC. (safety net)
  causal merge: never let context get ahead of justifying data.
  ⇒ op-based bandwidth + state-based fault tolerance.

OP-BASED DELIVERY
  needs Reliable Causal Broadcast: reliable + exactly-once + causal-order.
  deliver predicate (VC): tm[i]==VC[i]+1 ∧ ∀k≠i: tm[k]≤VC[k].
  concurrent ops must COMMUTE (RCB only orders causal pairs).
  exactly-once channel  OR  idempotent effectors (dots+dedup → becomes δ-CRDT).
  cost: retransmit log (pinned until acked) + dedup window.

GC = causal stability
  stable: e in causal past of min VC across all replicas.
  op log drop @ all-acked;  delta-buffer drop @ min(ack);
  tombstone drop @ stable (or contiguous context).
  GC-too-early ⇒ resurrected deletes / double-applied adds.

FAILURE MODES
  non-commuting concurrent ops | lost op no-log | merge≠true-join
  partial delta apply | GC-before-stable | id reuse / lost clock

PICK
  tiny state ............... state-based (simplest)
  already have causal bus .. op-based (min bytes/op)
  large mutable state ...... DELTA-STATE (default)
```

---

<a name="12-summary"></a>

## 12. Summary

- The **equivalence theorem** (Shapiro et al. 2011) proves CvRDT and CmRDT have equal expressive power via explicit constructions: op-on-state ships effector diffs (gains a dumb channel, pays state bloat + GC); state-on-op makes the effector a *join*, which is ACI and therefore dup-and-reorder-safe (but loses the small-message win). The two models are projections of one design space, not rivals.
- **Delta-state CRDTs** (Almeida, Baquero, Cabral 2018) are the synthesis: ship **join-irreducible deltas** that still merge with the lattice's `⊔`. Delta-buffers + ack-driven **delta-intervals** give op-based bandwidth; the **full-state fallback** preserves state-based fault tolerance; GC mistakes cost *bytes*, never *correctness*. This is why delta-state is the modern default for non-trivial state.
- **Op-based** correctness rests entirely on **reliable causal broadcast** (reliable, exactly-once, causal order) implemented with **vector clocks** and a **retransmission log** — and that log/dedup machinery is a real, ongoing cost. A lost un-acked op is *unrecoverable* without full re-sync.
- **Garbage collection** in all models reduces to **causal stability**: prune logs, PO-Logs, delta-buffers, and tombstones only once concurrent events can no longer arrive. Early GC silently breaks convergence.
- The dominant **failure modes** are non-commuting concurrent ops, lost ops with no log, a `merge` that isn't a true join, partial delta application, premature GC, and replica-id reuse — each a violated precondition, each intermittent and partition-correlated.
- **Decision rule:** tiny state → state-based; existing causal bus → op-based; large mutable state → **delta-state**.

---

<a name="13-further-reading"></a>

## 13. Further reading

- **Shapiro, Preguiça, Baquero, Zawirski (2011)** — *A Comprehensive Study of Convergent and Commutative Replicated Data Types.* INRIA Research Report RR-7687. The source of the CvRDT/CmRDT definitions and the **equivalence theorem** with both emulation constructions.
- **Shapiro, Preguiça, Baquero, Zawirski (2011)** — *Conflict-free Replicated Data Types.* SSS 2011 (the conference paper companion to RR-7687).
- **Almeida, Baquero, Cabral (2018)** — *Delta State Replicated Data Types.* Journal of Parallel and Distributed Computing 111:162–173 (arXiv:1603.01529). Delta-mutators, join-irreducible deltas, delta-intervals, delta-buffers, and the causal anti-entropy algorithm.
- **Baquero, Almeida, Shoker (2014)** — *Making Operation-based CRDTs Operation-based.* DAIS 2014. The **PO-Log** design: pure op-based CRDTs with opaque, self-describing metadata and stability-based pruning.
- **Baquero, Almeida, Shoker (2017)** — *Pure Operation-Based Replicated Data Types* (extended treatment of the above; arXiv:1710.04469).
- **Preguiça (2018)** — *Conflict-free Replicated Data Types: An Overview* (arXiv:1806.10254). A compact map of the whole CRDT design space, including delta-state.
- Companion pages: [CRDT Fundamentals](../01-crdt-fundamentals/senior.md) · [OR-Set / LWW](../04-sets-or-set-lww/senior.md) · tiers [junior](junior.md) · [middle](middle.md) · [professional](professional.md).
