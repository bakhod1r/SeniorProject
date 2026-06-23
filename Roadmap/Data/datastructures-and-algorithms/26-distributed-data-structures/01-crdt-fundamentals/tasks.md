# CRDT Fundamentals — Practice Tasks

> **Conventions.** Coding tasks are written primarily in **Python** (standard library only, runnable as-is); where a small **Go** port sharpens the idea — usually around immutability, value semantics, or wire encoding — it is included after the Python solution. Tasks tagged **[proof]** or **[analysis]** require no code, only a precise argument. For *every* CRDT coding task the acceptance test is the same **convergence discipline**: replay the same set of updates in many different orders, with arbitrary duplication and a partition/heal cycle, and assert that all replicas reach the *identical* state (byte-for-byte on the canonical form). If a "merge" passes one ordering but not another, it is not a CRDT — it is a bug with good luck.
>
> A merge that is **commutative, associative, and idempotent** (an ACI merge, i.e. a join on a semilattice) makes ordering, batching, and re-delivery irrelevant. Most tasks below are exercises in earning those three properties — or in proving you cannot have them.

**Related practice:** [State vs Op tasks](../02-state-vs-operation-based-crdts/tasks.md) · [Counter tasks](../03-counters-g-pn/tasks.md) · [Set tasks](../04-sets-or-set-lww/tasks.md)

**Topic notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

---

## How to self-grade

1. Read the **statement** and **what to build/prove**.
2. Attempt it before unfolding the model solution.
3. Run the **acceptance test** against your code. If it is a proof, check your argument hits every clause the model proof hits — a proof that "feels right" but skips idempotence is *wrong* for CRDTs.
4. Compare with the **model solution**. The model code is runnable; paste it into a file and execute.

A reusable convergence harness is built in **Task 2** and imported (conceptually) by later tasks. Read that one first even if you skip ahead.

---

# Beginner

### Task 1 — G-Set: a grow-only set **[coding]** `[easy]`

**Statement.** Implement a **G-Set** (grow-only set): a set that supports `add(e)` and `merge(other)` but never `remove`. This is the simplest non-trivial CRDT and the base case for almost everything else.

**What to build.**
- `GSet.add(e)` — record an element locally.
- `GSet.merge(other)` — return/produce a state equal to the set union.
- `GSet.value()` — the user-visible set.

**Acceptance test.** Two replicas add disjoint then overlapping elements; after exchanging states in *both directions* their values are equal and equal to the union of all added elements. Merging a replica with itself changes nothing.

<details>
<summary>Model solution (Python)</summary>

```python
class GSet:
    def __init__(self, elements=None):
        self._s = set(elements or ())

    def add(self, e):
        self._s.add(e)

    def merge(self, other):
        # join = set union
        self._s |= other._s

    def value(self):
        return frozenset(self._s)

    def __eq__(self, other):
        return self._s == other._s


def test_gset():
    a = GSet(); b = GSet()
    a.add(1); a.add(2)
    b.add(2); b.add(3)
    a.merge(b); b.merge(a)            # exchange both directions
    assert a.value() == b.value() == frozenset({1, 2, 3})
    a.merge(a)                        # idempotent
    assert a.value() == frozenset({1, 2, 3})
    print("Task 1 OK")

test_gset()
```

**Why it converges.** The state is a set; merge is union. Union is commutative, associative, and idempotent — the three properties that make a state-based CRDT. The states form a lattice ordered by ⊆, every local `add` moves *up* the lattice, and `merge` returns the least upper bound. Order, duplication, and batching cannot change the union of a fixed collection of elements.

</details>

---

### Task 2 — The convergence harness **[coding]** `[easy]`

**Statement.** Write the reusable test harness that *every* later CRDT task will be graded against. Given a list of "updates" (functions that mutate a fresh replica) and a `make_replica()` factory plus a `merge(dst, src)` function, the harness must drive replicas through adversarial schedules and assert convergence.

**What to build.** A function `assert_converges(make_replica, apply_update, merge, canon, updates, trials)` that, for each trial:
1. Creates `k` replicas (say 3).
2. Randomly assigns each update to a replica and applies it.
3. Performs many random pairwise merges, **including duplicate re-deliveries** of the same state.
4. Simulates a **partition/heal**: split replicas into two groups, merge freely *within* each group, then fully cross-merge.
5. Asserts every replica's `canon(state)` is identical at the end.

`canon` produces a hashable, order-independent canonical form (so `set` vs `frozenset` etc. don't create false mismatches).

**Acceptance test.** Run the harness against the **Task 1** G-Set: it must pass for hundreds of trials. Then run it against a deliberately broken "last write wins by Python `max` of insertion" toy and watch it fail — the harness must *catch* non-convergence, not merely pass good code.

<details>
<summary>Model solution (Python)</summary>

```python
import random

def assert_converges(make_replica, apply_update, merge, canon, updates,
                     trials=200, k=3, seed=0):
    rng = random.Random(seed)
    for t in range(trials):
        reps = [make_replica() for _ in range(k)]

        # 1) scatter updates across replicas in random order
        order = list(range(len(updates)))
        rng.shuffle(order)
        for i in order:
            apply_update(reps[rng.randrange(k)], updates[i])

        # 2) random pairwise merges WITH duplicate re-delivery
        for _ in range(4 * k):
            i, j = rng.randrange(k), rng.randrange(k)
            merge(reps[i], reps[j])
            if rng.random() < 0.5:           # re-deliver the same state again
                merge(reps[i], reps[j])

        # 3) partition / heal
        left = reps[:k // 2 + 1]
        right = reps[k // 2 + 1:] or [reps[0]]
        for _ in range(3):
            a, b = rng.choice(left), rng.choice(left)
            merge(a, b)
        for _ in range(3):
            a, b = rng.choice(right), rng.choice(right)
            merge(a, b)
        # heal: everyone merges with everyone
        for a in reps:
            for b in reps:
                merge(a, b)

        states = {canon(r) for r in reps}
        assert len(states) == 1, (
            f"DIVERGED on trial {t}: {len(states)} distinct states\n{states}")
    return True


# --- grade Task 1's G-Set ---
from itertools import count
def _gset_factory(): return GSet()
def _gset_apply(r, e): r.add(e)
def _gset_merge(dst, src): dst.merge(src)
def _gset_canon(r): return tuple(sorted(r.value()))

assert_converges(_gset_factory, _gset_apply, _gset_merge, _gset_canon,
                 updates=[1, 2, 3, 4, 5])
print("Task 2: harness passes G-Set")

# --- prove the harness CATCHES a bad merge ---
class BadLWW:
    """Broken: keeps only the numerically-largest inserted value, but
    'merge' picks the value seen most recently => order dependent."""
    def __init__(self): self.v = None; self._last = None
    def add(self, e): self.v = e; self._last = e
    def merge(self, other): self._last = other._last  # NOT a join

def _bad_factory(): return BadLWW()
def _bad_apply(r, e): r.add(e)
def _bad_merge(dst, src): dst.merge(src)
def _bad_canon(r): return r._last

try:
    assert_converges(_bad_factory, _bad_apply, _bad_merge, _bad_canon,
                     updates=[10, 20, 30])
    print("Task 2: FAIL — harness missed a divergence")
except AssertionError:
    print("Task 2: harness correctly catches non-convergence")
```

**Note.** A harness that only ever *passes* is useless. The second half — deliberately feeding it a broken merge and confirming it raises — is the part most people skip. Keep it.

</details>

---

### Task 3 — Max-register **[coding]** `[easy]`

**Statement.** Implement a **max-register** over a totally ordered domain (integers). `assign(x)` proposes a value; the register's value is the maximum ever assigned anywhere. `merge` is `max`.

**What to build.** `MaxRegister.assign(x)`, `MaxRegister.merge(other)`, `MaxRegister.value()`.

**Acceptance test.** Drive it with the Task 2 harness using a handful of integer assignments scattered across replicas; all replicas converge to the global maximum regardless of order or duplication.

<details>
<summary>Model solution (Python)</summary>

```python
class MaxRegister:
    def __init__(self, v=float("-inf")):
        self.v = v
    def assign(self, x):
        self.v = max(self.v, x)
    def merge(self, other):
        self.v = max(self.v, other.v)
    def value(self):
        return self.v

assert_converges(
    make_replica=lambda: MaxRegister(),
    apply_update=lambda r, x: r.assign(x),
    merge=lambda d, s: d.merge(s),
    canon=lambda r: r.value(),
    updates=[3, 1, 4, 1, 5, 9, 2, 6],
)
print("Task 3 OK")
```

**Go port (clarifies value semantics).**

```go
package main

import "fmt"

type MaxRegister struct{ V int64 }

func (r *MaxRegister) Assign(x int64) {
	if x > r.V {
		r.V = x
	}
}
func (r *MaxRegister) Merge(o MaxRegister) { // o by value: merge reads, never aliases
	if o.V > r.V {
		r.V = o.V
	}
}

func main() {
	a, b := MaxRegister{3}, MaxRegister{7}
	a.Merge(b)
	b.Merge(a)
	fmt.Println(a.V == b.V, a.V) // true 7
}
```

**Why it works.** `(domain, max)` is a join-semilattice with `min` as bottom. `max` is commutative, associative, and idempotent. A max-register is the scalar skeleton hiding inside G-Counters and version vectors — both are just element-wise max-registers.

</details>

---

### Task 4 — Union is a semilattice operation **[proof]** `[easy]`

**Statement.** Prove that set union ∪ over an arbitrary universe is **commutative**, **associative**, and **idempotent**, and conclude that the G-Set of Task 1 is a state-based CRDT.

**What to prove.** All three algebraic laws, then the bridge to convergence (Strong Eventual Consistency).

<details>
<summary>Model proof</summary>

Let `A, B, C` be subsets of a universe `U`.

- **Commutativity.** `x ∈ A ∪ B ⇔ x ∈ A ∨ x ∈ B ⇔ x ∈ B ∨ x ∈ A ⇔ x ∈ B ∪ A`. Disjunction is symmetric, so `A ∪ B = B ∪ A`.
- **Associativity.** `x ∈ (A ∪ B) ∪ C ⇔ (x∈A ∨ x∈B) ∨ x∈C`. Disjunction is associative, so this equals `x∈A ∨ (x∈B ∨ x∈C) ⇔ x ∈ A ∪ (B ∪ C)`.
- **Idempotence.** `x ∈ A ∪ A ⇔ x∈A ∨ x∈A ⇔ x∈A`, so `A ∪ A = A`.

These are exactly the axioms of a **join-semilattice** with join `⊔ = ∪` and partial order `A ⊑ B ⇔ A ⊆ B`. The empty set ∅ is the bottom element.

**Bridge to SEC.** In a state-based CRDT, (i) each local update is **inflationary** — `add(e)` gives `S' = S ∪ {e} ⊇ S`, so the state only moves *up* the order; and (ii) `merge` is the join `⊔`. By the general theorem for state-based CRDTs, if updates are inflationary and merge is the semilattice join, then any two replicas that have observed the same *set* of updates compute the same least upper bound, independent of the order, multiplicity, or grouping in which states were merged. Two replicas that have delivered the same updates therefore reach the same state. That is Strong Eventual Consistency. ∎

</details>

---

### Task 5 — Why a set, but not a list **[analysis]** `[easy]`

**Statement.** A G-Set converges trivially; a naive "grow-only list" (append-only, merge = concatenate-and-dedup) does **not**. Explain precisely which of commutativity / associativity / idempotence fails, with a concrete two-replica counterexample.

<details>
<summary>Model answer</summary>

Define a list state and `merge(x, y) = x ++ y` then dedup-preserving-first-occurrence.

- Replica A appends `a` then `b` → `[a, b]`.
- Replica B appends `c` → `[c]`.
- A merges B: `[a, b] ++ [c] = [a, b, c]`.
- B merges A: `[c] ++ [a, b] = [c, a, b]`.

`[a, b, c] ≠ [c, a, b]`: **commutativity fails** because list concatenation is not commutative. Therefore merge is not a semilattice join and replicas can permanently disagree on *order* even when they agree on *membership*. The lesson: total order is shared global state, and you cannot recover a single global order from independent local appends without extra machinery (dense identifiers / a tree of positions, as in RGA or Logoot — see the sequence-CRDT topics). Membership (a set) is order-free and so merges cleanly; ordering is not, which is why list/text CRDTs are an order of magnitude harder than counters and sets.

</details>

---

# Intermediate

### Task 6 — G-Counter **[coding]** `[medium]`

**Statement.** Implement a **grow-only counter (G-Counter)**: each replica owns one slot in a map `replica_id → count`; only the owner increments its own slot; `merge` is element-wise `max`; `value` is the sum of all slots.

**What to build.** `GCounter(replica_id)`, `.inc(n=1)`, `.merge(other)`, `.value()`.

**Acceptance test.** With the Task 2 harness, scatter increments across replicas (each replica increments *only its own* slot — model this by tagging each update with the replica that applies it), then converge. Final value at every replica equals the total number of increments. Critically, the harness's **duplicate re-delivery** must not double-count, because element-wise `max` is idempotent.

<details>
<summary>Model solution (Python)</summary>

```python
class GCounter:
    def __init__(self, replica_id, counts=None):
        self.id = replica_id
        self.counts = dict(counts or {})

    def inc(self, n=1):
        assert n >= 0, "G-Counter only grows"
        self.counts[self.id] = self.counts.get(self.id, 0) + n

    def merge(self, other):
        for rid, c in other.counts.items():
            self.counts[rid] = max(self.counts.get(rid, 0), c)

    def value(self):
        return sum(self.counts.values())


def test_gcounter():
    # Build replicas keyed by id, increment own slot only.
    ids = ["A", "B", "C"]
    reps = {i: GCounter(i) for i in ids}
    plan = [("A", 1), ("B", 2), ("C", 1), ("A", 3), ("B", 1)]
    total = sum(n for _, n in plan)
    for rid, n in plan:
        reps[rid].inc(n)

    # adversarial merges + duplicate re-delivery
    import itertools
    for a, b in itertools.product(ids, ids):
        reps[a].merge(reps[b])
        reps[a].merge(reps[b])      # duplicate: must NOT double count
    for a, b in itertools.product(ids, ids):
        reps[a].merge(reps[b])

    vals = {reps[i].value() for i in ids}
    assert vals == {total}, (vals, total)
    print("Task 6 OK, value =", total)

test_gcounter()
```

**Why per-replica slots?** A single shared integer with `merge = max` would lose concurrent increments: A and B both increment from 5 to 6 concurrently; `max(6,6)=6` but the true count is 7. Giving each replica its own monotone slot makes each slot a max-register (Task 3); concurrent increments live in *different* slots and the sum recovers the total. The whole structure is a vector of max-registers — element-wise `max` is therefore ACI by Task 4 applied coordinate-wise.

</details>

---

### Task 7 — A generic lattice merge, instantiated twice **[coding]** `[medium]`

**Statement.** Factor the pattern out: write a generic `Lattice` protocol with a single `join` and build a `MapLattice` that lifts a per-key value-lattice into a key→value map (join keys by union, join shared values by the inner join). Instantiate it (a) over `max` to *re-derive* the G-Counter, and (b) over set-union to get a "map of G-Sets". Both must pass the harness with no new merge code.

**What to build.** `join_max`, `join_set`, `MapLattice(inner_join)`, and a thin adapter so both instances run under Task 2's harness.

<details>
<summary>Model solution (Python)</summary>

```python
def join_max(a, b):
    return max(a, b)

def join_set(a, b):
    return frozenset(a) | frozenset(b)

class MapLattice:
    """Lift an inner value-join into a join over dicts (key->value)."""
    def __init__(self, inner_join, data=None):
        self.inner = inner_join
        self.data = dict(data or {})

    def put(self, k, v):                      # local update (inflationary if v ⊒ old)
        old = self.data.get(k)
        self.data[k] = v if old is None else self.inner(old, v)

    def merge(self, other):
        for k, v in other.data.items():
            old = self.data.get(k)
            self.data[k] = v if old is None else self.inner(old, v)

    def canon(self):
        return tuple(sorted(
            (k, v if not isinstance(v, frozenset) else tuple(sorted(v)))
            for k, v in self.data.items()))

# (a) G-Counter as MapLattice over max
gc = MapLattice(join_max); gc.put("A", 3); gc.put("A", 5)  # max(3,5)=5
assert gc.data["A"] == 5

# (b) map of G-Sets
mg = MapLattice(join_set); mg.put("tags", frozenset({"x"})); mg.put("tags", frozenset({"y"}))
assert mg.data["tags"] == frozenset({"x", "y"})

# Grade (b) under the harness:
def _fac(): return MapLattice(join_set)
def _apply(r, kv): r.put(*kv)
def _merge(d, s): d.merge(s)
def _canon(r): return r.canon()
assert_converges(_fac, _apply, _merge, _canon,
                 updates=[("k1", frozenset({1})), ("k1", frozenset({2})),
                          ("k2", frozenset({3})), ("k1", frozenset({1}))])
print("Task 7 OK")
```

**Key insight.** A *map of lattices is a lattice* (the product/function lattice), so composition is free: once you have a sound inner join you get a sound outer join with zero extra reasoning. This is the engine behind G-Counters (map over `max`), version vectors, and OR-Maps. Reuse the join; never hand-roll merge twice.

</details>

---

### Task 8 — Monotone update + join ⇒ SEC **[proof]** `[medium]`

**Statement.** Prove the central theorem behind every state-based CRDT in this file: *if (1) the state space (S, ⊑) is a join-semilattice, (2) every local update transforms `s` into some `s' ⊒ s` (inflation), and (3) `merge = ⊔` (the join), then replicas that have delivered the same set of updates converge — Strong Eventual Consistency holds — for any delivery order, any duplication, and any partitioning.*

<details>
<summary>Model proof</summary>

Fix a finite set of updates `U`. Let replica `r` have delivered a subset `D_r ⊆ U` (an update is "delivered" to `r` either applied locally or transitively received via a merged state). We show the state of `r` is a function only of `D_r`, namely the join of the per-update inflations.

**Step 1 — joins are determined by the set of joined elements.** Because ⊔ is commutative, associative (semilattice axioms), and idempotent (`x ⊔ x = x`), the join of any *multiset* of states equals the join of the underlying *set*: order doesn't matter (commutativity + associativity), and repeats don't matter (idempotence). Formally, for a finite collection `{x_i}`, the value `⊔_i x_i` is the least upper bound, which is unique. So however the states were combined — different orders, re-deliveries, batched within partitions then healed — the result is the single LUB of the set of states involved.

**Step 2 — each update contributes a fixed element.** Inflation (2) means applying update `u` to the bottom-anchored history yields a well-defined "effect". Because merge only ever takes joins and local updates only inflate, the state of `r` equals `⊔ { effect(u) : u ∈ D_r }` — the LUB over exactly the delivered updates. (Re-deliveries add already-present elements; by idempotence they change nothing. Partition-then-heal is just a particular bracketing of joins; by associativity the bracketing is irrelevant.)

**Step 3 — equal deliveries ⇒ equal states.** If `D_r = D_q`, then both compute the LUB of the *same* set, and the LUB is unique, so `state(r) = state(q)`. Thus any two replicas that have delivered the same updates are in the identical state.

**Eventual delivery ⇒ SEC.** Under the standard liveness assumption that every update is eventually delivered to every replica, `D_r → U` for all `r`, so all replicas reach `⊔ { effect(u) : u ∈ U }`. They agree without coordination, by construction — this is Strong Eventual Consistency. ∎

**What each hypothesis buys you.** Commutativity ⟸ order-independence; associativity ⟸ batching/partition-independence; **idempotence ⟸ at-least-once / duplicate delivery safety**. Drop idempotence and the next task shows divergence under redelivery.

</details>

---

### Task 9 — Non-idempotent merge diverges under redelivery **[proof]** `[medium]`

**Statement.** Exhibit a merge that is commutative and associative but **not idempotent**, and show a concrete schedule with re-delivery that makes two replicas diverge. This isolates idempotence as the property that buys at-least-once delivery safety.

<details>
<summary>Model answer</summary>

Take a counter whose state is a single integer and define `merge(x, y) = x + y` (addition). Addition is commutative and associative but **not** idempotent: `x + x = 2x ≠ x`.

**Schedule.**
- A starts at `2`, B starts at `3`.
- B receives A's state once: `B := 3 + 2 = 5`.
- Network retransmits A's *same* state to B (at-least-once delivery): `B := 5 + 2 = 7`.
- A receives B's first state once: `A := 2 + 3 = 5`.

Now A = 5, B = 7. They have "delivered the same updates" (A's value once, B's value once) yet differ purely because B counted a duplicate. No further merging of these scalars fixes it (`merge(5,7)=12`, `merge(7,5)=12`, but each side's view is already wrong, and the result is `12 ≠ 5 ≠ 7`). **Divergence.**

**Contrast.** Replace state with a per-replica map and `merge = element-wise max` (the G-Counter of Task 6). Re-delivering A's `{A:2}` to B is `max(2,2)=2`: idempotent, so the duplicate is absorbed. The fix is structural — not "deduplicate messages in the network," but "make merge idempotent so duplicates can't matter." Idempotence converts an unreliable, retrying, duplicating transport into a safe one for free.

You can confirm divergence with the Task 2 harness: feed it the "BadLWW"/additive merge and it raises `AssertionError` on a trial where a state is re-delivered.

</details>

---

### Task 10 — Lattice laws as random properties **[coding]** `[medium]`

**Statement.** Before trusting any merge, test the laws directly. Write a small property checker that, given a `join` and a random element generator, asserts **commutativity, associativity, and idempotence** on thousands of random triples. Run it on `join_max`, `join_set`, and on the broken additive merge (which must fail idempotence).

<details>
<summary>Model solution (Python)</summary>

```python
import random

def check_lattice_laws(join, gen, eq=lambda a, b: a == b, n=2000, seed=1):
    rng = random.Random(seed)
    for _ in range(n):
        a, b, c = gen(rng), gen(rng), gen(rng)
        assert eq(join(a, b), join(b, a)), ("commutativity", a, b)
        assert eq(join(join(a, b), c), join(a, join(b, c))), ("assoc", a, b, c)
        assert eq(join(a, a), a), ("idempotence", a)
    return True

def gen_int(rng): return rng.randint(-100, 100)
def gen_set(rng): return frozenset(rng.randint(0, 9) for _ in range(rng.randint(0, 4)))

check_lattice_laws(join_max, gen_int)
check_lattice_laws(join_set, gen_set)
print("Task 10: max and set-union satisfy ACI")

def bad_add(a, b): return a + b
try:
    check_lattice_laws(bad_add, gen_int)
    print("Task 10: FAIL — additive merge wrongly passed")
except AssertionError as e:
    assert e.args[0][0] == "idempotence"
    print("Task 10: additive merge correctly fails idempotence")
```

**Discipline.** These three randomized properties are *necessary* (not sufficient — they don't prove SEC, you still need inflation + that updates respect the order). But they are the cheapest, highest-yield test you can run on a candidate merge, and they localize the failure to a specific law. Wire them into CI for any custom CRDT. (See [property-based testing] in the wider toolbox for shrinking and stateful variants.)

</details>

---

# Advanced

### Task 11 — LWW-register with (timestamp, nodeId) tiebreak **[coding]** `[hard]`

**Statement.** Implement a **state-based Last-Write-Wins register**. State = `(value, timestamp, node_id)`. `assign(value, ts)` stamps with the local clock; `merge` keeps the entry with the larger `(timestamp, node_id)` *lexicographically*. The `node_id` tiebreak is what makes merge deterministic — without it, two assigns with equal timestamps can pick different winners on different replicas and diverge.

**What to build.** `LWWRegister(node_id)`, `.assign(value, ts)`, `.merge(other)`, `.value()`. Then **demonstrate clock-skew data loss**: a node with a fast clock can mask a genuinely-later write from a slow-clocked node.

<details>
<summary>Model solution (Python)</summary>

```python
class LWWRegister:
    def __init__(self, node_id, value=None, ts=-1):
        self.node_id = node_id
        self.value = value
        self.ts = ts
        self.writer = node_id   # who set the current value

    def _key(self):
        # lexicographic (ts, writer): writer breaks ts ties deterministically
        return (self.ts, self.writer)

    def assign(self, value, ts):
        cand = (ts, self.node_id)
        if cand > self._key():
            self.value, self.ts, self.writer = value, ts, self.node_id

    def merge(self, other):
        if other._key() > self._key():
            self.value, self.ts, self.writer = other.value, other.ts, other.writer

    def canon(self):
        return (self.value, self.ts, self.writer)


def test_lww_converges():
    # Equal timestamps, different writers: tiebreak must make it deterministic.
    a = LWWRegister("A"); b = LWWRegister("B")
    a.assign("alpha", ts=5)
    b.assign("beta", ts=5)        # same ts!
    a.merge(b); b.merge(a)
    assert a.canon() == b.canon()  # writer "B" > "A" ⇒ "beta" wins everywhere
    assert a.value == "beta"
    print("Task 11a OK (deterministic tiebreak), winner =", a.value)


def demo_clock_skew_loss():
    # B's clock is fast. A writes the genuinely-later value but with a smaller ts.
    a = LWWRegister("A"); b = LWWRegister("B")
    b.assign("stale-but-fast-clock", ts=1000)   # B's clock ran ahead
    # ... real-time passes, A makes the truly-latest write, but A's clock is slow:
    a.assign("fresh-but-slow-clock", ts=50)
    a.merge(b); b.merge(a)
    assert a.value == "stale-but-fast-clock"     # the FRESH write is LOST
    print("Task 11b: clock skew silently discarded the newer write:", a.value)


test_lww_converges()
demo_clock_skew_loss()
```

**Acceptance test (convergence).** Under the Task 2 harness with assigns scattered across replicas (each carrying its own ts), all replicas converge to the entry with the max `(ts, writer)`. The harness passes because `(ts, writer)` lives in a totally ordered domain and `merge = max` over it — a max-register (Task 3) in disguise.

**The cost.** LWW *always converges* but it is a **lossy** CRDT: concurrent writes are silently dropped (only one survives), and "latest" is defined by clocks, not causality. The skew demo shows the real-world failure: with physical clocks, the replica with the fastest clock wins ties it shouldn't. Mitigations: use logical/hybrid logical clocks (HLC) so causally-later writes always carry larger timestamps, accept LWW only where losing concurrent writes is semantically acceptable, or escalate to a multi-value register / OR-Set when every concurrent write must be retained.

</details>

---

### Task 12 — Property-based convergence tester **[coding]** `[hard]`

**Statement.** Generalize Task 10 into a **property-based convergence tester** that operates on opaque CRDT replicas. Given `make()`, `random_op(rng, replica)`, and `merge(dst, src)`, it should generate random operation sequences and random merge schedules and assert convergence — and it should also independently re-check ACI of the merge on random *states* (not just integers/sets). Use it to grade the LWW register and the G-Counter.

<details>
<summary>Model solution (Python)</summary>

```python
import random, copy

def pbt_convergence(make, random_op, merge, canon, *, trials=300, k=3,
                    ops_per_trial=12, seed=7):
    rng = random.Random(seed)
    for t in range(trials):
        reps = [make() for _ in range(k)]
        # random ops on random replicas
        for _ in range(ops_per_trial):
            random_op(rng, reps[rng.randrange(k)])
        # snapshot some states to re-check ACI on REAL states
        snaps = [copy.deepcopy(r) for r in reps]
        if len(snaps) >= 2:
            x, y, z = snaps[0], snaps[1], snaps[2 % len(snaps)]
            xy, yx = copy.deepcopy(x), copy.deepcopy(y)
            merge(xy, y); merge(yx, x)
            assert canon(xy) == canon(yx), ("commutativity", t)
            xx = copy.deepcopy(x); merge(xx, x)
            assert canon(xx) == canon(x), ("idempotence", t)
        # adversarial schedule with duplicates + heal
        for _ in range(5 * k):
            i, j = rng.randrange(k), rng.randrange(k)
            merge(reps[i], reps[j])
            if rng.random() < 0.4:
                merge(reps[i], reps[j])
        for a in reps:
            for b in reps:
                merge(a, b)
        assert len({canon(r) for r in reps}) == 1, ("diverged", t)
    return True

# Grade the LWW register
_clock = [0]
def lww_make(): return LWWRegister(node_id=random.choice("ABCD"))
def lww_op(rng, r):
    _clock[0] += rng.randint(0, 3)            # noisy, sometimes-equal clock
    r.assign(rng.choice(["x", "y", "z"]), ts=_clock[0])
def lww_merge(d, s): d.merge(s)
def lww_canon(r): return r.canon()
pbt_convergence(lww_make, lww_op, lww_merge, lww_canon)
print("Task 12: LWW converges under PBT")

# Grade the G-Counter
def gc_make(): return GCounter(replica_id=random.choice("ABCD"))
def gc_op(rng, r): r.inc(rng.randint(1, 3))
def gc_merge(d, s): d.merge(s)
def gc_canon(r): return tuple(sorted(r.counts.items()))
pbt_convergence(gc_make, gc_op, gc_merge, gc_canon)
print("Task 12: G-Counter converges under PBT")
```

**Why re-check ACI on real states.** Task 10 checked the join on synthetic ints/sets. Bugs frequently hide in the *composite* state (a forgotten key, an asymmetric tiebreak). Re-deriving commutativity/idempotence on *actual replica snapshots* catches merges that are sound on toy domains but wrong on the real structure. The deep-copy is essential — merge mutates, so you must snapshot before comparing.

</details>

---

### Task 13 — Delta-state G-Counter: bytes on the wire **[coding]** `[hard]`

**Statement.** A full-state G-Counter ships the entire `{id: count}` map on every sync — wasteful when only one slot changed. Implement a **delta-state G-Counter**: each `inc` produces a tiny **delta** `{id: new_count}`; deltas are merged with element-wise `max` exactly like full states, but you ship and buffer only the deltas. Measure bytes-on-the-wire vs the full-state approach over a workload.

**What to build.** `DeltaGCounter` with `.inc()` returning a delta, `.merge_delta(delta)`, and a `.delta_buffer` you can flush. Then compare serialized sizes.

<details>
<summary>Model solution (Python)</summary>

```python
import json

class DeltaGCounter:
    def __init__(self, replica_id):
        self.id = replica_id
        self.counts = {}
        self.delta_buffer = {}     # accumulated deltas since last flush

    def inc(self, n=1):
        self.counts[self.id] = self.counts.get(self.id, 0) + n
        d = {self.id: self.counts[self.id]}
        self._absorb(self.delta_buffer, d)   # join into buffer
        return d                              # a one-slot delta

    @staticmethod
    def _absorb(dst, delta):
        for rid, c in delta.items():
            dst[rid] = max(dst.get(rid, 0), c)

    def merge_delta(self, delta):
        self._absorb(self.counts, delta)
        self._absorb(self.delta_buffer, delta)   # propagate transitively

    def flush(self):
        d, self.delta_buffer = self.delta_buffer, {}
        return d

    def value(self):
        return sum(self.counts.values())


def measure():
    full = GCounter("A")
    delta = DeltaGCounter("A")
    full_bytes = delta_bytes = 0
    for _ in range(1000):
        full.inc(); 
        d = delta.inc()
        # full-state sync ships the whole map every time
        full_bytes += len(json.dumps(full.counts).encode())
        # delta sync ships only the changed slot
        delta_bytes += len(json.dumps(d).encode())
    assert full.value() == delta.value() == 1000
    print(f"Task 13: full-state={full_bytes}B  delta={delta_bytes}B  "
          f"ratio={full_bytes/delta_bytes:.1f}x")

measure()
```

**Acceptance test (convergence).** Run the Task 2 harness over `DeltaGCounter` where `merge` randomly chooses to ship either a buffered-delta-flush *or* the full state — both must converge, because a delta is just a (smaller) lattice element and `merge_delta` is the same `max` join. Mixing deltas and full states freely is safe precisely because deltas live in the *same* semilattice.

**Result & caveat.** With a single replica the delta payload is `O(1)` per sync while full-state grows with the number of distinct replica ids: the ratio climbs as the replica set grows. The catch absent here: **delta causal consistency**. If you drop a delta, the recipient may miss an increment — so production delta-CRDTs ship *delta-intervals* with a delivery guarantee (a delta is safe to discard only once acknowledged), otherwise you must periodically reconcile with full state as an anti-entropy backstop. Deltas reduce bandwidth, not the need for eventual full convergence.

</details>

---

### Task 14 — State size vs operation count **[analysis]** `[hard]`

**Statement.** For each of G-Set, G-Counter, LWW-register, analyze how the **state size** grows and what it grows *with* (number of operations? number of replicas? number of distinct elements?). State precisely when each structure has bounded metadata and when it does not.

<details>
<summary>Model answer</summary>

| CRDT | State size grows with | Bounded? | Why |
|---|---|---|---|
| **G-Set** | number of *distinct elements ever added* | No (monotone, unbounded) | Grow-only: no element is ever removed, so the set only enlarges. Bounded only if the universe is finite. |
| **G-Counter** | number of *distinct replica ids* (not operations!) | Yes, by replica count `R` | Each replica owns one integer slot; `m` increments on a replica update its single slot in place. State is `O(R · width(int))`, independent of operation count. |
| **LWW-register** | constant: `(value, ts, writer)` | Yes, `O(1)` (plus value size) | Merge keeps exactly one entry; history is discarded. This is *why* LWW is lossy. |

**Sharper statements.**

- **G-Counter metadata is per-replica, not per-operation.** A million increments on replica A still occupy one slot. The cost is paid in *breadth* (how many replicas have ever incremented), not depth. This is the good case: linear in `R`, and `R` is usually small and slow-growing.
- **G-Set metadata is per-element and never reclaimed.** It is a tombstone-free structure that nonetheless grows forever in an unbounded universe — the same pressure that, once you add *removal*, forces tombstones in OR-Sets and motivates the GC machinery of Task 16.
- **LWW is the only `O(1)` one — by throwing information away.** The constant size is bought with lost concurrent writes. There is no free lunch: bounded metadata for a register that *retains* all concurrent writes (a multi-value register) costs `O(#concurrent writers)`.

**Takeaway.** "Does the metadata grow with operations or with replicas?" is the single best question to ask of any CRDT. Per-replica is usually fine; per-operation (tombstones, version-vector-per-element) is what eventually forces causal-stability GC.

</details>

---

# Expert

### Task 15 — Causal stability detection & tombstone GC **[coding]** `[hard]`

**Statement.** Build a small framework that detects **causal stability** and uses it to garbage-collect tombstones. A tombstone (a recorded deletion) can be safely dropped only once *every* replica has observed the deletion — equivalently, once the deletion's timestamp is `≤` the per-replica minimum of all replicas' version vectors. Implement: version vectors, a "stability frontier" = element-wise `min` over all replicas' VVs, and a GC pass that removes tombstones dominated by the frontier.

**What to build.** `VersionVector` (with `merge = element-wise max`, `dominates`), a `Store` holding live entries + tombstones each tagged with a `(replica, seq)` dot, and `gc(stability_frontier)` that drops tombstones whose dot is `≤` frontier.

<details>
<summary>Model solution (Python)</summary>

```python
class VersionVector:
    def __init__(self, vv=None):
        self.vv = dict(vv or {})

    def observe(self, replica, seq):
        self.vv[replica] = max(self.vv.get(replica, 0), seq)

    def merge(self, other):                      # join = elementwise max
        for r, s in other.vv.items():
            self.vv[r] = max(self.vv.get(r, 0), s)

    def get(self, replica):
        return self.vv.get(replica, 0)

    def dominates_dot(self, replica, seq):       # has this VV seen (replica, seq)?
        return self.get(replica) >= seq


def stability_frontier(all_vvs):
    """Elementwise MIN over every replica's VV = what *everyone* has seen.
    Any replica not yet heard from contributes 0 (nothing is stable)."""
    replicas = set()
    for vv in all_vvs:
        replicas |= set(vv.vv.keys())
    frontier = {}
    for r in replicas:
        frontier[r] = min(vv.get(r) for vv in all_vvs)
    return frontier


class Store:
    def __init__(self, replica):
        self.replica = replica
        self.seq = 0
        self.live = {}          # key -> (value, dot)
        self.tombstones = {}    # key -> dot   (recorded deletions)

    def _dot(self):
        self.seq += 1
        return (self.replica, self.seq)

    def put(self, key, value):
        self.live[key] = (value, self._dot())

    def remove(self, key):
        if key in self.live:
            del self.live[key]
        self.tombstones[key] = self._dot()      # remember we deleted it

    def gc(self, frontier):
        """Drop tombstones every replica has already observed."""
        dropped = []
        for key, (r, s) in list(self.tombstones.items()):
            if frontier.get(r, 0) >= s:          # stable: safe to forget
                del self.tombstones[key]
                dropped.append(key)
        return dropped


def test_causal_stability_gc():
    A, B = Store("A"), Store("B")
    A.put("x", 1)
    A.remove("x")                                 # tombstone dot ("A", 2)

    # B has NOT yet seen A's deletion -> frontier for A is 0 -> NOT stable
    vvA = VersionVector(); vvA.observe("A", A.seq)
    vvB = VersionVector()                         # B knows nothing of A yet
    front = stability_frontier([vvA, vvB])
    assert A.gc(front) == [], "must not GC before everyone has seen it"

    # B observes A up to seq 2 -> now everyone has seen the deletion
    vvB.observe("A", 2)
    front = stability_frontier([vvA, vvB])
    assert A.gc(front) == ["x"], "now stable: tombstone can be reclaimed"
    assert "x" not in A.tombstones
    print("Task 15 OK: tombstone GC respects causal stability")

test_causal_stability_gc()
```

**The discipline.** GC is the dangerous part of CRDTs: forget a tombstone too early and a late-arriving `put("x", ...)` from a slow replica can *resurrect* a deleted key, breaking convergence. The frontier = element-wise `min` of all VVs is exactly "the causal point that everyone has passed"; anything at or below it is **causally stable** and can never be contradicted by a future message, so dropping it is sound. The price is that you must know about *every* replica (an absent replica pins the frontier at 0 forever) — which is why real systems pair this with membership/eviction so a dead replica doesn't block GC indefinitely.

</details>

---

### Task 16 — A CRDT that cannot violate a bounded-resource invariant **[design]** `[hard]`

**Statement.** *Design (no code).* You must enforce a hard invariant under concurrent updates without coordination: **"a shared inventory of `N` units is never oversold (stock ≥ 0)."** Argue rigorously that **no pure CRDT** can guarantee this, then design the hybrid you would actually ship and explain exactly where coordination enters.

<details>
<summary>Model answer</summary>

**Why no pure CRDT can do it.** A CRDT guarantees *convergence*, not *invariants*. The defining property is that any two replicas that have seen the same updates agree — but each replica accepts updates *locally, without coordination*. Consider stock = 1 and two partitioned replicas A and B, each receiving a "buy 1 unit" command. Locally each is valid (1 ≥ 0 after one sale). Each *must* accept it without coordination — that is the whole point of an AP/available system. On heal, any convergent merge of "A sold 1" and "B sold 1" yields "2 sold," i.e. stock = −1. The invariant `stock ≥ 0` is **not closed under merge**: it is a *global* numeric bound, and merge combines independently-valid local states into a globally-invalid one. This is precisely a **CALM**/coordination-freeness boundary: invariants that are not monotone (a non-negativity *lower bound* on a quantity that both replicas decrement) cannot be maintained without coordination. Formally, "no oversell" requires agreement on the *order/exclusivity* of the decrements, which is consensus — and consensus is exactly what CRDTs avoid.

**Sub-argument — but some bounded patterns *are* CRDT-able.** Note the asymmetry: an *upper*-bounded grow-only quantity (e.g., "at most one winner," "value never exceeds a cap reached monotonically") can be a CRDT because the invariant is monotone. It is the *decrement against a floor under concurrency* that breaks. So the design move is to pre-allocate the scarce right as a monotone resource.

**The hybrid I would ship — escrow / reservation partitioning.**
1. **Partition the budget.** Split the `N` units into per-replica *escrows*: replica A gets `N_A`, B gets `N_B`, with `Σ N_i ≤ N`. This split is decided by *one* coordinated step (or a token-passing leader) — coordination happens **once, off the hot path**.
2. **Local fast path is a CRDT.** Each replica sells against *its own* escrow using a per-replica **bounded counter / PN-Counter-with-a-floor**: locally it simply checks `sold_i < N_i`. Because A never spends B's escrow, the floor is enforced *locally and monotonically* — no coordination per sale. Sales are a grow-only counter (Task 6) capped at the escrow; convergence is trivial.
3. **Coordination only on rebalance/exhaustion.** When a replica's escrow runs low, it requests more from a coordinator or via a coordinated **transfer** (a two-phase hand-off: A's escrow decreases *and* B's increases atomically, which is a small consensus on just that transfer). The invariant holds globally because `Σ sold_i ≤ Σ N_i ≤ N` is maintained by construction; transfers conserve the total.

**Where coordination enters, precisely.** Not on the common case (a sale) — only on (a) the initial split and (b) rebalancing/transfer when an escrow is depleted. This is the standard **escrow transactions / reservation** pattern: keep the invariant by making each replica's *locally-checkable* budget a monotone CRDT, and pay for coordination only at the rare moments the budget must move between replicas. You trade "always available, sometimes oversold" for "available until your local escrow is exhausted, then a brief coordinated top-up, never oversold." This is also why real systems (ticketing, ad-budget pacing, rate quotas) use escrow rather than a single global counter.

</details>

---

### Task 17 — Bounding metadata growth **[analysis]** `[hard]`

**Statement.** Tombstones and per-element version vectors make removal-capable CRDTs (OR-Set and friends) grow without bound under churn. Reason about the growth and **propose a concrete bound** (a strategy that keeps metadata `O(R)` or `O(live data)` rather than `O(total operations)`), and state the assumptions your bound depends on.

<details>
<summary>Model answer</summary>

**Where the growth comes from.** Add/remove CRDTs tag each element instance with a unique **dot** `(replica, seq)`; a removal must remember enough to know *which* concurrent adds it shadows. Naively you keep a tombstone per removal forever, and a per-element causal context, so metadata is `O(total add/remove operations)` — unbounded under continuous churn even if the *live* set is tiny (the classic "add x, remove x, add x, remove x …" pathology balloons tombstones while the visible set stays empty).

**The bound: causal-stability GC + version-vector compaction.**
1. **Compress causal context to a version vector.** Instead of storing every observed dot individually, summarize the contiguous prefix of each replica's sequence as a single integer in a version vector (`A:42` means "seen A's dots 1..42"). Only *gaps* (out-of-order, not-yet-contiguous dots) need explicit storage. Under normal in-order delivery the per-element context collapses from a set of dots to `O(R)` integers, and gaps are transient. This is the **dotted version vector** compaction.
2. **Reclaim tombstones at the stability frontier (Task 15).** Once a removal's dot is `≤` the element-wise `min` of all replicas' VVs, it is causally stable — no future message can reference the removed instance — so the tombstone is dropped. Steady-state metadata then tracks *live* elements plus a bounded window of in-flight (not-yet-stable) operations, **not** total history.

**Resulting bound.** With both in place, metadata is `O(R + L + W)` where `R` = number of replicas (the VV width), `L` = number of *live* elements (their dots), and `W` = the in-flight window of operations not yet causally stable. The unbounded `O(total ops)` term is gone.

**Assumptions the bound depends on (state them or the bound is a lie).**
- **Known, bounded replica set.** The frontier is `min` over *all* replicas; a silent/dead replica pins the frontier and blocks GC. You need membership + eviction (evict a replica after a timeout, or require it to rejoin with a fresh id) so `R` stays bounded and the frontier advances.
- **Eventual delivery / liveness.** If some replica never receives anything, nothing ever becomes stable. The bound is on *steady state under eventual delivery*, not on adversarial indefinite partition.
- **`W` is bounded only if the system isn't perpetually partitioned.** The in-flight window shrinks as messages propagate; with healthy anti-entropy `W` is small.

**One-line summary.** Replace "remember every operation" with "remember a per-replica high-water mark (VV) and forget anything everyone has already seen (causal stability)" — that converts `O(operations)` into `O(replicas + live data + in-flight window)`, *provided* membership is bounded and delivery is eventual.

</details>

---

### Task 18 — Inflation is necessary, not just merge **[proof]** `[hard]`

**Statement.** Task 8 assumed local updates are *inflationary* (`s' ⊒ s`). Show by counterexample that a correct join is **not sufficient** on its own: if a local update can move the state *down* (or sideways) in the lattice, replicas can diverge even though `merge` is a perfect ACI join.

<details>
<summary>Model answer</summary>

Let the lattice be `(integers, ⊑ = ≤)` with join `⊔ = max` — a flawless ACI semilattice (Task 4 applies). Now define a *non-inflationary* local update: `set_to(x)` that *overwrites* the state with `x` regardless of the current value (this is *not* `assign` of a max-register; it ignores the order).

**Schedule.**
- A and B both start at `0`.
- A does `set_to(5)` → A = 5. B does `set_to(3)` → B = 3.
- A merges B: `max(5, 3) = 5`. A = 5.
- B merges A: `max(3, 5) = 5`. B = 5.

So far fine. But now A does `set_to(1)` — a *downward* move, 5 ↦ 1, which inflation forbids. A = 1.
- B (not yet hearing the `set_to(1)`) is at 5. B merges A's *old* state 5 → stays 5. Now A merges B = 5: `max(1,5)=5`, A back to 5 — but the user *intended* the value to be 1, and whether the final value is 1 or 5 depends entirely on *when* B's stale 5 reaches A. Replay with B's merge arriving before vs after A's `set_to(1)` yields different final states (1 vs 5).

**Why it breaks.** The convergence theorem's Step 2 ("each update contributes a fixed lattice element and merge only takes joins") relies on updates *only adding* information (moving up). A non-inflationary `set_to` can *destroy* information that a concurrent merge later *restores*, so the final state is no longer a function of the *set* of delivered updates — it depends on their interleaving. Commutativity/associativity/idempotence of `merge` cannot save you, because the *update* itself is not monotone with respect to the order. 

**The fix is structural:** make the update inflationary. To overwrite, don't move down — attach a higher timestamp and `max` over `(ts, value)` (that is exactly the LWW-register, Task 11), so every "overwrite" is actually an *upward* move in the `(ts, …)` order. **CRDT correctness = ACI merge *and* inflationary updates.** Either one alone is insufficient. ∎

</details>

---

## Grading rubric (self-check)

- [ ] **Beginner (1–5):** G-Set + harness + max-register run green; you can recite why union is ACI and why a list isn't.
- [ ] **Intermediate (6–10):** G-Counter and the generic `MapLattice` pass the harness; you proved monotone-update + join ⇒ SEC and can show the non-idempotent divergence schedule from memory.
- [ ] **Advanced (11–14):** LWW converges *and* you reproduced clock-skew loss; the PBT and delta-counter run; you can fill the state-growth table without looking.
- [ ] **Expert (15–18):** causal-stability GC respects the frontier; you argued why no pure CRDT enforces a bounded-resource invariant and designed the escrow hybrid; you stated the metadata bound *with its assumptions*; you produced the inflation counterexample.

**One discipline to carry forward:** every CRDT claim is two claims — *the merge is an ACI join* **and** *local updates only inflate*. Test both, prove both, and replay updates in many orders with duplicates and a partition/heal before you call anything "convergent."

Continue with [State vs Op tasks](../02-state-vs-operation-based-crdts/tasks.md), then [Counter tasks](../03-counters-g-pn/tasks.md) and [Set tasks](../04-sets-or-set-lww/tasks.md).
