# State-based vs Operation-based CRDTs — Practice Tasks

> A graded problem set on the two families of conflict-free replicated data types: **state-based** (CvRDT, converge by merging whole states with a join-semilattice `merge`) and **operation-based** (CmRDT, converge by broadcasting operations under a delivery guarantee). Solutions are in **Python** primarily, with **Go** where it sharpens a point. Each task gives a *statement*, an *acceptance test*, and a *model solution*.
>
> **Conventions.**
> - The canonical **convergence acceptance test** for any replicated type: take a workload, replay the network events under arbitrary **drop / duplication / reorder**, and assert that every replica reaches **byte-identical state** (or an equal value) once it has seen the required set of events. For CvRDT this must hold for *any* delivery; for CmRDT it must hold *given the type's required delivery guarantee*.
> - Every **op-based** task must state the **delivery guarantee** it assumes — at-least-once, exactly-once, causal, or reliable-causal. A CmRDT is only correct relative to that guarantee; "it converges" is meaningless without it.
> - Tags: **[coding]** (write runnable code), **[proof]** (write a rigorous argument), **[design]** (architecture + analysis, no code required). Difficulty: `[easy] [medium] [hard]`.
> - "Converge" means *strong eventual consistency* (SEC): replicas that have delivered the same set of updates have equal state.
>
> **Related practice:** [CRDT Fundamentals tasks](../01-crdt-fundamentals/tasks.md) · [Counter tasks](../03-counters-g-pn/tasks.md) · [Set tasks](../04-sets-or-set-lww/tasks.md)
>
> Notes by tier: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

---

## Beginner

### Task 1 — G-Set as a CvRDT (merge = union) **[coding]** `[easy]`

**Statement.** Implement a grow-only set as a *state-based* CRDT. State is a Python `set`. Provide `add(x)`, `value()`, and `merge(other)` where `merge` is set union. Prove to yourself it is a join-semilattice: the partial order is `⊆`, the join is `∪`.

**Acceptance test.** Two replicas add disjoint and overlapping elements. After mutually merging, both have the union. `merge` must be commutative, associative, and idempotent on three sample states.

**Model solution.**

```python
from __future__ import annotations


class GSetCvRDT:
    """Grow-only set, state-based. Lattice: (P(E), ⊆, ∪)."""

    def __init__(self) -> None:
        self._s: set = set()

    def add(self, x) -> None:
        self._s.add(x)

    def value(self) -> frozenset:
        return frozenset(self._s)

    def merge(self, other: "GSetCvRDT") -> "GSetCvRDT":
        out = GSetCvRDT()
        out._s = set(self._s) | set(other._s)
        return out


def test_gset_cvrdt():
    a, b = GSetCvRDT(), GSetCvRDT()
    a.add("x"); a.add("y")
    b.add("y"); b.add("z")

    a2 = a.merge(b)
    b2 = b.merge(a)
    assert a2.value() == b2.value() == {"x", "y", "z"}

    # Lattice laws on sample states.
    s = [GSetCvRDT() for _ in range(3)]
    s[0]._s = {1, 2}; s[1]._s = {2, 3}; s[2]._s = {3, 4}
    # Commutativity
    assert s[0].merge(s[1]).value() == s[1].merge(s[0]).value()
    # Associativity
    left = s[0].merge(s[1]).merge(s[2]).value()
    right = s[0].merge(s[1].merge(s[2])).value()
    assert left == right
    # Idempotence
    assert s[0].merge(s[0]).value() == s[0].value()
    print("Task 1 OK")


if __name__ == "__main__":
    test_gset_cvrdt()
```

The three laws are exactly what makes `value()` independent of *how* states were combined — only of *which* elements were ever added.

---

### Task 2 — G-Set as a CmRDT (broadcast add-op) **[coding]** `[easy]`

**Statement.** Implement the same grow-only set as an *operation-based* CRDT. A local `add(x)` produces an operation `("add", x)` that is broadcast to all replicas. Each replica applies delivered ops to its local set. State that the required delivery guarantee for this type is **at-least-once** (no ordering needed — `add` ops commute, and applying `add(x)` twice is harmless because set insertion is idempotent).

**Acceptance test.** A replica generates a sequence of `add` ops; a second replica applies them in *reverse* order and *with duplicates*. Both still converge to the same set.

**Model solution.**

```python
from __future__ import annotations
from typing import Tuple, List


Op = Tuple[str, object]  # ("add", x)


class GSetCmRDT:
    """Grow-only set, operation-based. Delivery requirement: at-least-once."""

    def __init__(self) -> None:
        self._s: set = set()

    def add_local(self, x) -> Op:
        """Apply locally, return the op to broadcast."""
        self._apply(("add", x))
        return ("add", x)

    def deliver(self, op: Op) -> None:
        self._apply(op)

    def _apply(self, op: Op) -> None:
        kind, x = op
        assert kind == "add"
        self._s.add(x)  # idempotent → duplicates are safe

    def value(self) -> frozenset:
        return frozenset(self._s)


def test_gset_cmrdt():
    src = GSetCmRDT()
    ops: List[Op] = [src.add_local(v) for v in ("x", "y", "z")]

    dst = GSetCmRDT()
    # Reorder + duplicate delivery (at-least-once, any order).
    for op in reversed(ops):
        dst.deliver(op)
        dst.deliver(op)  # duplicate

    assert dst.value() == src.value() == {"x", "y", "z"}
    print("Task 2 OK")


if __name__ == "__main__":
    test_gset_cmrdt()
```

Note what makes this work: `add` ops **commute** (order-independent) and applying one twice is a no-op. That is precisely why a G-Set CmRDT tolerates reorder and duplicates and needs only *at-least-once*.

---

### Task 3 — Adversarial network harness **[coding]** `[easy]`

**Statement.** Write a reusable harness that, given a list of "messages" and a replica factory, replays delivery under an adversarial schedule: each message may be **dropped** (only for CvRDT, which is loss-tolerant per merge), **duplicated**, and **reordered**. The harness asserts convergence after a *final reliable flush* (deliver every message at least once). Use it to confirm the CvRDT G-Set from Task 1 converges even when intermediate merges are lost.

**Acceptance test.** Run 200 randomized schedules; every one ends with all replicas equal to the full union.

**Model solution.**

```python
from __future__ import annotations
import random
from typing import Callable, List


def adversarial_replay(messages: List, apply: Callable, *,
                       drop_prob=0.3, dup_prob=0.3, seed=0):
    """Deliver `messages` to a replica under drop/dup/reorder, then a
    reliable flush. `apply(msg)` mutates the replica. Returns the order used."""
    rng = random.Random(seed)
    schedule = list(messages)
    rng.shuffle(schedule)
    delivered = []
    for m in schedule:
        if rng.random() < drop_prob:
            continue  # dropped this round
        apply(m)
        delivered.append(m)
        while rng.random() < dup_prob:
            apply(m)  # duplicate
            delivered.append(m)
    # Reliable flush: guarantee at-least-once for all.
    for m in messages:
        apply(m)
    return delivered


def test_harness_cvrdt():
    from_full = None
    for seed in range(200):
        # Three "states" to merge into a target replica.
        states = []
        for i in range(3):
            s = GSetCvRDT()
            for j in range(5):
                s.add(f"r{i}-{j}")
            states.append(s)

        target = GSetCvRDT()

        def apply(state):
            nonlocal target
            target = target.merge(state)

        adversarial_replay(states, apply, seed=seed)
        full = frozenset().union(*[s.value() for s in states])
        assert target.value() == full
        from_full = full
    assert len(from_full) == 15
    print("Task 3 OK")


if __name__ == "__main__":
    test_harness_cvrdt()
```

A CvRDT survives **dropped merges** because every merge folds in *whole state*: a lost merge just delays propagation; the next merge re-includes everything. A CmRDT cannot tolerate a dropped *op* — the op carries the only copy of that delta — which is why op-based types demand at-least-once delivery.

---

### Task 4 — Why CmRDT needs at-least-once **[proof]** `[easy]`

**Statement.** Argue precisely why the G-Set CmRDT of Task 2 fails to converge under a network that may **silently drop** an op, and why the CvRDT of Task 1 does not. Then state the minimal delivery guarantee that repairs the CmRDT.

**Model proof.**

Let replica `A` perform `add(x)` and broadcast op `o = ("add", x)`. Replica `B`'s state is the multiset of ops it has applied.

*CmRDT failure.* Suppose the network drops `o` and never retransmits. Then `B` never applies `o`, so `x ∉ value(B)`, while `x ∈ value(A)`. No future event repairs this: in a pure op-based design, the only carrier of the information "`x` was added" is the op itself. If it is lost, the information is lost. Hence SEC fails: `A` and `B` have delivered different *sets of ops* and diverge permanently.

*CvRDT non-failure.* In the state-based design, `A`'s state *contains* `x` and is re-sent in full on every gossip round. Dropping one merge message is harmless because `merge` is **idempotent** and the *whole* current state (including `x`) is offered again on the next round. Convergence requires only that *some* state transfer eventually succeeds — an *eventually-reliable* channel, not per-message reliability.

*Minimal repair for the CmRDT.* **At-least-once** delivery: every broadcast op must eventually be delivered to every replica one or more times. Since G-Set `add` ops are idempotent and commutative, duplicates and reordering are already tolerated, so at-least-once *suffices and is necessary*. ∎

The structural lesson: **state-based pushes the burden onto the merge (a lattice join) and tolerates a flaky channel; operation-based pushes the burden onto the channel (a delivery guarantee) and keeps messages small.**

---

## Intermediate

### Task 5 — G-Counter both ways **[coding]** `[medium]`

**Statement.** Implement a grow-only counter as (a) a CvRDT whose state is a per-replica vector and whose `merge` is element-wise `max`, and (b) a CmRDT that broadcasts `("inc", replica_id, 1)` ops under **at-least-once** delivery. For the CmRDT, you must make redelivery safe — see Task 6 for the failure if you do not. Here, use a *sequence number* per replica so each increment is uniquely identified.

**Acceptance test.** Both implementations, fed the same logical increments and replayed under reorder/dup, produce the same total; the CvRDT also under drop.

**Model solution.**

```python
from __future__ import annotations
from collections import defaultdict
from typing import Dict, Tuple


class GCounterCvRDT:
    """State = {replica_id: count}. merge = element-wise max."""

    def __init__(self, replica_id: str) -> None:
        self.id = replica_id
        self.v: Dict[str, int] = defaultdict(int)

    def inc(self, n: int = 1) -> None:
        self.v[self.id] += n

    def value(self) -> int:
        return sum(self.v.values())

    def merge(self, other: "GCounterCvRDT") -> None:
        for k, c in other.v.items():
            self.v[k] = max(self.v[k], c)


class GCounterCmRDT:
    """Op = ("inc", replica_id, seq). Delivery: at-least-once.
    Dedup by (replica_id, seq) makes redelivery exactly-once in effect."""

    def __init__(self, replica_id: str) -> None:
        self.id = replica_id
        self._seq = 0
        self.applied: set[Tuple[str, int]] = set()
        self.total = 0

    def inc_local(self):
        self._seq += 1
        op = ("inc", self.id, self._seq)
        self.deliver(op)
        return op

    def deliver(self, op) -> None:
        _, rid, seq = op
        key = (rid, seq)
        if key in self.applied:       # idempotent under redelivery
            return
        self.applied.add(key)
        self.total += 1

    def value(self) -> int:
        return self.total


def test_gcounter_both():
    # CvRDT
    a, b = GCounterCvRDT("a"), GCounterCvRDT("b")
    a.inc(); a.inc(); b.inc()
    a.merge(b); b.merge(a); a.merge(b)
    assert a.value() == b.value() == 3

    # CmRDT, reorder + duplicate
    src = GCounterCmRDT("a")
    ops = [src.inc_local() for _ in range(3)]
    dst = GCounterCmRDT("b")
    for op in reversed(ops):
        dst.deliver(op); dst.deliver(op)  # dup
    assert dst.value() == src.value() == 3
    print("Task 5 OK")


if __name__ == "__main__":
    test_gcounter_both()
```

The CvRDT encodes "how many times replica `r` incremented" as `v[r]`; `max` is the join because the per-replica count only grows. The CmRDT instead carries the *event* and must guard against the event being counted twice.

---

### Task 6 — The double-count bug, and two fixes **[coding]** `[medium]`

**Statement.** Implement a **naive** op-based counter that broadcasts `("inc", 1)` with **no identity**, and show that under at-least-once delivery (which permits duplicates) a redelivered increment **double-counts**. Then provide two correct fixes: (1) **exactly-once** semantics via per-op identity + dedup, and (2) an **idempotent op** by carrying a monotonic counter value instead of a delta (which turns the op-based design into something equivalent to a state delta).

**Acceptance test.** The naive version's total exceeds the true count under duplication; both fixes match the true count.

**Model solution.**

```python
from __future__ import annotations


class NaiveCounter:
    """BUG: op = ('inc', 1) with no id. Duplicates double-count."""

    def __init__(self) -> None:
        self.total = 0

    def inc_local(self):
        op = ("inc", 1)
        self.deliver(op)
        return op

    def deliver(self, op):
        self.total += op[1]   # blindly add the delta

    def value(self):
        return self.total


class DedupCounter:
    """FIX 1: exactly-once via unique op ids + dedup."""

    def __init__(self, rid):
        self.rid, self.seq, self.seen, self.total = rid, 0, set(), 0

    def inc_local(self):
        self.seq += 1
        op = (self.rid, self.seq, 1)
        self.deliver(op)
        return op

    def deliver(self, op):
        rid, seq, d = op
        if (rid, seq) in self.seen:
            return
        self.seen.add((rid, seq))
        self.total += d

    def value(self):
        return self.total


class MonotoneCounter:
    """FIX 2: idempotent op carries the running value, applied via max.
    Effectively a per-replica state delta; redelivery is harmless."""

    def __init__(self, rid):
        self.rid, self.local, self.table = rid, 0, {}

    def inc_local(self):
        self.local += 1
        op = (self.rid, self.local)         # ('a', running_value)
        self.deliver(op)
        return op

    def deliver(self, op):
        rid, running = op
        self.table[rid] = max(self.table.get(rid, 0), running)  # idempotent

    def value(self):
        return sum(self.table.values())


def test_double_count():
    # Naive double-counts.
    n = NaiveCounter()
    op = n.inc_local()
    n.deliver(op)               # duplicate redelivery
    assert n.value() == 2, "demonstrates the bug (true count is 1)"

    # Fix 1
    d = DedupCounter("a")
    op = d.inc_local()
    d.deliver(op); d.deliver(op)
    assert d.value() == 1

    # Fix 2
    m = MonotoneCounter("a")
    op = m.inc_local()
    m.deliver(op); m.deliver(op)
    assert m.value() == 1
    print("Task 6 OK")


if __name__ == "__main__":
    test_double_count()
```

Fix 2 is the deep one: by making the op carry an **idempotent, monotone** payload (the running value, combined with `max`), we have effectively shipped a *state delta*. This is the bridge to **delta-state CRDTs** (Task 11): a delta-state op is an op-based message whose payload is a fragment of the lattice and is therefore safe to reorder *and* duplicate without dedup machinery.

---

### Task 7 — Causal broadcast simulator with vector clocks **[coding]** `[medium]`

**Statement.** Build a causal-broadcast layer: messages tagged with a **vector clock**, buffered at the receiver until all causally-prior messages have been delivered. Expose `broadcast(payload)` and a `deliver_callback`. The simulator must guarantee **causal order** (if `m1 → m2`, every replica delivers `m1` before `m2`) while still allowing concurrent messages in any order.

**Acceptance test.** Inject messages out of order on the wire; assert the callback is invoked in a causal order at every replica (a message is never delivered before its causal predecessors).

**Model solution.**

```python
from __future__ import annotations
from collections import defaultdict
from typing import Callable, Dict, List, Tuple

VC = Dict[str, int]


class CausalBroadcast:
    """Per-replica causal delivery using vector clocks (Birman–Schiper–Stephenson)."""

    def __init__(self, rid: str, peers: List[str], on_deliver: Callable):
        self.rid = rid
        self.peers = peers
        self.clock: VC = {p: 0 for p in peers}
        self.on_deliver = on_deliver
        self.buffer: List[Tuple[str, VC, object]] = []

    def broadcast(self, payload):
        self.clock[self.rid] += 1
        msg = (self.rid, dict(self.clock), payload)
        self._network_out.append(msg)  # set by simulator
        return msg

    def receive(self, msg):
        self.buffer.append(msg)
        self._drain()

    def _deliverable(self, sender: str, vc: VC) -> bool:
        # Must be the next message from sender ...
        if vc[sender] != self.clock[sender] + 1:
            return False
        # ... and we must have seen all of sender's causal deps.
        for p in self.peers:
            if p != sender and vc[p] > self.clock[p]:
                return False
        return True

    def _drain(self):
        progress = True
        while progress:
            progress = False
            for msg in list(self.buffer):
                sender, vc, payload = msg
                if self._deliverable(sender, vc):
                    self.clock[sender] += 1
                    self.buffer.remove(msg)
                    self.on_deliver(sender, payload)
                    progress = True


def test_causal_broadcast():
    peers = ["a", "b", "c"]
    order_seen = defaultdict(list)

    nodes: Dict[str, CausalBroadcast] = {}
    for p in peers:
        nodes[p] = CausalBroadcast(
            p, peers, on_deliver=(lambda s, pl, p=p: order_seen[p].append(pl)))
        nodes[p]._network_out = []

    # a broadcasts m1; c (after delivering m1) broadcasts m2  → m1 → m2.
    m1 = nodes["a"].broadcast("m1")
    nodes["c"].receive(m1)              # c delivers m1
    m2 = nodes["c"].broadcast("m2")     # m2 causally after m1

    # Deliver to b in the WRONG wire order: m2 then m1.
    nodes["b"].receive(m2)              # must buffer (deps unmet)
    assert order_seen["b"] == []        # not delivered yet
    nodes["b"].receive(m1)
    assert order_seen["b"] == ["m1", "m2"]  # causal order restored
    print("Task 7 OK")


if __name__ == "__main__":
    test_causal_broadcast()
```

---

### Task 8 — Why op-based remove needs causal delivery: remove-before-add **[proof]** `[medium]`

**Statement.** Consider an op-based set supporting `add(x)` and `remove(x)`. Show that with merely *at-least-once* (unordered) delivery, a replica can apply `remove(x)` **before** the `add(x)` it was meant to cancel, leaving the set in a state inconsistent with causal intent — and that **causal delivery** (Task 7) is the guarantee that rules this out. Build the counterexample concretely, then state the fix.

**Model solution (counterexample + argument).**

```python
class OpSet:
    """Op-based set. CORRECT only under causal delivery."""
    def __init__(self):
        self.s = set()
    def deliver(self, op):
        kind, x = op
        if kind == "add":
            self.s.add(x)
        else:  # remove
            self.s.discard(x)


def counterexample():
    src = OpSet()
    add = ("add", "k"); rem = ("remove", "k")   # rem causally AFTER add
    # Causal intent: add then remove → final {} (empty).

    # Replica delivers them REORDERED (allowed under at-least-once):
    r = OpSet()
    r.deliver(rem)    # remove("k") before it exists: no-op
    r.deliver(add)    # add("k")
    assert r.value() if hasattr(r, "value") else r.s == {"k"}
    # Replica ends with {"k"} — the remove was lost. DIVERGENCE from intent.
    return r.s


OpSet.value = lambda self: frozenset(self.s)
print("remove-before-add yields:", counterexample())  # {'k'} — wrong
```

*Argument.* The operations `add(x)` and `remove(x)` **do not commute**: `apply(add) ∘ apply(remove)` leaves `{x}`, while `apply(remove) ∘ apply(add)` leaves `{}`. CmRDT correctness requires that concurrent ops commute *and* that causally-dependent ops be delivered in causal order. Here `remove(x)` causally depends on the `add(x)` it cancels (the user removed something they had just added). At-least-once delivery permits reorder, so a replica can apply `remove` first, where it is a no-op, then `add`, ending in `{x}` — disagreeing with the originating replica's `{}`. SEC is violated.

*Fix.* Require **reliable causal-order delivery**. Under causal delivery, `add(x) → remove(x)` forces every replica to apply `add` before `remove`, so all converge to `{}`. (Concurrent `add`/`remove` of the *same* element is a different matter — that requires a conflict policy, e.g. add-wins as in OR-Set; see [Set tasks](../04-sets-or-set-lww/tasks.md). Causal delivery handles the *dependent* case; the lattice/tagging handles the *concurrent* case.) ∎

---

### Task 9 — Convergence-under-adversary test for both counters **[coding]** `[medium]`

**Statement.** Using the harness pattern from Task 3, write a single convergence test that drives both the CvRDT and CmRDT G-Counters from Task 5 through drop/dup/reorder and asserts identical final value. The CvRDT branch may drop merges; the CmRDT branch may dup/reorder ops but (per its at-least-once contract) **must** eventually deliver each op at least once.

**Acceptance test.** 500 randomized seeds; both families converge to the true increment count every time.

**Model solution.**

```python
import random


def test_both_converge_under_adversary():
    for seed in range(500):
        rng = random.Random(seed)
        n_incs = {"a": rng.randint(0, 6), "b": rng.randint(0, 6)}
        true_total = n_incs["a"] + n_incs["b"]

        # --- CvRDT path: states gossiped, merges may drop/reorder/dup ---
        ra, rb = GCounterCvRDT("a"), GCounterCvRDT("b")
        for _ in range(n_incs["a"]): ra.inc()
        for _ in range(n_incs["b"]): rb.inc()
        for _ in range(10):  # several gossip rounds, lossy
            if rng.random() < 0.7: ra.merge(rb)
            if rng.random() < 0.7: rb.merge(ra)
        ra.merge(rb); rb.merge(ra)  # final reliable round
        assert ra.value() == rb.value() == true_total

        # --- CmRDT path: ops broadcast, reorder + dup, at-least-once ---
        sa, sb = GCounterCmRDT("a"), GCounterCmRDT("b")
        ops = [sa.inc_local() for _ in range(n_incs["a"])] + \
              [sb.inc_local() for _ in range(n_incs["b"])]
        # cross-deliver every op to the other replica, shuffled + duped
        wire = []
        for op in ops:
            wire.append(op)
            if rng.random() < 0.4: wire.append(op)
        rng.shuffle(wire)
        for op in wire:
            sa.deliver(op); sb.deliver(op)
        assert sa.value() == sb.value() == true_total
    print("Task 9 OK")


if __name__ == "__main__":
    test_both_converge_under_adversary()
```

This is the litmus test for the whole topic: *same workload, two designs, adversarial schedule, identical result.* The only difference is **what the schedule is allowed to do**: drop merges (CvRDT) vs. dup/reorder ops but never permanently drop (CmRDT).

---

## Advanced

### Task 10 — Delta-state G-Counter with delta buffers + anti-entropy **[coding]** `[hard]`

**Statement.** Implement a **delta-state** G-Counter (δ-CRDT). Each local `inc` produces a tiny **delta** (only the changed `(replica → count)` entry). Maintain a **delta buffer**; an **anti-entropy** round ships only buffered deltas to a peer, who merges them and acks up to a delta-interval. Compare bytes-on-the-wire against shipping the **full state** each round. The merge of a delta is the same join (`max`) as the full state — that is the δ-CRDT guarantee.

**Acceptance test.** After anti-entropy completes, all replicas equal the full-state result; and the measured bytes for delta gossip is strictly less than full-state gossip on a workload with few changes per round.

**Model solution.**

```python
from __future__ import annotations
from collections import defaultdict
import json
from typing import Dict, List


def state_bytes(d: Dict[str, int]) -> int:
    return len(json.dumps(d, sort_keys=True).encode())


class DeltaGCounter:
    def __init__(self, rid: str):
        self.rid = rid
        self.state: Dict[str, int] = defaultdict(int)
        self.delta_buffer: List[Dict[str, int]] = []

    def inc(self, n: int = 1) -> Dict[str, int]:
        self.state[self.rid] += n
        delta = {self.rid: self.state[self.rid]}   # only the changed entry
        self.delta_buffer.append(delta)
        return delta

    def merge_delta(self, delta: Dict[str, int]) -> None:
        for k, c in delta.items():
            self.state[k] = max(self.state[k], c)

    def take_deltas(self) -> List[Dict[str, int]]:
        d = self.delta_buffer
        self.delta_buffer = []
        return d

    def value(self) -> int:
        return sum(self.state.values())


def test_delta_vs_full():
    a, b = DeltaGCounter("a"), DeltaGCounter("b")

    delta_wire = 0
    full_wire = 0

    # 5 rounds; each round each replica does 1 inc then gossips.
    for _ in range(5):
        a.inc(); b.inc()
        # Delta anti-entropy: ship only buffered deltas.
        da, db = a.take_deltas(), b.take_deltas()
        for d in da:
            delta_wire += state_bytes(d); b.merge_delta(d)
        for d in db:
            delta_wire += state_bytes(d); a.merge_delta(d)
        # Full-state gossip cost (hypothetical, for comparison).
        full_wire += state_bytes(dict(a.state)) + state_bytes(dict(b.state))

    assert a.value() == b.value() == 10
    assert delta_wire < full_wire, (delta_wire, full_wire)
    print(f"Task 10 OK  delta={delta_wire}B  full={full_wire}B")


if __name__ == "__main__":
    test_delta_vs_full()
```

The win grows with state size: full-state gossip costs `O(replicas)` per round forever; delta gossip costs `O(changes this round)`. Delta-state keeps the **CvRDT safety** (idempotent, commutative, associative merge — so reorder/dup of deltas is fine) while approaching **CmRDT economy** (small messages). It needs only *eventual* delivery of deltas, *not* causal order — strictly weaker than op-based remove (Task 8).

---

### Task 11 — Go delta-state OR-Set with anti-entropy **[coding]** `[hard]`

**Statement.** In **Go**, implement a delta-state **OR-Set** (observed-remove set): each `add(x)` tags the element with a unique dot `(replica, seq)`; `remove(x)` records the set of currently-observed dots for `x` as tombstoned. State is `{element → set of live dots}`. Deltas carry only the dots touched. Merge is per-element dot-set union minus tombstones. Provide an anti-entropy round and a convergence assertion.

**Acceptance test.** Concurrent `add(x)` on one replica and `remove(x)` on another (where remove only saw an earlier add) → **add-wins**: `x` survives. All replicas converge.

**Model solution (Go).**

```go
package orset

import "fmt"

type Dot struct {
	Rep string
	Seq int
}

// ORSet is a delta-state observed-remove set.
type ORSet struct {
	rep   string
	seq   int
	live  map[string]map[Dot]bool // element -> set of live dots
	dead  map[Dot]bool            // tombstoned dots
}

func New(rep string) *ORSet {
	return &ORSet{rep: rep, live: map[string]map[Dot]bool{}, dead: map[Dot]bool{}}
}

// Delta is the minimal fragment shipped during anti-entropy.
type Delta struct {
	Add  map[string]map[Dot]bool
	Dead map[Dot]bool
}

func (s *ORSet) Add(x string) Delta {
	s.seq++
	d := Dot{s.rep, s.seq}
	if s.live[x] == nil {
		s.live[x] = map[Dot]bool{}
	}
	s.live[x][d] = true
	return Delta{Add: map[string]map[Dot]bool{x: {d: true}}, Dead: nil}
}

func (s *ORSet) Remove(x string) Delta {
	dead := map[Dot]bool{}
	for d := range s.live[x] { // tombstone only the dots we observe now
		dead[d] = true
		s.dead[d] = true
	}
	delete(s.live, x)
	return Delta{Dead: dead}
}

func (s *ORSet) Merge(d Delta) {
	for x, dots := range d.Add {
		if s.live[x] == nil {
			s.live[x] = map[Dot]bool{}
		}
		for dot := range dots {
			if !s.dead[dot] { // a dot already tombstoned stays dead
				s.live[x][dot] = true
			}
		}
	}
	for dot := range d.Dead {
		s.dead[dot] = true
		for x, dots := range s.live {
			delete(dots, dot)
			if len(dots) == 0 {
				delete(s.live, x)
			}
		}
	}
}

func (s *ORSet) Has(x string) bool {
	return len(s.live[x]) > 0
}

func main() {
	a, b := New("a"), New("b")
	dAdd := a.Add("k") // a: add k (dot a1)
	b.Merge(dAdd)      // b observes add (dot a1)

	// Concurrent: a adds k again (new dot a2); b removes the k it saw (dot a1).
	dAdd2 := a.Add("k")
	dRem := b.Remove("k") // tombstones only a1

	// Exchange deltas (any order; idempotent).
	a.Merge(dRem)
	b.Merge(dAdd2)
	b.Merge(dRem)
	a.Merge(dAdd2)

	// Add-wins: a2 was never observed by the remove, so k survives.
	fmt.Println("a.Has(k):", a.Has("k"), " b.Has(k):", b.Has("k")) // true true
	if a.Has("k") != b.Has("k") || !a.Has("k") {
		panic("convergence/add-wins violated")
	}
	fmt.Println("Task 11 OK")
}
```

Run with `go run`. The dot mechanism is the OR-Set's lattice: removes only kill **observed** dots, so a concurrent add (unobserved by the remove) wins. Deltas carry only the touched dots, and merge is union/tombstone — idempotent and commutative, so anti-entropy needs no ordering guarantee.

---

### Task 12 — Prove the CvRDT ⇄ CmRDT emulation **[proof]** `[hard]`

**Statement.** Prove both directions of the standard equivalence (Shapiro et al.) for the G-Counter:
1. **CmRDT → CvRDT.** Any CmRDT can be emulated by a CvRDT that ships the *log of ops* and merges by set-union of logs, replaying. Show the G-Counter case.
2. **CvRDT → CmRDT.** Any CvRDT whose state forms a join-semilattice can be emulated by a CmRDT whose single op is "deliver my current state, apply by `merge`", under causal delivery. Show the G-Counter case.

**Model proof.**

Let the G-Counter value function be `V(s) = Σ_r s[r]`.

**(1) CmRDT → CvRDT.** Define a CvRDT whose state is the *set* of delivered increment-ops, each op uniquely identified by `(r, seq)`. `merge` is set union; `value` counts the ops. Union is commutative, associative, idempotent — a join-semilattice on `(P(Ops), ⊆, ∪)`. Since each op is unique, set semantics give exactly-once counting regardless of duplication or reordering of *state transfers*. The value equals the number of distinct increments, identical to the CmRDT's value after at-least-once delivery of those same ops. Thus the op-set CvRDT *emulates* the counter CmRDT. (This is the "ship the log" construction; it is correct but unbounded — motivating the compact vector form.) ∎(1)

**(2) CvRDT → CmRDT.** Take the vector-state G-Counter `s ∈ ℕ^R` with join `(s ⊔ t)[r] = max(s[r], t[r])`. Define a CmRDT with one operation: `gossip(s)` whose effect on a receiver `t` is `t ← t ⊔ s`. The effect `λt. t ⊔ s` is, for fixed `s`, **idempotent** (`(t ⊔ s) ⊔ s = t ⊔ s`) and any two such effects **commute** (`(t ⊔ s) ⊔ s' = (t ⊔ s') ⊔ s`, since `⊔` is commutative and associative). By the CmRDT sufficient condition, *concurrent operations commute*, so reordering and duplication of `gossip` messages is safe; **causal delivery is not even required** because all effects commute unconditionally — *eventual* (at-least-once) delivery suffices. Replaying all `gossip(s_i)` ops yields `⊔_i s_i`, whose value matches the CvRDT obtained by merging all states. Thus the gossip-CmRDT emulates the vector CvRDT. ∎(2)

**Remark.** Direction (2) being achievable with only at-least-once (not causal) delivery is special to the *monotone-merge* structure — it is exactly why delta-state CRDTs (Tasks 10–11) exist: they are "CmRDTs whose op payload is a lattice fragment," inheriting the weak-delivery requirement of state-based merge while keeping op-based message sizes. A general CmRDT (e.g., a set with non-commuting add/remove, Task 8) genuinely needs causal delivery and is *not* emulable this cheaply. ∎

---

### Task 13 — Property-based tester for merge laws **[coding]** `[hard]`

**Statement.** Write a property-based test (using `hypothesis`) that, given a generator of random states for a CvRDT, checks the three semilattice laws: **commutativity** `a⊔b = b⊔a`, **associativity** `(a⊔b)⊔c = a⊔(b⊔c)`, and **idempotence** `a⊔a = a`. Apply it to the G-Counter and to a PN-Counter (two G-Counters, P and N) to confirm both are valid lattices. A type that fails any law is *not* a CvRDT.

**Acceptance test.** All three properties pass for G-Counter and PN-Counter across generated inputs; a deliberately broken merge (e.g. `+` instead of `max`) is caught.

**Model solution.**

```python
from hypothesis import given, strategies as st
from collections import defaultdict


def gmerge(a, b):  # correct G-counter merge
    out = defaultdict(int, a)
    for k, v in b.items():
        out[k] = max(out[k], v)
    return dict(out)


def broken_merge(a, b):  # BUG: addition, not max
    out = defaultdict(int, a)
    for k, v in b.items():
        out[k] += v
    return dict(out)


counter = st.dictionaries(st.sampled_from("abc"),
                          st.integers(min_value=0, max_value=50))


def laws(merge):
    @given(counter, counter, counter)
    def check(a, b, c):
        assert merge(a, b) == merge(b, a)                       # commutative
        assert merge(merge(a, b), c) == merge(a, merge(b, c))   # associative
        assert merge(a, a) == dict(defaultdict(int, a))         # idempotent
    return check


def test_pbt_laws():
    laws(gmerge)()                      # passes
    try:
        laws(broken_merge)()            # must fail on idempotence/assoc
        raise AssertionError("broken merge should have failed laws")
    except AssertionError as e:
        if "should have failed" in str(e):
            raise
    print("Task 13 OK")


# PN-counter as a pair of G-counters; merge each component independently.
def pn_merge(a, b):
    return {"P": gmerge(a["P"], b["P"]), "N": gmerge(a["N"], b["N"])}


def pn_value(s):
    return sum(s["P"].values()) - sum(s["N"].values())


if __name__ == "__main__":
    test_pbt_laws()
```

Property-based testing is the right tool because the laws are **universally quantified over all states** — exactly what example tests under-cover. See [Counter tasks](../03-counters-g-pn/tasks.md) for deeper PN-Counter exercises and [Set tasks](../04-sets-or-set-lww/tasks.md) for OR-Set/LWW lattice checks.

---

## Expert

### Task 14 — Design the delivery + GC infrastructure for an op-based deployment **[design]** `[hard]`

**Statement.** You are deploying a CmRDT (say an op-based RGA text sequence) across N replicas over an unreliable WAN. Design the full delivery-and-garbage-collection stack **without code**: message log, retransmit, dedup, causal-stability detection, and log truncation. Then analyze its cost versus a state-based deployment of the same type.

**Model solution.**

**Required guarantee.** The RGA needs **reliable causal-order delivery** (operations like `insert-after(id)` causally depend on the element `id` they reference). So the stack must provide: at-least-once + dedup (= effectively exactly-once) + causal ordering.

**Components.**

1. **Per-replica op log.** Each op is `(origin, seq, vector_clock, payload)`. `(origin, seq)` is the unique id used for dedup; the vector clock drives causal delivery. The log is the durable source of truth for retransmission.

2. **Reliable broadcast / retransmit.** Each receiver acks `(origin, seq)`. Sender keeps an op in its **retransmit buffer** until acked by *all* live replicas (or by an anti-entropy reconciliation). Periodic anti-entropy: a replica advertises a digest (per-origin highest contiguous seq) and pulls gaps. This gives at-least-once even across crashes.

3. **Dedup.** Receiver maintains, per origin, the highest contiguous delivered seq plus a small out-of-order window. An op whose `(origin, seq)` is below the contiguous mark or already in the window is dropped. This makes redelivery idempotent at the protocol layer, so application-level ops need not be idempotent.

4. **Causal delivery.** Buffer an op until its vector-clock dependencies are met (Task 7's logic). Concurrent ops may be delivered in any order — the CmRDT guarantees they commute.

5. **Causal stability & log truncation (GC).** An op `o` is **causally stable** once *every* replica has delivered `o` and all of `o`'s causal predecessors — i.e., once the minimum across replicas of their vector clocks dominates `o`'s clock. Track the **stable cut** = component-wise `min` of all replicas' acked vector clocks (gathered via a low-rate gossip of acks). Ops below the stable cut can never be needed for retransmit or for ordering future ops, so:
   - **Truncate the retransmit buffer** below the stable cut.
   - **Compact tombstones** (e.g., RGA's deleted-but-retained nodes can be physically removed once their delete op is stable, because no replica can still reference them out of order).

6. **Membership / failure handling.** The stable cut stalls if a replica is down — a crashed node holds back GC. Use a **failure detector + epoch/membership change**: evicting a presumed-dead replica advances the cut but risks resurrecting its un-acked ops if it returns; reconcile via anti-entropy on rejoin (or fence with a generation number).

**Cost analysis vs state-based.**

| Dimension | Op-based (this design) | State-based (same RGA) |
|---|---|---|
| Per-update wire | 1 small op (`O(1)`) | full/delta state; full = `O(state)`, delta = `O(changed)` |
| Delivery guarantee | reliable **causal** (heavy: VCs, buffering, acks) | eventual any-order (light: idempotent merge) |
| Metadata | per-op VC + retransmit buffer + ack matrix | per-element causal metadata in state (e.g. dots) |
| GC complexity | **high**: causal-stability tracking, log truncation, membership-aware cut | merge is self-cleaning for grow-only; tombstone GC still needed for removes |
| Failure tolerance | a slow replica stalls GC and grows logs | a slow replica just lags; next gossip catches it up |
| Latency to converge | low (ops are tiny, sent eagerly) | depends on gossip period and state size |

**Verdict.** Op-based buys **small, eager messages** at the price of a **demanding delivery + GC substrate** (causal order, dedup, stability detection, membership-aware truncation). State-based buys **operational simplicity and crash-robustness** (idempotent merge over a flaky channel) at the price of **large messages** — unless you adopt delta-state to shrink them.

---

### Task 15 — Causal-stability and log-truncation algorithm **[proof]** `[hard]`

**Statement.** Formalize the causal-stability predicate from Task 14 and prove that truncating the op log below the **stable cut** is safe: no truncated op is ever needed for (a) retransmission or (b) causal ordering of a future op.

**Model proof.**

**Setup.** Replicas `R = {1..N}`, each with vector clock `VC_i` recording the highest seq delivered from every origin. Define the **stable cut** `C` by `C[r] = min_{i∈R} VC_i[r]` for each origin `r`. An op `o` from origin `r` with seq `s` is **causally stable** iff `s ≤ C[r]`, i.e. *every* replica has delivered `o` (and, since delivery is causal, all of `o`'s predecessors).

**Claim.** If `o` is causally stable, removing `o` from every log/buffer is safe.

*Proof of (a) retransmission.* The retransmit buffer exists to re-send an op to a replica that has not yet delivered it. By definition of `C`, `o` stable ⇒ for all `i`, `VC_i[r] ≥ s` ⇒ every replica has already delivered `o`. There is no replica left to retransmit to. (Replica failure/rejoin is handled by membership: a rejoining replica reconciles via anti-entropy digest, not via the truncated buffer; its acks were not part of `C` while it was evicted.) Hence dropping `o` from the retransmit buffer cannot cause a lost delivery. ∎(a)

*Proof of (b) causal ordering.* A future op `p` can only causally depend on `o` if `p` is generated *after* its origin delivered `o`. For the buffering logic to ever **need** `o`, some replica must hold `p` while not yet having delivered `o` — i.e. `VC_i[r] < s` for that replica. But `o` stable ⇒ `VC_i[r] ≥ s` for *all* `i`. Contradiction: no replica is missing `o`, so no buffered op is waiting on `o`. Therefore `o` is never consulted again for ordering decisions, and removing the metadata that records it (its VC entry beyond the contiguous mark, its tombstone) cannot delay or misorder any future delivery. ∎(b)

**Liveness caveat.** `C` advances only as the slowest replica advances; a permanently-down replica freezes `C` and prevents truncation (logs grow unbounded). Safety (above) is unconditional, but **liveness of GC** requires a failure detector + membership protocol to evict dead replicas from the `min`, accepting the risk handled by epoch-fencing in Task 14. ∎

---

### Task 16 — When does delta-state beat *both* state- and op-based? **[design]** `[hard]`

**Statement.** Reason about the regime where **delta-state CRDTs** dominate both pure state-based and pure op-based designs, and where they do *not*. Give the decision criteria a senior engineer should apply.

**Model solution.**

**What delta-state is.** A delta-CRDT ships **δ-mutators**: small lattice fragments produced by each update, merged with the same join as full state. Deltas are buffered and gossiped via anti-entropy; merge is idempotent/commutative/associative, so **delivery may drop, dup, and reorder** (only *eventual* delivery is required — strictly weaker than op-based causal delivery).

**Delta-state dominates when ALL of:**

1. **State is large but each update touches little.** Full-state gossip costs `O(|state|)` per round; delta gossip costs `O(|change|)`. The bigger the ratio, the bigger the win (Task 10). Examples: large OR-Sets, big counters-of-counters, maps with many keys.

2. **The channel is unreliable / you don't want a delivery substrate.** You keep state-based's robustness — a lost delta is just re-covered by the next anti-entropy round carrying current state or a wider delta-interval. No acks, no causal buffering, no dedup machinery (idempotent merge handles dups). This is the killer advantage over op-based, which needs reliable causal delivery + GC (Tasks 14–15).

3. **Churny membership / frequent rejoins.** A rejoining or new replica is brought up to date by **state-transfer of the join** (or a delta-interval), not by replaying a causal op log. No log truncation/stability problem to stall on a dead node.

**Delta-state does NOT dominate when:**

- **Updates are large or touch most of the state.** Then the delta ≈ the full state; you pay state-based costs without benefit. Just gossip full state (simpler).

- **You need the absolute minimum per-update bytes AND can afford a reliable causal substrate.** Pure op-based ships the single smallest possible message (one op) and, if you already run reliable causal broadcast (e.g., atop a consensus/log system), the GC burden is shared infrastructure. High-throughput collaborative editors sometimes choose op-based RGA for exactly this.

- **Operations don't have a natural lattice encoding.** Some semantics (non-commutative, intent-carrying ops) are awkward to express as monotone state fragments; op-based with causal delivery is the more natural fit (Task 8's dependent add/remove).

- **Delta-buffer management has hidden cost.** Naively keeping all deltas forever recreates the unbounded-log problem; you need delta-interval acks and buffer pruning (an anti-entropy ack protocol). It is lighter than op-based causal-stability GC but not free.

**Decision rule (rule of thumb).**

```
if update_size ≈ state_size:            use plain STATE-BASED (full gossip)
elif channel is reliable+causal AND
     you want minimum per-op bytes AND
     ops are intent-heavy/non-commutative: use OP-BASED (CmRDT)
elif state large, updates small,
     channel unreliable, churny membership: use DELTA-STATE
else:                                    default to DELTA-STATE
```

**One-line summary.** *Delta-state is the pragmatic default for production CRDTs*: it keeps the **weak-delivery robustness of state-based** while recovering most of the **wire economy of op-based**, paying only a modest delta-buffer/anti-entropy cost — and it sidesteps the op-based causal-delivery + causal-stability-GC machinery that dominates the operational complexity of CmRDT deployments (Tasks 14–15).

---

Notes by tier: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)
