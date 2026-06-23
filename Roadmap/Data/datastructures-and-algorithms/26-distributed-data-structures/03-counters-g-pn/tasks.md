# Distributed Counters — Practice Tasks

> A graded problem set on convergent replicated counters: the **G-Counter** (grow-only) and the **PN-Counter** (positive-negative). Code is **Python first**, with **Go** shown where it clarifies a concurrency or wire-format point. Work the tasks in order — each tier assumes the invariants proved in the one before.
>
> Every task carries a tag: **[coding]** (write runnable code that passes a test), **[proof]** (a short rigorous argument), or **[design]** (a written design with an analysis, no code required). Difficulty is **[easy]**, **[medium]**, or **[hard]**.
>
> **The convergence acceptance test, defined once.** A counter is correct only if *every* replica that has seen the same set of operations reports the same value, regardless of the order, duplication, or loss with which sync messages arrived. So the canonical harness is: generate a workload of local increments/decrements, then **replay the sync messages between replicas under an adversary that drops, duplicates, and reorders them**, and finally assert the value at every replica equals the *exact* expected total. If a solution converges only when the network is well-behaved, it is wrong. Several tasks below hand you this adversary and ask you to break or defend a design against it.
>
> **Related practice:** [CRDT Fundamentals tasks](../01-crdt-fundamentals/tasks.md) · [State vs Op tasks](../02-state-vs-operation-based-crdts/tasks.md) · [Set tasks](../04-sets-or-set-lww/tasks.md)
>
> Notes: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

---

## Conventions used by every task

A **replica id** is a stable string (`"A"`, `"B"`, …) naming one actor that is allowed to mutate the counter. A **G-Counter state** is a map `replica_id -> non-negative int`; its **value** is the sum of all entries; its **merge** is the element-wise maximum. A **PN-Counter** is a pair of G-Counters `(P, N)` and its value is `value(P) - value(N)`.

Throughout, the *expected total* of a workload is computed by a trivial sequential oracle — just add every increment and subtract every decrement once. The whole point of the harness is that the distributed machinery must agree with that oracle no matter what the network does.

```python
# shared_harness.py — imported by many model solutions below
import random

def adversary(messages, *, drop=0.3, dup=0.4, seed=0):
    """Take an ordered list of sync messages and return a SHUFFLED list
    where some are dropped and some are duplicated. Models an at-most-once
    *and* at-least-once network simultaneously, plus reordering."""
    rng = random.Random(seed)
    out = []
    for m in messages:
        if rng.random() < drop:
            continue                      # message lost
        out.append(m)
        while rng.random() < dup:         # message redelivered 1+ times
            out.append(m)
    rng.shuffle(out)                      # arbitrary reordering
    return out
```

The adversary is deliberately harsh: with `drop=0.3` a third of messages vanish, so a correct *state-based* design must still converge **as long as the final sync is delivered** — which the harnesses guarantee by running a quiescent "flush every state to every replica" round at the end.

---

## Beginner

### Task 1 — Implement a G-Counter **[coding] [easy]**

**Statement.** Write a `GCounter` class supporting `inc(amount=1)` (increment *this* replica's own slot only), `value()` (the running total), and `merge(other)` (fold another replica's state into this one). A replica may only ever write to its own slot; it learns about other slots exclusively through `merge`.

**Acceptance test.** Two replicas each increment locally, exchange states once in each direction, and must then agree on the sum of all increments.

```python
def test_gcounter_basic():
    a = GCounter("A")
    b = GCounter("B")
    a.inc(3)
    b.inc(5)
    a.inc(2)          # A's slot now 5
    a.merge(b)        # A learns B = 5  -> value 10
    b.merge(a)        # B learns A = 5  -> value 10
    assert a.value() == 10
    assert b.value() == 10
```

**Model solution.**

```python
class GCounter:
    def __init__(self, replica_id):
        self.id = replica_id
        self.counts = {}                       # replica_id -> int

    def inc(self, amount=1):
        if amount < 0:
            raise ValueError("G-Counter cannot decrease")
        self.counts[self.id] = self.counts.get(self.id, 0) + amount

    def value(self):
        return sum(self.counts.values())

    def merge(self, other):
        for rid, c in other.counts.items():
            self.counts[rid] = max(self.counts.get(rid, 0), c)
        return self
```

The two load-bearing rules: `inc` touches *only* `self.id`, and `merge` takes a per-slot **max**. Because each replica owns its slot, no two replicas ever write the same slot, so the max never throws away a real increment — it only catches up a stale view.

---

### Task 2 — Convergence under a hostile network **[coding] [easy]**

**Statement.** Wrap your `GCounter` in a harness that produces a sync message per `merge` step, runs them through `adversary(...)`, and verifies convergence. This is the canonical acceptance test from the intro, instantiated for the grow-only case.

**Acceptance test.** After replaying shuffled + duplicated + lossy sync messages and one final guaranteed flush, all three replicas report the exact sum of increments.

```python
from shared_harness import adversary

def test_gcounter_converges_under_chaos():
    ids = ["A", "B", "C"]
    reps = {i: GCounter(i) for i in ids}
    increments = [("A", 4), ("B", 1), ("C", 7), ("A", 2), ("C", 3)]
    expected = sum(a for _, a in increments)   # oracle = 17

    # 1. local work, snapshot a sync message after each step
    msgs = []
    for rid, amt in increments:
        reps[rid].inc(amt)
        msgs.append((rid, dict(reps[rid].counts)))   # (sender, state copy)

    # 2. adversary mangles the stream
    for sender, state in adversary(msgs, seed=42):
        for other in ids:
            if other != sender:
                tmp = GCounter(sender); tmp.counts = dict(state)
                reps[other].merge(tmp)

    # 3. guaranteed final flush so every node sees the latest of every slot
    for _ in range(2):
        for x in ids:
            for y in ids:
                reps[y].merge(reps[x])

    for i in ids:
        assert reps[i].value() == expected, (i, reps[i].value())
```

**Model solution.** No new code — the `GCounter` from Task 1 passes this as written. The lesson is *why*: merge is **idempotent** (a duplicated message changes nothing because `max(x, x) == x`), **commutative** (reordering does not matter because max does not care about order), and the final flush guarantees the *latest* value of each slot reaches every replica even though intermediate messages were dropped. Those three properties are exactly what the adversary stresses.

---

### Task 3 — Implement a PN-Counter and decrement it **[coding] [easy]**

**Statement.** A G-Counter cannot go down. Build a `PNCounter` as two G-Counters, `P` (increments) and `N` (decrements), with `value() = value(P) - value(N)`. Implement `inc`, `dec`, and `merge`.

**Acceptance test.** A workload with decrements converges to a possibly-negative total under the chaos harness.

```python
def test_pncounter_decrement():
    a, b = PNCounter("A"), PNCounter("B")
    a.inc(10); a.dec(3)        # A net +7
    b.dec(5)                   # B net -5
    a.merge(b); b.merge(a)
    assert a.value() == 2 and b.value() == 2   # 10 - 3 - 5
```

**Model solution.**

```python
class PNCounter:
    def __init__(self, replica_id):
        self.id = replica_id
        self.P = GCounter(replica_id)
        self.N = GCounter(replica_id)

    def inc(self, amount=1):
        self.P.inc(amount)

    def dec(self, amount=1):
        self.N.inc(amount)        # a decrement is an *increment* of N

    def value(self):
        return self.P.value() - self.N.value()

    def merge(self, other):
        self.P.merge(other.P)
        self.N.merge(other.N)
        return self
```

The trick that makes decrements safe: never subtract from a slot. Decrementing means *growing* a parallel grow-only tally, and the final value is the difference of two monotone numbers. Two grow-only counters that each converge give a difference that converges.

---

### Task 4 — Prove element-wise max is a join **[proof] [medium]**

**Statement.** Prove that G-Counter `merge` — the element-wise maximum of two count maps — is **commutative**, **associative**, and **idempotent**. These three are exactly the algebraic laws a state-based CRDT merge must satisfy (it must be the join of a semilattice).

**Acceptance test.** A complete argument that reduces each of the three counter-level laws to the corresponding scalar law of `max` over the integers.

**Model proof.**

Let states be total functions from replica ids to integers (a missing slot is the integer `0`, which is the identity element, so we may treat every state as defined on the full id set). Define `(x ⊔ y)(k) = max(x(k), y(k))` for each id `k`.

The three laws hold **pointwise**, because for each fixed `k` the operation is just `max` on `ℤ`:

1. **Commutativity.** `max(a, b) = max(b, a)` for all integers `a, b`. Therefore `(x ⊔ y)(k) = (y ⊔ x)(k)` for every `k`, so `x ⊔ y = y ⊔ x`.

2. **Associativity.** `max(max(a, b), c) = max(a, b, c) = max(a, max(b, c))`. Applying this at every `k` gives `(x ⊔ y) ⊔ z = x ⊔ (y ⊔ z)`.

3. **Idempotence.** `max(a, a) = a`. At every `k`, `(x ⊔ x)(k) = max(x(k), x(k)) = x(k)`, so `x ⊔ x = x`.

Because all three hold, `⊔` is the join of a semilattice ordered by `x ≤ y ⇔ ∀k. x(k) ≤ y(k)`. Idempotence kills duplicate delivery, commutativity and associativity kill reordering and regrouping — which is precisely why the Task 2 adversary cannot break convergence. ∎

---

## Intermediate

### Task 5 — Counterexample: summing slots double-counts **[proof] [medium]**

**Statement.** A tempting "simplification" is to define `merge` as the element-wise **sum** of slots instead of the **max**. Show by a concrete counterexample that summing breaks convergence — specifically, that it makes `merge` non-idempotent, so a single redelivered message inflates the total.

**Acceptance test.** A minimal scenario, executable, where two deliveries of the *same* state produce a value strictly greater than the true total.

**Model proof / demonstration.**

Suppose replica `A` has done `inc(5)`, so its state is `{"A": 5}` with true value `5`. Replica `B` starts empty and receives `A`'s state **twice** (the network duplicated it):

```python
def test_summing_double_counts():
    # WRONG merge for contrast
    def bad_merge(dst, src):
        for k, v in src.items():
            dst[k] = dst.get(k, 0) + v        # SUM, not max
        return dst

    b = {}
    a_state = {"A": 5}
    bad_merge(b, a_state)      # b = {"A": 5}, value 5  (correct so far)
    bad_merge(b, a_state)      # b = {"A": 10}, value 10  -- WRONG
    assert sum(b.values()) == 10        # true value is 5; we doubled it
```

Formally, with sum-merge `(x ⊔ x)(k) = x(k) + x(k) = 2·x(k) ≠ x(k)` whenever `x(k) > 0`. Idempotence fails, so by the requirement proved in Task 4 the operation is not a valid join, and any network that can duplicate a message (every real network) will over-count. **Max is not an optimization choice — it is the only element-wise operation that keeps merge idempotent while never losing an increment.** ∎

---

### Task 6 — Op-based counter: expose and fix the redelivery double-count **[coding] [hard]**

**Statement.** Build an **operation-based** counter that ships *deltas* (`+3`, `-1`) rather than full state, and apply each received op by adding it to a running integer. First **demonstrate** that a redelivered op double-counts (op-based CRDTs require exactly-once *effect*). Then **fix** it with per-source deduplication so the effect is exactly-once even though the network is at-least-once.

**Acceptance test.** Part (a): naive apply over a duplicated stream overshoots. Part (b): the dedup version hits the exact total under the full chaos harness.

```python
def test_opcounter_naive_overshoots():
    c = NaiveOpCounter()
    ops = [("A", 1, 3), ("B", 1, -1)]            # (src, seq, delta)
    stream = ops + [ops[0]]                       # A's +3 redelivered
    for src, seq, d in stream:
        c.apply(src, seq, d)
    assert c.value() == 5                         # WRONG: true total is 2

def test_opcounter_dedup_exact():
    from shared_harness import adversary
    c = DedupOpCounter()
    ops = [("A", 1, 4), ("A", 2, -2), ("B", 1, 9), ("C", 1, -1)]
    true_total = 4 - 2 + 9 - 1                    # = 10
    for src, seq, d in adversary([(o, None) for o in ops], seed=7):
        s, q, delta = src                         # adversary wraps as (op, _)
        c.apply(s, q, delta)
    assert c.value() == true_total
```

**Model solution.**

```python
class NaiveOpCounter:
    def __init__(self):
        self.total = 0
    def apply(self, src, seq, delta):
        self.total += delta            # blindly trusts the network
    def value(self):
        return self.total

class DedupOpCounter:
    """Exactly-once effect via per-source sequence numbers."""
    def __init__(self):
        self.total = 0
        self.seen = {}                 # src -> set of applied seq numbers
    def apply(self, src, seq, delta):
        applied = self.seen.setdefault(src, set())
        if seq in applied:             # already counted this op -> ignore
            return
        applied.add(seq)
        self.total += delta
    def value(self):
        return self.total
```

The naive version is correct **only** on an exactly-once network, which does not exist. Tagging each op with `(source, sequence)` and skipping ones we have already applied restores idempotent *delivery* on top of an at-least-once channel. (In production the `seen` set is compacted to a per-source contiguous high-water mark plus a small gap set, so it does not grow without bound — see Task 16.) This is the central reason op-based counters need delivery guarantees that state-based ones get for free: state-based merge is *intrinsically* idempotent (Task 4); op apply is not.

---

### Task 7 — Three-replica partition and heal **[coding] [medium]**

**Statement.** Simulate three PN-Counter replicas that **partition** into `{A}` and `{B, C}`, accept independent writes on both sides, then **heal** and gossip to quiescence. Assert the healed value equals the oracle. This is the scenario CRDTs exist for: availability under partition, convergence after.

**Acceptance test.** During the partition the two sides legitimately disagree; after healing every replica equals the exact net total.

```python
def test_partition_heal():
    A, B, C = PNCounter("A"), PNCounter("B"), PNCounter("C")

    # --- partition: {A} | {B, C} ; no cross-talk allowed ---
    A.inc(10); A.dec(2)                 # A side: net +8
    B.inc(5)
    C.dec(1)
    B.merge(C); C.merge(B)              # B,C gossip within their partition
    # at this moment the partitions disagree, which is correct:
    assert A.value() == 8
    assert B.value() == 4               # 5 - 1, A's writes invisible here

    # --- heal: full gossip to quiescence ---
    for _ in range(3):
        for x, y in [(A, B), (B, C), (C, A), (B, A), (C, B), (A, C)]:
            y.merge(x)

    expected = 10 - 2 + 5 - 1           # = 12
    assert A.value() == B.value() == C.value() == expected
```

**Model solution.** Reuse the `PNCounter` from Task 3 unchanged. The simulation itself *is* the deliverable; the insight to articulate is that **disagreement during a partition is not a bug** — each side returns a locally-consistent answer and stays available — and that healing is just more merges, which are safe to repeat (idempotent) and safe to interleave (commutative/associative). No conflict resolution, no quorum, no rollback.

---

## Advanced

### Task 8 — Delta-state PN-Counter: measure bytes on the wire **[coding] [hard]**

**Statement.** Full-state gossip re-sends the *entire* count map every round, which is wasteful when only one slot changed. Implement a **delta-state** PN-Counter that emits only the slots that changed since the last sync to a given peer, and **measure** the bytes shipped versus full-state gossip over an identical workload. Deltas must still merge correctly under the chaos harness.

**Acceptance test.** (1) The delta version converges to the same value as the full-state version under `adversary`. (2) Total serialized bytes for deltas is strictly less than for full state on a workload that touches few slots per round.

```python
import json
from shared_harness import adversary

def test_delta_converges_and_is_smaller():
    full = PNCounter("A")
    delta = DeltaPNCounter("A")
    other_full = PNCounter("B")
    other_delta = DeltaPNCounter("B")

    full_bytes = delta_bytes = 0
    for step in range(50):
        full.inc(1); delta.inc(1)                      # only A's slot moves

        fmsg = json.dumps({"P": full.P.counts, "N": full.N.counts})
        full_bytes += len(fmsg)
        other_full.merge(full)

        d = delta.take_delta_for("B")                  # only changed slots
        dmsg = json.dumps(d)
        delta_bytes += len(dmsg)
        other_delta.apply_delta(d)

    assert other_full.value() == other_delta.value() == 50
    assert delta_bytes < full_bytes
    print(f"full={full_bytes}B  delta={delta_bytes}B  "
          f"saved={100*(1-delta_bytes/full_bytes):.0f}%")
```

**Model solution.**

```python
class DeltaPNCounter:
    def __init__(self, replica_id):
        self.id = replica_id
        self.P = {}
        self.N = {}
        # what we believe peer last acknowledged, per peer, so we can
        # send only newer slots; here keyed by (peer, 'P'/'N', slot)
        self._acked = {}

    def inc(self, amount=1):
        self.P[self.id] = self.P.get(self.id, 0) + amount

    def dec(self, amount=1):
        self.N[self.id] = self.N.get(self.id, 0) + amount

    def value(self):
        return sum(self.P.values()) - sum(self.N.values())

    def take_delta_for(self, peer):
        """Return only slots whose value exceeds what `peer` last acked."""
        delta = {"P": {}, "N": {}}
        for tag, book in (("P", self.P), ("N", self.N)):
            for slot, v in book.items():
                if v > self._acked.get((peer, tag, slot), 0):
                    delta[tag][slot] = v
                    self._acked[(peer, tag, slot)] = v
        return delta

    def apply_delta(self, delta):
        for tag, book in (("P", self.P), ("N", self.N)):
            for slot, v in delta[tag].items():
                book[slot] = max(book.get(slot, 0), v)   # still a max-merge!
        return self
```

The delta carries the same *kind* of payload as full state — slot values that get max-merged — so idempotence and commutativity (Task 4) are preserved and the chaos test still passes; a re-applied delta is just a redundant max. The savings come purely from omitting unchanged slots. The deliberate subtlety: a delta must be a **lower bound that grows**, never a difference like `+1`, otherwise a dropped delta would lose an increment forever. We ship "A is at least 37," not "add 1 to A."

---

### Task 9 — Sharded counter for a hot key **[coding] [medium]**

**Statement.** A single counter slot updated by thousands of threads is a contention hotspot. Implement a **sharded counter** that splits one logical counter into `k` independent sub-counters; a writer increments a randomly (or thread-) chosen shard, and the value is the **sum of all shards**. Show it is contention-free per shard yet still totals correctly. (This is the same trick as Java's `LongAdder`.)

**Acceptance test.** Concurrent increments across shards lose nothing; the read equals the number of increments.

```python
import threading

def test_sharded_counter_no_loss():
    c = ShardedCounter(shards=16)
    N = 8
    per = 10_000
    def worker():
        for _ in range(per):
            c.inc()
    threads = [threading.Thread(target=worker) for _ in range(N)]
    for t in threads: t.start()
    for t in threads: t.join()
    assert c.value() == N * per     # 80_000, nothing lost to contention
```

**Model solution (Python, with per-shard locks).**

```python
import random, threading

class ShardedCounter:
    def __init__(self, shards=16):
        self._counts = [0] * shards
        self._locks = [threading.Lock() for _ in range(shards)]

    def inc(self, amount=1):
        i = random.randrange(len(self._counts))   # spread load across shards
        with self._locks[i]:                       # contend only within shard
            self._counts[i] += amount

    def value(self):
        # read-side sum; with per-shard locks this is eventually-consistent
        # under concurrent writes, exact once writers quiesce
        return sum(self._counts)
```

**Go variant (shows the lock-free intent more sharply):**

```go
package counter

import (
	"sync/atomic"
)

type Sharded struct{ cells []atomic.Int64 }

func NewSharded(k int) *Sharded { return &Sharded{cells: make([]atomic.Int64, k)} }

func (s *Sharded) Inc(shard int) { s.cells[shard%len(s.cells)].Add(1) }

func (s *Sharded) Value() int64 {
	var total int64
	for i := range s.cells {
		total += s.cells[i].Load()
	}
	return total
}
```

The trade is explicit: writes scale with shard count (no two writers fight over the same cell unless they hash to it), reads cost `O(k)` and are only a *snapshot* — they may straddle in-flight writes, exactly like reading a distributed counter mid-gossip. Choose `k` near your write concurrency; far beyond it you just pay read cost for no benefit.

---

### Task 10 — Property-based convergence tester **[coding] [hard]**

**Statement.** Stop hand-picking scenarios. Write a **property-based** test that, for thousands of random workloads and random adversarial delivery schedules, asserts the CRDT property directly: **any two replicas that have received the same set of operations have equal value, and the converged value equals the oracle.** Use `hypothesis`.

**Acceptance test.** The property holds across generated cases; deliberately injecting the buggy sum-merge from Task 5 makes it fail (proving the test has teeth).

```python
from hypothesis import given, strategies as st, settings

ops = st.tuples(
    st.sampled_from(["A", "B", "C"]),
    st.sampled_from(["inc", "dec"]),
    st.integers(min_value=1, max_value=100),
)

@settings(max_examples=500)
@given(workload=st.lists(ops, min_size=0, max_size=80),
       seed=st.integers(0, 1 << 30))
def test_pncounter_property(workload, seed):
    reps = {i: PNCounter(i) for i in ["A", "B", "C"]}
    oracle = 0
    msgs = []
    for rid, op, amt in workload:
        if op == "inc":
            reps[rid].inc(amt); oracle += amt
        else:
            reps[rid].dec(amt); oracle -= amt
        # snapshot a deep copy as a sync message
        snap = PNCounter(rid)
        snap.P.counts = dict(reps[rid].P.counts)
        snap.N.counts = dict(reps[rid].N.counts)
        msgs.append((rid, snap))

    from shared_harness import adversary
    for sender, snap in adversary(msgs, seed=seed):
        for other in reps:
            if other != sender:
                reps[other].merge(snap)

    # guaranteed final flush
    for _ in range(2):
        for x in reps.values():
            for y in reps.values():
                y.merge(x)

    vals = {i: r.value() for i, r in reps.items()}
    assert len(set(vals.values())) == 1, vals       # all replicas agree
    assert next(iter(vals.values())) == oracle, (vals, oracle)
```

**Model solution.** The test *is* the artifact; the `PNCounter` from Task 3 passes it. The point is methodological: a CRDT's correctness is a *universally quantified* property over workloads and schedules, so example tests under-sample the space. Property tests sample it densely and **shrink** any failure to a minimal counterexample. To prove the test bites, swap `GCounter.merge`'s `max` for `+` and watch hypothesis shrink to a two-op, one-duplicate witness — the same shape you constructed by hand in Task 5.

---

## Expert

### Task 11 — Escrow counter that never oversells under partition **[coding] [hard]**

**Statement.** A plain PN-Counter has **no lower bound** — under partition, replicas can independently decrement past zero, and merging just sums the damage. For an inventory/quota counter that must **never go negative** (never oversell), implement an **escrow** counter: a fixed total is partitioned into per-replica **local quotas**; a replica may only decrement against its *own* remaining quota, and quota can be **transferred** between replicas when they can communicate. Show that (a) the escrow counter cannot oversell even when partitioned, and (b) a plain PN-Counter *can*.

**Acceptance test.** Concurrent partitioned spends on the escrow counter respect the global limit; the same workload on a plain PN-Counter drives the value negative (oversells).

```python
def test_escrow_never_oversells():
    # 100 units total, split 50/50 between A and B
    esc = {"A": Escrow("A", quota=50), "B": Escrow("B", quota=50)}

    # PARTITION: each side spends independently, no transfers possible
    a_ok = sum(esc["A"].spend(10) for _ in range(8))   # only 5 succeed (50/10)
    b_ok = sum(esc["B"].spend(10) for _ in range(8))   # only 5 succeed
    assert a_ok == 5 and b_ok == 5
    # global units sold = 100, never more than the 100 available
    assert esc["A"].sold() + esc["B"].sold() == 100

def test_plain_pncounter_can_oversell():
    # model "100 units" as a PN-Counter starting at 100; spend = dec(10)
    A, B = PNCounter("A"), PNCounter("B")
    A.inc(100); B.merge(A)            # both see 100 available
    # partition: each side naively spends 8*10 = 80 against the SAME 100
    for _ in range(8): A.dec(10)
    for _ in range(8): B.dec(10)
    A.merge(B); B.merge(A)
    # 100 - 80 - 80 = -60  -> oversold by 60 units; nothing stopped it
    assert A.value() == -60
    assert A.value() < 0              # the failure the escrow design prevents
```

**Model solution.**

```python
class Escrow:
    """Bounded, never-negative counter. Each replica may only spend against
    its own local quota. Total quota across replicas == global limit, and
    transfers conserve it, so the global floor of 0 is never crossed."""
    def __init__(self, replica_id, quota):
        self.id = replica_id
        self.quota = quota          # units this replica may still spend
        self._sold = 0              # units this replica has spent

    def spend(self, amount):
        if amount <= self.quota:    # purely LOCAL decision -> works partitioned
            self.quota -= amount
            self._sold += amount
            return 1                # success
        return 0                    # refuse rather than oversell

    def sold(self):
        return self._sold

    def transfer(self, other, amount):
        """Move spare quota to a starving replica when reachable.
        Conserves total quota, so the global invariant is preserved."""
        if amount <= self.quota:
            self.quota -= amount
            other.quota += amount
            return True
        return False
```

**Why the escrow holds and the PN-Counter fails.** The invariant is `Σ_replicas (quota + sold) = global_limit`, established at split time and preserved by both operations: `spend` moves a unit from `quota` to `sold` on the same replica (sum unchanged); `transfer` moves quota between replicas (sum unchanged). Since `spend` refuses when `amount > self.quota`, no replica's `sold` ever exceeds its share, so `Σ sold ≤ global_limit` **always — including during partition, with zero coordination.** The plain PN-Counter has *no such invariant*: a decrement is unconditional, two partitions decrement the same logical stock independently, and merge faithfully sums both into a negative total. Escrow trades a little availability (a replica with exhausted quota must wait for a transfer even if global stock remains) for the hard safety guarantee — the textbook split between *liveness* and *safety* in partitioned systems.

---

### Task 12 — Actor-id GC / handoff for millions of ephemeral clients **[design] [hard]**

**Statement.** Both G- and PN-Counters carry **one slot per writer that has ever incremented**. With millions of short-lived clients (mobile devices, lambda invocations, browser tabs) each minting a fresh actor id, the count map grows **without bound** — metadata dwarfs the single integer it protects. Design (no code required) an **actor-id garbage-collection / handoff** scheme that bounds the number of live slots, and analyze the resulting bound. Address: when an id may be retired, how its accumulated count is preserved, how retirement converges without a central authority, and what the worst-case slot count is.

**Acceptance test.** A written design that (1) never loses or double-counts a retired actor's contribution, (2) bounds live slots to roughly the number of *durable* actors rather than the number of *historical* actors, and (3) explains how the scheme tolerates the same drop/dup/reorder network the coding tasks fought.

**Model solution (design).**

**The problem restated.** Slot count is `|{actors that ever incremented}|`, which is unbounded in time. We want it to track `|{durable server-side actors}|` (a small fixed pool), independent of how many ephemeral clients pass through.

**Core idea — clients never own slots; they hand off to a durable sink.** Ephemeral clients do **not** mint their own permanent slot. Instead each client buffers its increments locally and, on sync, performs a **handoff**: it folds its accumulated count into one of a small, fixed set of **durable aggregator actors** (e.g. the regional servers, of which there are `S`). The transfer is the same conserved move as escrow's `transfer` (Task 11): subtract from the client's pending buffer, add to the aggregator's slot, total preserved. Once a client's buffer reaches zero and it has confirmed the aggregator absorbed it, the client's identity can vanish — it owned no permanent slot to leak.

**Making handoff safe under a hostile network.** A naive "add my buffer to the server" double-counts on redelivery (Task 6 all over again). So handoff is **idempotent by construction**: the client tags its lifetime contribution with a monotonic `(client_id, seq)` and the server applies it via the *same max-merge*, treating the client's lifetime total as a grow-only quantity it has "seen up to." Concretely, the client's slot lives in a **side map keyed by ephemeral id but is reclaimable**: once every durable aggregator has merged a client's *final* total (a stable high-water mark), that ephemeral key is provably redundant — its value is already reflected in the aggregators' slots — and can be dropped. Dropping it is itself a convergent operation: we only remove a key after a **causal stability** check (all `S` aggregators acknowledge they have absorbed `≥` the client's final value), so no live replica still needs it.

**Why retirement converges without a coordinator.** Retirement is expressed as a tombstone-free *threshold*: replica `r` may garbage-collect ephemeral slot `e` once it observes that all `S` durable aggregators report having merged `e`'s final value. That observation is monotone (acknowledgements only accumulate) and derivable from state every replica already gossips, so two replicas that have seen the same gossip make the *same* retirement decision — no leader, no consensus. A replica that retires `e` early relative to a peer is harmless: the value is preserved in the aggregators, and re-learning `e` later just max-merges a value already dominated by the aggregator sum.

**The bound.** Live slot count is `S` durable aggregator slots **plus** the set of ephemeral slots whose handoff is *in flight but not yet causally stable*. If at most `C` clients are concurrently active within one stability window of length `W`, the worst-case map size is `O(S + C)` — crucially **independent of total historical clients**. With `S` a fixed small constant (say 16 regions) and `C` bounded by live connection count, metadata is bounded by *current* load, not *cumulative* load. The cost paid is the per-client `(client_id, seq)` dedup state retained for one stability window — `O(C)`, not `O(historical)` — and a `S`-way acknowledgement vector per in-flight ephemeral id.

**Trade-offs to call out.** (1) Handoff adds a round of latency before a client's increment is durably reflected in the global value, so the global read lags ephemeral writes by up to `W`. (2) The aggregator pool `S` is now a hot set — shard each aggregator slot (Task 9) to keep its own writes contention-free. (3) Stability requires hearing from *all* `S` aggregators; a permanently dead aggregator stalls GC of ids that handed off to it, so aggregator membership itself needs a (slow, rare) reconfiguration path. This is the same safety-vs-liveness tension as Task 11, now applied to metadata reclamation rather than to the counted quantity.

---

## Where to go next

You have now built every counter that matters in practice — grow-only, positive-negative, op-based with exactly-once effect, delta-state, sharded, escrow-bounded — and bounded their metadata. The next data type generalizes the same join-semilattice machinery from *integers under max* to *sets under union*:

- [Set tasks](../04-sets-or-set-lww/tasks.md) — G-Sets, 2P-Sets, and LWW/OR-Sets, where the merge is set union and the hard part is *removal*, exactly as decrement was the hard part here.
- [State vs Op tasks](../02-state-vs-operation-based-crdts/tasks.md) — revisit the delivery-guarantee dichotomy you met in Tasks 6 and 8 in its general form.
- [CRDT Fundamentals tasks](../01-crdt-fundamentals/tasks.md) — the semilattice laws you proved in Task 4, stated once for every CRDT.

Notes: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)
