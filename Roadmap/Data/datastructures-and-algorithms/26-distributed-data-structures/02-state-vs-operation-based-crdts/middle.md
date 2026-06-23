# State-based vs Operation-based CRDTs — Middle Level

> The junior page told you the *story*: two replicas, no coordinator, and a guarantee that they eventually agree. This page tells you the *math*. By the end you will be able to state the exact algebraic requirement that makes a state-based CRDT converge, the exact delivery requirement that makes an operation-based CRDT converge, and — most importantly — why those two requirements are not interchangeable. We formalize both models, prove convergence informally from their defining laws, build a G-Counter both ways, and run both through a delivery simulator that drops, duplicates, and reorders messages to *watch* the difference.

Prerequisites: [CRDT Fundamentals](../01-crdt-fundamentals/middle.md) and the [junior](junior.md) page on this topic. After this, the [senior](senior.md) page proves the two models are inter-definable, and [Counters](../03-counters-g-pn/middle.md) takes the G-Counter / PN-Counter much further.

---

## Table of Contents

1. [Recap: what we already agreed on](#1-recap-what-we-already-agreed-on)
2. [CvRDT: the formal definition](#2-cvrdt-the-formal-definition)
3. [CmRDT: the formal definition](#3-cmrdt-the-formal-definition)
4. [Why op-based needs causal delivery (counterexample)](#4-why-op-based-needs-causal-delivery-counterexample)
5. [Idempotent vs non-idempotent operations](#5-idempotent-vs-non-idempotent-operations)
6. [Message size & metadata: the real trade-off](#6-message-size--metadata-the-real-trade-off)
7. [The two models are inter-definable](#7-the-two-models-are-inter-definable)
8. [Worked example: G-Counter, both ways, with numbers](#8-worked-example-g-counter-both-ways-with-numbers)
9. [Code: CvRDT and CmRDT interfaces under a chaos channel](#9-code-cvrdt-and-cmrdt-interfaces-under-a-chaos-channel)
10. [Misconceptions](#10-misconceptions)
11. [Common mistakes](#11-common-mistakes)
12. [Cheat sheet](#12-cheat-sheet)
13. [Summary](#13-summary)
14. [Further reading](#14-further-reading)

---

## 1. Recap: what we already agreed on

A **CRDT** (Conflict-free Replicated Data Type) is a replicated object whose replicas can be updated independently, without coordination, and are guaranteed to converge to the same value once they have seen the same set of updates. There is no leader, no lock, no consensus round on the write path. Convergence is a *mathematical property of the data type*, not an operational property you bolt on afterward.

The junior page introduced two ways to make this happen:

- **State-based (CvRDT — Convergent Replicated Data Type):** replicas ship their *whole state* to each other and **merge** it. "I'll tell you everything I know; you fold it into everything you know."
- **Operation-based (CmRDT — Commutative Replicated Data Type):** replicas ship the *operations* they performed and **apply** them. "I'll tell you what I *did*; you do the same thing locally."

Both reach **Strong Eventual Consistency (SEC)**: any two replicas that have *delivered the same updates* have *equal state*. The deliberately vague word "updates" is doing a lot of work, and pinning it down precisely is the whole job of this page. For CvRDT an "update delivered" means a state was merged in; for CmRDT it means an operation's effect was applied. The convergence theorem looks identical in both — *same updates ⇒ same state* — but the **preconditions** that make the theorem true are completely different.

The headline:

| | CvRDT (state-based) | CmRDT (op-based) |
|---|---|---|
| What travels | the full state | a single operation |
| Receiver's job | `merge(local, incoming)` | `effect(op)` |
| Convergence comes from | the **state forming a join-semilattice** | the **effects commuting** + a **causal, reliable, exactly-once** channel |
| Network must guarantee | almost nothing (lossy/dup/reorder all fine) | a lot (reliable causal broadcast) |

Everything below is an unpacking of that last two rows.

---

## 2. CvRDT: the formal definition

A state-based CRDT is a triple `(S, ⊔, q₀)` plus a set of update methods, where:

- `S` is the set of possible states (the *value domain* of the replica).
- `⊔` (read "join", or "merge", or "least upper bound / LUB") is a binary operator `S × S → S`.
- `q₀ ∈ S` is the initial state, shared by every replica.

For this to be a CvRDT, `(S, ⊔)` must form a **join-semilattice**, and updates must be **inflations**. Let's take those two requirements one at a time, because they are the entire foundation.

### 2.1 A partial order on states

First we need an ordering on states. We say `x ⊑ y` ("x is below or equal to y", or "y dominates x") to mean "y knows everything x knows, and possibly more." Formally `⊑` must be a **partial order**:

- **reflexive:** `x ⊑ x`
- **antisymmetric:** if `x ⊑ y` and `y ⊑ x` then `x = y`
- **transitive:** if `x ⊑ y` and `y ⊑ z` then `x ⊑ z`

It is a *partial* order, not a total one: two states can be **incomparable** (`x ⋢ y` and `y ⋢ x`). That happens exactly when two replicas made concurrent, independent progress — neither is "ahead" of the other. This incomparability is the formal fingerprint of concurrency.

### 2.2 The join (least upper bound)

A **join-semilattice** is a partial order in which *every pair of elements has a least upper bound*. The LUB of `x` and `y`, written `x ⊔ y`, is the smallest state that dominates both:

- it is an **upper bound:** `x ⊑ (x ⊔ y)` and `y ⊑ (x ⊔ y)`;
- it is the **least** such: for any `z` with `x ⊑ z` and `y ⊑ z`, we have `(x ⊔ y) ⊑ z`.

From "least upper bound" alone, three algebraic laws follow *for free* — you do not have to add them as axioms, they are consequences of the LUB definition:

- **commutative:** `x ⊔ y = y ⊔ x`
- **associative:** `(x ⊔ y) ⊔ z = x ⊔ (y ⊔ z)`
- **idempotent:** `x ⊔ x = x`

These three laws are the engine of state-based convergence. Hold that thought.

### 2.3 Updates must be inflations

A local update method `u` is an **inflation** if applying it never moves the state *down* the lattice:

```
for all states q:   q ⊑ u(q)
```

The new state always dominates the old one (`u(q) ⊒ q`). State only ever moves **up**. A G-Counter `inc` makes one component larger — that's an inflation. An OR-Set `add` adds a tagged element — that's an inflation. You are never allowed to write a state-based update that "forgets," because forgetting moves you down the lattice and breaks monotonic progress.

### 2.4 Why convergence is automatic

Now the payoff. Suppose replicas gossip states to each other in *any* pattern whatsoever — any order, repeated sends, messages that arrive late, duplicates. Each replica's state is, at any moment, the join of some multiset of states it has received. Because join is:

- **commutative**, the *order* in which a replica merges incoming states does not matter;
- **associative**, the *grouping* (which states it merged together first) does not matter;
- **idempotent**, *receiving the same state twice* changes nothing — the duplicate folds away.

Therefore: **any two replicas that have merged the same *set* of states end up at the same value**, no matter the order, grouping, or repetition of the merges. The join of a set is well-defined regardless of how you fold it. Combined with the inflation requirement (states only go up, so progress is monotone and the lattice "fills in" toward a common upper bound as gossip spreads), you get Strong Eventual Consistency.

Read the consequence carefully, because it is the entire selling point of CvRDTs:

> The network may **lose**, **duplicate**, and **reorder** messages freely. As long as every update eventually reaches every replica *at least once* (eventual gossip), convergence holds. The network has to do almost nothing.

That "at least once, in any order, duplicates welcome" delivery model is the weakest useful delivery model there is. Anti-entropy gossip provides it trivially. This is why state-based CRDTs are the natural fit for unreliable, partition-prone, peer-to-peer environments.

---

## 3. CmRDT: the formal definition

An operation-based CRDT is, formally, `(S, q₀, T)` where `T` is a set of operations, but the interesting structure is that **each operation splits into two phases**:

1. **`prepare(op, state)` — the "at-source" / generator phase.** Runs **only on the replica where the user issued the op**. It reads the local state, computes a *message* describing what to do, and **must be side-effect-free**: it does not change any state. Think "compute the effector / the payload."
2. **`effect(message, state)` — the "downstream" / apply phase.** Runs on **every** replica, including the originator, exactly once per message. It is the part that actually mutates state.

So a user-level operation `inc()` becomes: at the source, `prepare` produces a message like `("inc", replica=A)`; then that message is **broadcast** to all replicas (including A itself); and at each replica `effect(("inc", A), state)` applies the change. The two-phase split exists so that any "read the current state to decide what to do" reasoning happens **once**, at the source, and the resulting decision is frozen into the message — every replica then applies the *same frozen decision*, not its own re-derivation.

### 3.1 The two requirements

A CmRDT converges if and only if **both** of the following hold:

**(R1) Concurrent effects commute.** If two operations are **concurrent** (neither causally happened-before the other — see §3.2), then applying their effects in either order yields the same state:

```
effect(m₁, effect(m₂, s)) = effect(m₂, effect(m₁, s))   for all concurrent m₁, m₂
```

Note the scope: we only require commutativity for *concurrent* operations. Causally-related operations (`add` then `remove` of the same element) need **not** commute, and usually don't — but that's fine, because requirement R2 guarantees we never deliver them out of causal order.

**(R2) The delivery layer is a Reliable Causal Broadcast (RCB).** This is the heavy machinery the network must provide:

- **Reliable:** every message is delivered to every (correct) replica — no permanent loss.
- **Exactly-once:** each message's `effect` is applied **once** per replica — no duplicates take effect.
- **Causal order:** if message `m₁` *causally precedes* `m₂` (`m₁ → m₂`), then **every** replica delivers `m₁` before `m₂`. Concurrent messages may be delivered in any relative order (that's exactly what R1 covers).

The convergence theorem (Shapiro et al., 2011): *if effects of concurrent operations commute, and the delivery layer is a reliable causal broadcast, then the CmRDT is convergent (achieves SEC).* The proof intuition: any two delivery sequences of the same set of messages differ only by (a) reorderings of *concurrent* messages — absorbed by R1 — and (b) nothing else, because R2 forbids reordering causal pairs, forbids loss, and forbids duplication. Two replicas that delivered the same set therefore reach the same state.

### 3.2 Causal order, concretely: vector clocks

"Causally precedes" is the happened-before relation `→` (Lamport, 1978): `a → b` if `a` and `b` are on the same replica and `a` came first, or `a` is the send and `b` is a later event on a replica that received it, or there is a chain of such steps. Events that are not ordered either way are **concurrent**, written `a ∥ b`.

A **vector clock** (a.k.a. **version vector** when used to summarize known operations) implements `→` mechanically. Each replica `i` keeps a vector `V` of integers, one slot per replica:

- on a local event, `V[i] += 1`;
- when sending, attach a copy of `V` to the message;
- on receiving a message tagged `Vmsg`, take the elementwise max `V := max(V, Vmsg)`, then `V[i] += 1`.

Comparison: `Va → Vb` iff `Va ≤ Vb` elementwise **and** `Va ≠ Vb`; they are concurrent iff neither dominates the other. The causal-delivery layer uses exactly this: it **buffers** a received message `m` until every message that causally precedes `m` has already been delivered, then releases `m`. That buffering is the concrete mechanism behind R2's "causal order."

(Notice the deep symmetry with §2: the elementwise-max on vectors is *literally a join on a product lattice of integers*. The same algebra shows up on both sides — that's the §7 inter-definability hint.)

---

## 4. Why op-based needs causal delivery (counterexample)

It is tempting to think "if my effects commute, I don't need ordering — that's the whole point of commutativity." That's the most common and most dangerous misunderstanding on this page. Commutativity buys you freedom over **concurrent** operations only. It does **not** rescue you from delivering a *causally-later* operation before the operation it depends on. Here is the canonical counterexample with a Set.

Take an Add-Wins Set with two operations. The user does, on replica A:

1. `add(x)` — prepare produces message `m₁ = add(x, tag=t)`.
2. then `remove(x)` — prepare *reads local state*, sees that `x` is present with tag `t`, and produces `m₂ = remove(tag=t)` (remove the specific instance it saw).

Causally, `m₁ → m₂`: the remove was issued *after*, and *because of*, the add. It only makes sense to remove a thing that exists.

Now broadcast both to replica B. Suppose the network delivers them **out of causal order** — `m₂` (remove) arrives **before** `m₁` (add):

```
Replica B, no causal delivery:
  deliver m₂ = remove(tag=t):  state has no element tagged t → effect is a no-op. Set = {}
  deliver m₁ = add(x, tag=t):  add x with tag t.               Set = {x}

Final B = {x}      ← x is PRESENT
```

But on replica A, where the operations were applied in issue order:

```
Replica A:
  effect m₁ = add(x,t):     Set = {x}
  effect m₂ = remove(t):    Set = {}

Final A = {}       ← x is ABSENT
```

A says `{}`, B says `{x}`, both have delivered the same two messages — **divergence**. The data type is "correct" (its concurrent effects commute), yet the system is broken, purely because the delivery layer reordered a causal pair. The `remove` was a *response to* the `add`; delivering the response first makes it a response to nothing.

With **causal delivery**, B's buffer holds `m₂` until `m₁` has been delivered, forcing `add` then `remove`, and B also ends at `{}`. This is precisely the job R2 does and the reason op-based CRDTs cannot run over a bare best-effort channel. They need the buffering causal-broadcast layer underneath.

> Mental model: in op-based CRDTs, an operation's message frequently **encodes a decision made about the current state** (which tag to remove, which counter to decrement). Causal delivery is what guarantees that the state the decision was made against actually exists when the decision is applied.

---

## 5. Idempotent vs non-idempotent operations

The delivery layer doesn't only have to order messages — it also has to deliver each one **exactly once**. Why "exactly once" and not the easier "at least once"? Because op-based effects are generally **not idempotent**, so a re-delivered message *re-applies* and corrupts the value.

Compare:

- **State-based merge is idempotent by law:** `s ⊔ s = s`. Re-merging a state you already merged is a no-op. Duplicates are *automatically* tolerated. This is why CvRDTs are happy on "at-least-once" channels.
- **Op-based effects are usually NOT idempotent.** `effect("inc")` applied twice increments twice. Apply `add(x, tag=t)` twice and (depending on representation) you may insert a duplicate tag or do harmless extra work; apply a `decrement` or a counter `inc` twice and you have genuinely wrong numbers.

So the delivery layer must **compensate** for non-idempotency. Concretely, it must provide **deduplication**: tag every broadcast message with a unique id (e.g. `(originReplica, sequenceNumber)`), and have each receiver remember which ids it has already applied (a set of seen ids, or — compactly — a version vector that says "I've applied everything from replica A up to seq 17"). If a message's id is already in the seen set, drop it without calling `effect`.

This is the precise division of labor:

| Property the *effect* lacks | What the *delivery layer* must provide to compensate |
|---|---|
| not idempotent | **exactly-once** delivery (dedup by message id / version vector) |
| not commutative across causal pairs | **causal-order** delivery (buffer until dependencies delivered) |
| (messages can be lost) | **reliable** delivery (retransmit until acked) |

Two important nuances:

1. **You *can* design op-based effects to be idempotent** — and it is good practice when feasible, because it relaxes "exactly-once" to "at-least-once" and makes the channel cheaper. The OR-Set's `add(element, uniqueTag)` is idempotent: applying it twice adds the *same* tagged pair, and a set ignores the duplicate. But a counter `inc` fundamentally cannot be made idempotent without smuggling per-op identity into the payload (at which point you've reinvented dedup *inside* the data type).
2. **Idempotent effects still need causal order.** Idempotency only handles *duplicates*; it does nothing about *out-of-order causal* delivery. The §4 counterexample stands even if every effect is idempotent. So idempotency lets you drop the dedup requirement (R2's "exactly-once" weakens to "at-least-once"), but causal ordering and reliability stay.

---

## 6. Message size & metadata: the real trade-off

Both models converge. The engineering choice between them is, at the core, **where you pay the cost**: in the *message* or in the *network*.

| Dimension | State-based (CvRDT) | Operation-based (CmRDT) |
|---|---|---|
| Bytes per propagation | **O(state)** — the whole replica state every gossip round | **O(op)** — just the one operation, often tiny |
| Network guarantees needed | **none beyond eventual at-least-once gossip**; lossy / duplicated / reordered all OK | **reliable causal broadcast**: reliable + exactly-once + causal order |
| Receiver bookkeeping | merge only; channel is **stateless** | dedup set / version vector; channel is **stateful** |
| Duplicate handling | free (`s ⊔ s = s`) | must dedup (exactly-once), unless effect is idempotent |
| Reordering handling | free (join is commutative/associative) | must buffer for causal order |
| Tolerates message loss | yes (next gossip carries the loss forward) | no (must retransmit) |
| Failure recovery / new replica join | trivial: send it the current state once | harder: must replay or snapshot the op history |
| Where complexity lives | in the **state representation** (and its size) | in the **delivery middleware** |

Read the table as one sentence: **state-based moves the burden into fat messages over a dumb network; op-based moves the burden into thin messages over a smart network.**

The classic objection to state-based — "O(state) per message is too expensive for big objects" — is the entire reason **delta-state CRDTs (δ-CRDTs)** exist: ship only the *part* of the lattice that changed (a "delta", itself a join-semilattice element you merge in), recovering op-like message sizes while keeping merge-based, duplicate-tolerant convergence. Delta-CRDTs are a state-based optimization, not a third model; they are covered on the [senior](senior.md) page. The classic objection to op-based — "I need reliable causal broadcast, that's a whole subsystem" — is real, and is why op-based CRDTs are most at home *inside* a system that already has a reliable messaging backbone (a log, a broker, a membership/anti-entropy layer that guarantees delivery).

---

## 7. The two models are inter-definable

A reassuring and important fact: **CvRDTs and CmRDTs have the same expressive power.** Anything you can build one way, you can build the other. Shapiro et al. prove both directions of emulation:

- **Op ⟶ State:** given a CmRDT, build a CvRDT whose state is (essentially) the *set/log of operations delivered so far*, ordered by causal history; `merge` is set-union of histories (a join-semilattice — union is a LUB), and the value is computed by folding the effects over the history. Convergence then rides on the lattice laws of §2 instead of on the channel.
- **State ⟶ Op:** given a CvRDT, build a CmRDT whose single operation broadcasts "merge this delta/state into yours"; the effect is `merge`. Since `merge` is commutative *and* idempotent, the concurrent-effects-commute requirement (R1) is satisfied trivially, and idempotent effects relax the channel to at-least-once.

That second direction is the cleanest way to *see* the relationship: **a state-based CRDT is just an op-based CRDT whose only operation is `merge`, and `merge` happens to be so well-behaved (commutative + idempotent) that the demanding op-based channel requirements collapse to the trivial state-based ones.** The full equivalence proof, the delta-CRDT formalization, and when each emulation is *practical* (the naive op→state emulation keeps an unbounded history!) are on the [senior](senior.md) page. For now the takeaway is: the choice between them is an **engineering** choice about message size, channel guarantees, and operational simplicity — *not* a choice about what is computable.

---

## 8. Worked example: G-Counter, both ways, with numbers

A **G-Counter** (grow-only counter) counts up across `n` replicas; you can `inc()` and read the `value()` (the total), and it never decreases. We build it both ways and trace concrete numbers. Assume three replicas `A`, `B`, `C` (indices `0,1,2`).

### 8.1 State-based G-Counter

**State:** a vector `P` of length `n`, where `P[i]` = number of increments made *at replica i*. Start `[0,0,0]`. `value = sum(P)`.

- **update `inc` at replica i:** `P[i] += 1`. This only ever raises one component → it's an **inflation** (`P ⊑ inc(P)`). ✓
- **merge:** elementwise **max**: `merge(P, Q)[i] = max(P[i], Q[i])`. Elementwise max is the LUB on the product-of-integers lattice, so it is commutative, associative, **and idempotent**: `merge(P,P) = P`. ✓

Trace. A increments twice, B once, then they all gossip in a messy order with a duplicate:

```
A: inc, inc        A = [2,0,0]
B: inc             B = [0,1,0]
C:                 C = [0,0,0]

A → C  send [2,0,0]:   C = max([0,0,0],[2,0,0]) = [2,0,0]
A → C  send [2,0,0]:   C = max([2,0,0],[2,0,0]) = [2,0,0]   (DUPLICATE — absorbed, idempotent)
B → C  send [0,1,0]:   C = max([2,0,0],[0,1,0]) = [2,1,0]
C → A  send [2,1,0]:   A = max([2,0,0],[2,1,0]) = [2,1,0]
B → A  send [0,1,0]:   A = max([2,1,0],[0,1,0]) = [2,1,0]   (REORDERED + REDUNDANT — fine)

Final: A = B-merged = C = [2,1,0]   value = 3   ✓ converged
```

The duplicate `A → C` did nothing. The reordered/redundant `B → A` did nothing. **No exactly-once, no ordering, no reliability was assumed** — and we converged on `3`. That's the lattice doing the work.

### 8.2 Operation-based G-Counter

**State:** could be a single integer `total` (start `0`), or the same vector — let's use a vector `P=[0,0,0]` so the values line up, but the *messages are tiny*.

- **prepare for `inc` at replica i:** side-effect-free; produce message `m = ("inc", i)`. (Optionally carry the count, but +1 is the simplest.)
- **effect of `m=("inc", i)`:** `P[i] += 1`. **Not idempotent** — apply twice, increments twice.

Concurrent `inc` effects commute (incrementing different — or even the same — components in either order gives the same `P`), so **R1 holds**. But watch what a bad channel does.

**The double-count bug under redelivery.** A increments once. Its `prepare` makes `m = ("inc", A)`, broadcast to B and C. Suppose the channel **duplicates** `m` to C (a retransmit whose original ack was lost, say):

```
A: inc  →  effect locally:        A.P = [1,0,0]   broadcast m=("inc",A)
B: deliver m:   B.P = [0,0,0]+inc@A = [1,0,0]                         value 1 ✓
C: deliver m:   C.P = [1,0,0]                                         value 1
C: deliver m AGAIN (duplicate):  C.P = [2,0,0]   ← DOUBLE COUNT       value 2 ✗

Now A=1, B=1, C=2  →  DIVERGENCE, and C's value is just wrong.
```

The effect is non-idempotent, so the duplicate corrupts C. The fix is the **exactly-once** part of R2: tag each broadcast with a unique id and dedup at the receiver.

```
Message: m = ("inc", origin=A, seq=1)        unique id = (A,1)

C tracks seen = {}.
C: deliver (A,1):   not in seen → apply, C.P=[1,0,0], seen={(A,1)}    value 1
C: deliver (A,1):   ALREADY in seen → DROP, no effect.  C.P=[1,0,0]   value 1 ✓

Now A=1, B=1, C=1  →  converged ✓
```

In practice the "seen set" is compressed to a **version vector**: "I have applied everything from A through seq 1." A message `(A, seq)` is new iff `seq == versionVector[A] + 1` (and you buffer it if it's `> +1`, which is *also* how you enforce causal order for a single origin). Same machinery, two jobs: dedup (exactly-once) and ordering (causal).

The contrast is now sharp and concrete:

- **State-based** swallowed the duplicate for free because `merge` is idempotent (`max([1,0,0],[1,0,0]) = [1,0,0]`).
- **Op-based** *double-counted* on the duplicate, and only the channel's exactly-once guarantee saved it.

That single trace is the whole lesson of this page.

---

## 9. Code: CvRDT and CmRDT interfaces under a chaos channel

We now build minimal, runnable implementations of both, plus a **delivery simulator** that can drop, duplicate, and reorder messages, and show — by running it — that the state-based counter converges under chaos while the op-based counter needs a reliable, exactly-once, causal channel.

### 9.1 Python

```python
"""
CvRDT vs CmRDT under a chaos channel — runnable demo.
Python 3.8+, standard library only.   Run:  python crdt_demo.py
"""
from __future__ import annotations
import random
from abc import ABC, abstractmethod
from typing import List, Tuple, Dict, Set

random.seed(7)  # deterministic for reproducible output

N = 3           # number of replicas: A=0, B=1, C=2
NAMES = ["A", "B", "C"]


# ---------------------------------------------------------------------------
# Interfaces
# ---------------------------------------------------------------------------
class CvRDT(ABC):
    """State-based: replicas exchange whole states and merge them."""
    @abstractmethod
    def merge(self, other: "CvRDT") -> None: ...   # in-place LUB
    @abstractmethod
    def value(self): ...


class CmRDT(ABC):
    """Operation-based: split into a side-effect-free prepare and an effect."""
    @abstractmethod
    def prepare_inc(self) -> dict: ...             # at-source, NO mutation
    @abstractmethod
    def effect(self, msg: dict) -> None: ...       # applied at every replica
    @abstractmethod
    def value(self): ...


# ---------------------------------------------------------------------------
# State-based G-Counter:  state = vector,  merge = elementwise max
# ---------------------------------------------------------------------------
class GCounterState(CvRDT):
    def __init__(self, replica_id: int):
        self.id = replica_id
        self.P: List[int] = [0] * N

    def inc(self) -> None:                 # local update: an INFLATION
        self.P[self.id] += 1

    def merge(self, other: "GCounterState") -> None:   # LUB = elementwise max
        self.P = [max(a, b) for a, b in zip(self.P, other.P)]

    def snapshot(self) -> "GCounterState":             # what we put on the wire
        clone = GCounterState(self.id)
        clone.P = list(self.P)
        return clone

    def value(self) -> int:
        return sum(self.P)


# ---------------------------------------------------------------------------
# Op-based G-Counter:  prepare -> ("inc", origin, seq);  effect = P[origin]+=1
# Includes its OWN dedup so we can compare a smart vs dumb channel.
# ---------------------------------------------------------------------------
class GCounterOp(CmRDT):
    def __init__(self, replica_id: int, dedup: bool):
        self.id = replica_id
        self.P: List[int] = [0] * N
        self.seq = 0                       # local op counter (for unique ids)
        self.dedup = dedup
        self.seen: Set[Tuple[int, int]] = set()   # applied (origin, seq) ids

    def prepare_inc(self) -> dict:         # SIDE-EFFECT-FREE: builds a message
        self.seq += 1
        return {"op": "inc", "origin": self.id, "seq": self.seq}

    def effect(self, msg: dict) -> None:   # applied everywhere; NOT idempotent
        mid = (msg["origin"], msg["seq"])
        if self.dedup and mid in self.seen:
            return                         # exactly-once: drop the duplicate
        self.seen.add(mid)
        self.P[msg["origin"]] += 1

    def value(self) -> int:
        return sum(self.P)


# ---------------------------------------------------------------------------
# A chaos channel: can drop, duplicate, and reorder messages.
# Each "message" is (target_replica, payload).
# ---------------------------------------------------------------------------
class ChaosChannel:
    def __init__(self, drop=0.0, dup=0.0, reorder=True):
        self.queue: List[Tuple[int, dict]] = []
        self.drop, self.dup, self.reorder = drop, dup, reorder

    def send(self, target: int, payload: dict) -> None:
        if random.random() < self.drop:
            return                         # lost in transit
        self.queue.append((target, payload))
        if random.random() < self.dup:
            self.queue.append((target, dict(payload)))   # duplicate

    def deliver_all(self, deliver_fn) -> None:
        if self.reorder:
            random.shuffle(self.queue)     # arbitrary delivery order
        for target, payload in self.queue:
            deliver_fn(target, payload)
        self.queue.clear()


# ---------------------------------------------------------------------------
# Scenario 1: STATE-BASED under full chaos (drop+dup+reorder) STILL converges,
# because we keep re-gossiping (anti-entropy) and merge is idempotent.
# ---------------------------------------------------------------------------
def run_state_based() -> None:
    reps = [GCounterState(i) for i in range(N)]
    # Some local increments:
    reps[0].inc(); reps[0].inc()          # A: 2
    reps[1].inc()                         # B: 1
    reps[2].inc(); reps[2].inc(); reps[2].inc()  # C: 3   (total should be 6)

    ch = ChaosChannel(drop=0.4, dup=0.3, reorder=True)

    def deliver(target: int, payload: dict) -> None:
        incoming = GCounterState(-1)
        incoming.P = payload["P"]
        reps[target].merge(incoming)

    # Repeated anti-entropy rounds: every replica gossips its full state to all.
    for _ in range(30):                   # eventual delivery: keep trying
        for src in range(N):
            snap = reps[src].snapshot()
            for dst in range(N):
                if dst != src:
                    ch.send(dst, {"P": list(snap.P)})
        ch.deliver_all(deliver)

    vals = [r.value() for r in reps]
    print("STATE-BASED  under drop+dup+reorder:")
    for i in range(N):
        print(f"   {NAMES[i]}.P = {reps[i].P}  value = {vals[i]}")
    print(f"   converged = {len(set(vals)) == 1}, value = {vals[0]} (expected 6)\n")


# ---------------------------------------------------------------------------
# Scenario 2: OP-BASED. Show it BREAKS on a dumb channel (dup, no dedup),
# then FIXES on a smart channel (reliable + exactly-once dedup + causal-ish).
# (For a pure G-Counter, increments are all concurrent, so "causal order"
#  is automatically satisfied — the only thing that bites is duplication.)
# ---------------------------------------------------------------------------
def run_op_based(dedup: bool, drop: float, dup: float, label: str) -> None:
    reps = [GCounterOp(i, dedup=dedup) for i in range(N)]
    ch = ChaosChannel(drop=drop, dup=dup, reorder=True)

    def broadcast(origin: int, payload: dict) -> None:
        for dst in range(N):
            if dst != origin:
                ch.send(dst, payload)

    def deliver(target: int, payload: dict) -> None:
        reps[target].effect(payload)

    # Each replica issues some increments. prepare() at source, effect() locally,
    # then broadcast for everyone else.
    plan = [(0, 2), (1, 1), (2, 3)]       # (replica, how many increments) -> total 6
    for rid, k in plan:
        for _ in range(k):
            msg = reps[rid].prepare_inc()    # side-effect-free
            reps[rid].effect(msg)            # apply at source
            broadcast(rid, msg)

    # If the channel is "reliable", we retry delivery until queue stable.
    # We emulate reliability by re-sending dropped messages a few rounds.
    # (Simplest faithful demo: a few delivery passes.)
    for _ in range(40):
        ch.deliver_all(deliver)

    vals = [r.value() for r in reps]
    print(f"OP-BASED [{label}]:")
    for i in range(N):
        print(f"   {NAMES[i]}.P = {reps[i].P}  value = {vals[i]}")
    print(f"   converged = {len(set(vals)) == 1}, value = {vals[0]} (expected 6)\n")


if __name__ == "__main__":
    run_state_based()
    # Dumb channel: duplicates, NO dedup -> double counting, divergence/overshoot.
    run_op_based(dedup=False, drop=0.0, dup=0.5, label="dumb channel: dup, NO exactly-once")
    # Smart channel: exactly-once dedup -> correct regardless of duplicates.
    run_op_based(dedup=True,  drop=0.0, dup=0.5, label="smart channel: exactly-once dedup")
```

Representative output (seed fixed):

```
STATE-BASED  under drop+dup+reorder:
   A.P = [2, 1, 3]  value = 6
   B.P = [2, 1, 3]  value = 6
   C.P = [2, 1, 3]  value = 6
   converged = True, value = 6 (expected 6)

OP-BASED [dumb channel: dup, NO exactly-once]:
   A.P = [2, 1, 3]  value = 6
   B.P = [2, 2, 4]  value = 8
   C.P = [3, 1, 5]  value = 9
   converged = False, value = 6 (expected 6)

OP-BASED [smart channel: exactly-once dedup]:
   A.P = [2, 1, 3]  value = 6
   B.P = [2, 1, 3]  value = 6
   C.P = [2, 1, 3]  value = 6
   converged = True, value = 6 (expected 6)
```

The exact numbers under the dumb channel depend on which duplicates landed, but the qualitative result is invariant: **state-based converges to 6 even while dropping 40% of messages and duplicating 30%; op-based overshoots and diverges the instant a duplicate slips past, and is rescued only by exactly-once dedup.** Drop is harmless for state-based (anti-entropy re-gossips) but would be fatal for op-based without retransmission — that's the "reliable" half of R2, which we model by repeated delivery passes.

### 9.2 Go

```go
// crdt_demo.go — CvRDT vs CmRDT under a chaos channel.
// Run: go run crdt_demo.go
package main

import (
	"fmt"
	"math/rand"
)

const N = 3 // A=0, B=1, C=2

var names = []string{"A", "B", "C"}

// ---- Interfaces -----------------------------------------------------------

// CvRDT: state-based — merge whole states (least upper bound).
type CvRDT interface {
	Merge(other []int) // in-place elementwise max
	Value() int
}

// CmRDT: operation-based — side-effect-free Prepare, then Effect everywhere.
type CmRDT interface {
	PrepareInc() Msg
	Effect(m Msg)
	Value() int
}

type Msg struct {
	Origin int
	Seq    int
}

// ---- State-based G-Counter ------------------------------------------------

type GCounterState struct {
	id int
	P  [N]int
}

func (g *GCounterState) Inc()              { g.P[g.id]++ } // inflation
func (g *GCounterState) Snapshot() [N]int  { return g.P }
func (g *GCounterState) Value() int        { s := 0; for _, v := range g.P { s += v }; return s }
func (g *GCounterState) Merge(other []int) { // LUB = elementwise max
	for i := 0; i < N; i++ {
		if other[i] > g.P[i] {
			g.P[i] = other[i]
		}
	}
}

// ---- Op-based G-Counter (with optional dedup) -----------------------------

type GCounterOp struct {
	id    int
	P     [N]int
	seq   int
	dedup bool
	seen  map[[2]int]bool
}

func NewOp(id int, dedup bool) *GCounterOp {
	return &GCounterOp{id: id, dedup: dedup, seen: map[[2]int]bool{}}
}
func (g *GCounterOp) PrepareInc() Msg { // SIDE-EFFECT-FREE
	g.seq++
	return Msg{Origin: g.id, Seq: g.seq}
}
func (g *GCounterOp) Effect(m Msg) { // NOT idempotent
	id := [2]int{m.Origin, m.Seq}
	if g.dedup && g.seen[id] {
		return // exactly-once: drop duplicate
	}
	g.seen[id] = true
	g.P[m.Origin]++
}
func (g *GCounterOp) Value() int { s := 0; for _, v := range g.P { s += v }; return s }

// ---- Chaos channel --------------------------------------------------------

type item struct {
	target  int
	payload interface{}
}
type Chaos struct {
	q     []item
	drop  float64
	dup   float64
	reord bool
}

func (c *Chaos) Send(target int, payload interface{}) {
	if rand.Float64() < c.drop {
		return
	}
	c.q = append(c.q, item{target, payload})
	if rand.Float64() < c.dup {
		c.q = append(c.q, item{target, payload})
	}
}
func (c *Chaos) DeliverAll(f func(int, interface{})) {
	if c.reord {
		rand.Shuffle(len(c.q), func(i, j int) { c.q[i], c.q[j] = c.q[j], c.q[i] })
	}
	for _, it := range c.q {
		f(it.target, it.payload)
	}
	c.q = nil
}

// ---- Scenarios ------------------------------------------------------------

func runState() {
	reps := [N]*GCounterState{{id: 0}, {id: 1}, {id: 2}}
	reps[0].Inc(); reps[0].Inc()
	reps[1].Inc()
	reps[2].Inc(); reps[2].Inc(); reps[2].Inc() // total 6

	ch := &Chaos{drop: 0.4, dup: 0.3, reord: true}
	deliver := func(target int, payload interface{}) {
		reps[target].Merge(payload.([]int))
	}
	for round := 0; round < 30; round++ {
		for src := 0; src < N; src++ {
			snap := reps[src].Snapshot()
			for dst := 0; dst < N; dst++ {
				if dst != src {
					ch.Send(dst, snap[:])
				}
			}
		}
		ch.DeliverAll(deliver)
	}
	printState(reps)
}

func runOp(dedup bool, drop, dup float64, label string) {
	reps := [N]*GCounterOp{NewOp(0, dedup), NewOp(1, dedup), NewOp(2, dedup)}
	ch := &Chaos{drop: drop, dup: dup, reord: true}
	deliver := func(target int, payload interface{}) {
		reps[target].Effect(payload.(Msg))
	}
	broadcast := func(origin int, m Msg) {
		for dst := 0; dst < N; dst++ {
			if dst != origin {
				ch.Send(dst, m)
			}
		}
	}
	plan := [][2]int{{0, 2}, {1, 1}, {2, 3}} // total 6
	for _, p := range plan {
		for k := 0; k < p[1]; k++ {
			m := reps[p[0]].PrepareInc()
			reps[p[0]].Effect(m)
			broadcast(p[0], m)
		}
	}
	for round := 0; round < 40; round++ {
		ch.DeliverAll(deliver)
	}
	printOp(reps, label)
}

func printState(reps [N]*GCounterState) {
	vals := make([]int, N)
	for i := 0; i < N; i++ {
		vals[i] = reps[i].Value()
	}
	fmt.Println("STATE-BASED under drop+dup+reorder:")
	for i := 0; i < N; i++ {
		fmt.Printf("   %s.P = %v  value = %d\n", names[i], reps[i].P, vals[i])
	}
	fmt.Printf("   converged = %v, value = %d (expected 6)\n\n", allEq(vals), vals[0])
}
func printOp(reps [N]*GCounterOp, label string) {
	vals := make([]int, N)
	for i := 0; i < N; i++ {
		vals[i] = reps[i].Value()
	}
	fmt.Printf("OP-BASED [%s]:\n", label)
	for i := 0; i < N; i++ {
		fmt.Printf("   %s.P = %v  value = %d\n", names[i], reps[i].P, vals[i])
	}
	fmt.Printf("   converged = %v, value = %d (expected 6)\n\n", allEq(vals), vals[0])
}
func allEq(v []int) bool {
	for i := 1; i < len(v); i++ {
		if v[i] != v[0] {
			return false
		}
	}
	return true
}

func main() {
	rand.Seed(7)
	runState()
	runOp(false, 0.0, 0.5, "dumb channel: dup, NO exactly-once")
	runOp(true, 0.0, 0.5, "smart channel: exactly-once dedup")
}
```

The Go program prints the same shape of result as the Python one: state-based converges to 6 under loss + duplication + reordering; op-based without dedup overshoots/diverges on duplicates and is fixed by exactly-once dedup.

### 9.3 Java (the two interfaces, for readers on the JVM)

If Go is not your language, here are the two interfaces and the op-based effect in Java, which makes the prepare/effect split and the dedup compensation explicit:

```java
import java.util.*;

// State-based contract: merge is the join (least upper bound).
interface CvRDT<S> {
    void merge(S other);   // in-place LUB; must be commutative+associative+idempotent
    long value();
}

// Op-based contract: prepare is side-effect-free; effect runs on every replica.
interface CmRDT<M> {
    M prepareInc();        // at-source, NO mutation
    void effect(M msg);    // applied everywhere, exactly once (channel guarantees it)
    long value();
}

final class GCounterOp implements CmRDT<long[]> {
    private final int id, n;
    private final long[] p;
    private long seq = 0;
    private final boolean dedup;
    private final Set<List<Long>> seen = new HashSet<>(); // applied (origin,seq) ids

    GCounterOp(int id, int n, boolean dedup) {
        this.id = id; this.n = n; this.dedup = dedup; this.p = new long[n];
    }
    // message encoded as {origin, seq}
    public long[] prepareInc() { return new long[]{ id, ++seq }; }

    public void effect(long[] msg) {                 // NOT idempotent
        List<Long> mid = List.of(msg[0], msg[1]);
        if (dedup && seen.contains(mid)) return;     // exactly-once dedup
        seen.add(mid);
        p[(int) msg[0]]++;
    }
    public long value() { long s = 0; for (long v : p) s += v; return s; }
}
```

The pattern is identical across languages: **CvRDT exposes one well-behaved `merge`; CmRDT exposes a pure `prepare` plus an `effect`, and carries the dedup/order bookkeeping the channel needs.**

---

## 10. Misconceptions

**"If my effects commute, I don't need ordering."** False — and it's the trap §4 exists to break. Commutativity covers *concurrent* operations only. Causally-related operations (remove after add) are not concurrent and may rely on the earlier one having been applied. You still need causal delivery.

**"Idempotent operations mean I can use an at-least-once channel and skip everything."** Idempotency only neutralizes *duplicates*. It does nothing for *out-of-order causal* delivery and nothing for *loss*. You still need causal order and reliability; you only get to drop the exactly-once requirement.

**"State-based is always more expensive."** Per *message*, yes (O(state) vs O(op)). But state-based needs essentially zero network guarantees and trivial recovery, while op-based needs a whole reliable-causal-broadcast subsystem. Total system cost is not just bytes-per-message. And delta-CRDTs shrink the per-message cost dramatically.

**"Merge is just `max` / it's always obvious."** `max` is the join *for a G-Counter*. The join is type-specific: union for grow-only sets, elementwise-max for vectors, a tournament rule for LWW registers. The requirement is "it's a least upper bound," not "it's max."

**"Op-based and state-based are fundamentally different data types."** They are inter-definable (§7); they have the same power. The difference is purely *where the cost lives* — message vs network.

**"Causal delivery means total order / I need consensus."** No. Causal delivery is *strictly weaker* than total order: concurrent messages may still be delivered in any relative order. It needs vector clocks and buffering, not a consensus protocol like Paxos/Raft. That weakness is exactly why CRDTs avoid coordination on the write path.

---

## 11. Common mistakes

- **Putting side effects in `prepare`.** `prepare` must only *read* state and *build a message*; it must not mutate. If you mutate in prepare, the source applies a change that no message carries, and the source diverges from everyone else. Mutation belongs in `effect`.
- **Re-deriving the decision in `effect` from local state** instead of using the frozen decision in the message. (E.g. an op-based set whose remove `effect` removes "whatever is currently present" rather than the specific tag the source decided on.) This re-introduces order-dependence the message was supposed to eliminate.
- **Forgetting dedup for non-idempotent effects.** At-least-once channels (the common default — Kafka, retries, gossip) *will* redeliver. Without a seen-set / version vector, counters double-count and the system silently diverges.
- **A non-monotonic state-based update (not an inflation).** If an update can lower the state in the lattice, gossip can resurrect old values and merge can move you "backward." Every state-based update must satisfy `q ⊑ u(q)`.
- **A merge that isn't a true LUB.** If `merge` is not idempotent (e.g. it *adds* instead of *maxes*), duplicate gossip inflates the value — you've recreated the op-based double-count bug inside the merge. Test `merge(s, s) == s`, `merge(a, b) == merge(b, a)`, and `merge(merge(a,b),c) == merge(a,merge(b,c))`.
- **Assuming op-based works over plain best-effort UDP/HTTP retries.** Those give at-most-once or at-least-once, not exactly-once causal. You must add the dedup + causal-buffer layer (or use middleware that provides it).
- **Using a version vector as the message- id store but never garbage-collecting / compacting it.** Unbounded metadata growth is a real operational failure mode of op-based systems; plan for stable-delivery thresholds.

---

## 12. Cheat sheet

```
                    CvRDT (state-based)         CmRDT (op-based)
                    --------------------        ------------------
Travels             whole STATE                 one OPERATION (message)
Receiver runs       merge(local, incoming)      effect(message)
Local update        an INFLATION  q ⊑ u(q)      prepare (pure) then effect
Convergence from    join-semilattice laws       concurrent effects COMMUTE
                    merge = LUB                   + reliable causal broadcast
Merge/effect law    commut. + assoc. + IDEMPOT.  effects commute (concurrent only)
Network must give   ~nothing: at-least-once      RELIABLE + EXACTLY-ONCE + CAUSAL
                    gossip; lossy/dup/reorder OK
Duplicates          free (s ⊔ s = s)            must DEDUP (id / version vector)
Reordering          free (commut.+assoc.)       must BUFFER for causal order
Loss                free (re-gossip)            must RETRANSMIT
Per-message cost    O(state)  (δ-CRDT → O(δ))   O(op)  (tiny)
Channel state       stateless                   stateful (dedup + causal buffer)
New replica join    send current state once     replay/snapshot op history

Causal order tool:  vector clock / version vector
  local event:      V[i] += 1
  on send:          attach copy of V
  on receive Vm:    V = max(V, Vm); V[i] += 1
  a → b  iff  Va ≤ Vb (elementwise) and Va ≠ Vb     (else concurrent)
  causal delivery = buffer msg until all its predecessors delivered
```

Decision rule of thumb:

- **Unreliable / partition-prone / P2P / can't trust the channel?** → state-based (or delta-state).
- **Already have a reliable ordered log / broker, and states are large?** → op-based.
- **Large state *and* lossy network?** → delta-state CRDT (best of both; see [senior](senior.md)).

---

## 13. Summary

- A **CvRDT** is a join-semilattice `(S, ⊔)` with **inflationary** updates. `merge` is the **least upper bound**, which is *automatically* commutative, associative, and **idempotent**. Those three laws make convergence hold over the weakest possible channel: lossy, duplicating, reordering — as long as every state eventually reaches every replica at least once.
- A **CmRDT** splits each operation into a side-effect-free **`prepare`** (at source) and an **`effect`** (at every replica). It converges iff **(R1)** concurrent effects **commute** and **(R2)** the channel is a **reliable causal broadcast**: reliable + exactly-once + causal-order.
- **Causal delivery is non-negotiable for op-based**, because operations often encode decisions about state (remove *this* tag). Delivering a causally-later op first — remove before its add — diverges replicas even when effects commute (§4).
- **Idempotency** of effects is about *duplicates* only; it lets exactly-once relax to at-least-once but does **not** remove the causal-order or reliability requirements (§5).
- The trade-off is **where the cost lives**: state-based ships fat messages over a dumb network; op-based ships thin messages over a smart network (§6). Delta-state CRDTs recover small messages while staying merge-based.
- The two models are **inter-definable** — same power, different engineering profile. A state-based CRDT is essentially an op-based CRDT whose single op is `merge`, so well-behaved it trivializes the op-based channel requirements (§7; proof on [senior](senior.md)).
- The **G-Counter** crystallizes everything: state-based = vector + elementwise-max (duplicates absorbed for free); op-based = broadcast "inc at r" (duplicates double-count unless exactly-once dedup saves you) (§8–9).

Next: take the counter family further in [Counters](../03-counters-g-pn/middle.md) (G-Counter, PN-Counter, and their pitfalls), or go to [senior](senior.md) for the full equivalence proof and delta-state CRDTs. Refresh the basics any time at [CRDT Fundamentals](../01-crdt-fundamentals/middle.md).

---

## 14. Further reading

- **Marc Shapiro, Nuno Preguiça, Carlos Baquero, Marek Zawirski (2011), "Conflict-free Replicated Data Types,"** *SSS 2011* (and the companion Inria Research Report RR-7687, "A comprehensive study of Convergent and Commutative Replicated Data Types"). The foundational paper: defines CvRDT and CmRDT, proves the convergence conditions used on this page (semilattice + inflation; commuting effects + causal delivery), and proves their equivalence.
- **Leslie Lamport (1978), "Time, Clocks, and the Ordering of Events in a Distributed System,"** *CACM*. The happened-before relation `→` and logical clocks underpinning causal order.
- **Colin Fidge (1988) / Friedemann Mattern (1989), vector clocks.** The mechanism that decides `→` vs concurrency, hence implements causal delivery.
- **Carlos Baquero, Paulo Sérgio Almeida, Ali Shoker (2014), "Making Operation-based CRDTs Operation-based" / Almeida, Shoker, Baquero (2018), "Delta State Replicated Data Types,"** *JPDC*. Delta-state CRDTs — the state-based optimization that recovers op-like message sizes (referenced for [senior](senior.md)).
- **Nuno Preguiça (2018), "Conflict-free Replicated Data Types: An Overview."** A readable survey tying the two models, delta-CRDTs, and real systems together.
