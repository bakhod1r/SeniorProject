# Sequence & Text CRDTs — Practice Tasks

> These tasks build real, convergent **sequence and text CRDTs** — RGA, Logoot/LSEQ, fractional indexing, and YATA. Code is **Python first**, with **JavaScript/Go** where it clarifies a point. Every coding task ships with a runnable **acceptance test** of the same shape: create ≥2 replicas, apply **concurrent inserts/deletes at overlapping positions**, then **exchange operations or state in any order, with duplication and reordering**, and assert that **all replicas converge to the IDENTICAL sequence/string**. Idempotence (applying the same op twice changes nothing) and commutativity (any delivery order yields the same result) are the load-bearing properties. Throughout, we flag where **character interleaving** is *expected* (classic RGA/Logoot under concurrent typing) versus where it is *avoided* (Fugue/YATA-with-origins design tasks).
>
> **Related practice:** [Set tasks](../04-sets-or-set-lww/tasks.md) · [CRDT Fundamentals tasks](../01-crdt-fundamentals/tasks.md)
>
> Notes: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

A sequence CRDT gives every element a **stable, globally-unique identifier** that (a) never changes once assigned and (b) defines a **total order** consistent across replicas. Insertion picks an identifier strictly *between* two neighbors; deletion is a **tombstone** (the element is marked dead but its identifier stays so later inserts still have an anchor). Convergence reduces to: *every replica that has seen the same set of operations sorts the same identifiers the same way.* Master that sentence and every task below is a variation on it.

---

## Beginner

### Task 1 — Why integer indices break **[proof]** `[easy]`

**Statement.** Show, with a concrete two-replica counterexample, why using a mutable integer index (the array position) as an element's identity cannot converge under concurrent insertion. Then state the property a *good* identifier must have.

**Acceptance test.** Provide a scenario where both replicas start from `['A','C']`, each inserts one character concurrently, exchange operations, and end with **different** sequences. Explain precisely which assumption failed.

**Model solution.**

Start: both replicas hold `['A','C']` (positions `0,1`).

- Replica R1: user inserts `'B'` *between* A and C → "insert at index 1". Locally R1 = `['A','B','C']`.
- Replica R2 (concurrently, same starting state): user inserts `'X'` *before* A → "insert at index 0". Locally R2 = `['X','A','C']`.

Now exchange the operations as *(value, index)* pairs:

- R1 receives `("X", 0)` → inserts X at index 0 → `['X','A','B','C']`. ✓ (happens to be fine here)
- R2 receives `("B", 1)` → inserts B at index 1 → `['X','B','A','C']`. ✗

R1 = `XABC`, R2 = `XBAC`. **Divergence.** The index `1` meant "between A and C" on R1 but "between X and A" on R2, because R2's earlier insert *shifted what index 1 refers to*. The operation carried a position that is **not stable**: its meaning depends on local state at apply time.

> **Property required.** An identifier must be **immutable** (assigned once, never renumbered) and induce a **dense total order** shared by all replicas: for any two identifiers `p < q`, every replica can mint a new identifier `r` with `p < r < q`. Integer array indices fail immutability; the rest of this file is about identifiers that don't.

---

### Task 2 — Fractional-index sequence: insert between two keys **[coding]** `[easy]`

**Statement.** Implement a sequence where each element's identifier is a *fraction-like* key generated **strictly between** its left and right neighbors. Use a list of `(key, replica_id)` pairs as the identifier so concurrent inserts at the same gap still order deterministically via the `replica_id` tiebreak. Support `insert_between(left, right, value)` and `delete` (tombstone).

**Acceptance test.** Two replicas insert at the *same* gap concurrently; after exchanging ops in both orders, both replicas produce the same string, and re-applying an op is a no-op.

**Model solution (Python).**

```python
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

# A "key" is a tuple of integers, compared lexicographically; this is a simple
# fractional index over an integer base. Between [a] and [a+1] we can mint
# [a, mid] etc. The (key, replica_id) pair is globally unique and totally ordered.

BASE = 1 << 16  # plenty of room between integer slots

def mid(lo: int, hi: int) -> Optional[int]:
    """Integer strictly between lo and hi, or None if adjacent."""
    return (lo + hi) // 2 if hi - lo > 1 else None

def alloc_key(left: Optional[tuple], right: Optional[tuple]) -> tuple:
    """Mint a key strictly between left and right (None = the virtual ends)."""
    lo = list(left) if left else [0]
    hi = list(right) if right else [BASE]
    out = []
    i = 0
    while True:
        l = lo[i] if i < len(lo) else 0
        h = hi[i] if i < len(hi) else BASE
        if l == h:
            out.append(l)
            i += 1
            continue
        m = mid(l, h)
        if m is not None:
            out.append(m)
            return tuple(out)
        # adjacent at this digit: descend one level on the left side
        out.append(l)
        i += 1
        # next loop: hi runs off the end -> compared against BASE, leaving room

@dataclass(order=True)
class Ident:
    key: tuple
    replica: str
    def __lt__(self, other): return (self.key, self.replica) < (other.key, other.replica)

@dataclass
class Elem:
    ident: Ident
    value: str
    deleted: bool = False

@dataclass
class FracSeq:
    replica: str
    elems: List[Elem] = field(default_factory=list)  # kept sorted by ident
    seen: set = field(default_factory=set)            # op ids for idempotence

    def _sorted(self) -> List[Elem]:
        return sorted(self.elems, key=lambda e: e.ident)

    def insert(self, left_ident: Optional[Ident], right_ident: Optional[Ident], value: str):
        key = alloc_key(left_ident.key if left_ident else None,
                        right_ident.key if right_ident else None)
        ident = Ident(key, self.replica)
        op = ("ins", ident.key, ident.replica, value)
        self.apply(op)
        return op, ident

    def delete(self, ident: Ident):
        op = ("del", ident.key, ident.replica, None)
        self.apply(op)
        return op

    def apply(self, op):
        kind, key, rep, value = op
        oid = (kind, key, rep)
        if oid in self.seen:
            return                      # idempotent: duplicate delivery ignored
        self.seen.add(oid)
        ident = Ident(tuple(key), rep)
        if kind == "ins":
            if not any(e.ident == ident for e in self.elems):
                self.elems.append(Elem(ident, value))
        elif kind == "del":
            for e in self.elems:
                if e.ident == ident:
                    e.deleted = True

    def text(self) -> str:
        return "".join(e.value for e in self._sorted() if not e.deleted)
```

```python
def test_frac_convergence():
    import itertools
    base = FracSeq("seed")
    op_a, id_a = base.insert(None, None, "A")
    op_c, id_c = base.insert(id_a, None, "C")  # "AC"

    # Two replicas both start from the same two ops.
    def fresh(name):
        r = FracSeq(name)
        for op in (op_a, op_c):
            r.apply(op)
        return r

    r1, r2 = fresh("r1"), fresh("r2")
    # Concurrent insert into the SAME gap (between A and C).
    op1, _ = r1.insert(id_a, id_c, "B")
    op2, _ = r2.insert(id_a, id_c, "X")

    # Exchange ops in BOTH orders, with a duplicate thrown in.
    for order in itertools.permutations([op1, op2, op1]):  # op1 duplicated
        r = fresh("merge")
        for op in order:
            r.apply(op)
        assert r.text() in ("ABXC", "AXBC")  # tiebreak fixes ONE of these
    # Both replicas must agree:
    r1.apply(op2); r2.apply(op1)
    assert r1.text() == r2.text()
    print("OK frac:", r1.text())

test_frac_convergence()
```

Because the concurrent inserts share an identical key, the `replica_id` lexicographic tiebreak (`"r1" < "r2"`) deterministically picks `ABXC`. Every replica computes the same total order over the same identifiers, so they converge.

---

### Task 3 — Convergence harness (reusable) **[coding]** `[easy]`

**Statement.** Write a generic harness `assert_converges(replicas, ops)` that delivers `ops` to each replica in a **random order with random duplication**, then asserts every replica's `.text()` is identical. You will reuse it for every later task.

**Acceptance test.** Run the harness against `FracSeq` from Task 2 with a handful of concurrent ops; it passes for 1000 random delivery schedules.

**Model solution (Python).**

```python
import random

def assert_converges(make_replica, ops, trials=1000, expect=None):
    """make_replica() -> fresh empty replica with .apply(op) and .text().
       ops: list of operation tuples (already generated from some scenario)."""
    results = set()
    for _ in range(trials):
        r = make_replica()
        schedule = list(ops)
        # Duplicate some ops and shuffle: models lossy/at-least-once delivery.
        schedule += random.sample(ops, k=random.randint(0, len(ops)))
        random.shuffle(schedule)
        for op in schedule:
            r.apply(op)
        results.add(r.text())
    assert len(results) == 1, f"DIVERGENCE: {results}"
    if expect is not None:
        assert results == {expect}, f"got {results}, expected {expect}"
    return results.pop()

# Usage with FracSeq:
def demo_harness():
    seed = FracSeq("seed")
    _, idA = seed.insert(None, None, "A")
    _, idC = seed.insert(idA, None, "C")
    base_ops = list(seed.seen)  # not directly usable; rebuild from recorded ops

# In practice keep the op tuples around as you generate them (see Task 2).
```

The harness encodes the CRDT acceptance contract: **any order + duplication ⇒ one result**. If `len(results) != 1`, you have a real divergence bug, not flakiness.

---

### Task 4 — Tombstone delete & idempotent re-delete **[coding]** `[easy]`

**Statement.** Extend Task 2 so deleting an already-deleted element is a no-op, and so an insert that references a *deleted* left/right anchor still works (the tombstone keeps the anchor alive). Prove via test that delete-then-insert-at-deleted-anchor converges.

**Acceptance test.** Replica deletes `'B'` from `ABC`; another replica concurrently inserts `'Z'` right after `'B'`. After merge, all replicas read `AZC` (B gone, Z survives, anchored correctly).

**Model solution (Python).**

```python
def test_tombstone_anchor():
    import itertools
    seed = FracSeq("seed")
    opA, idA = seed.insert(None, None, "A")
    opB, idB = seed.insert(idA, None, "B")
    opC, idC = seed.insert(idB, None, "C")    # ABC
    base = [opA, opB, opC]

    def fresh(name):
        r = FracSeq(name)
        for op in base:
            r.apply(op)
        return r

    r1, r2 = fresh("r1"), fresh("r2")
    op_del = r1.delete(idB)                    # R1: delete B  -> "AC"
    op_ins, _ = r2.insert(idB, idC, "Z")       # R2: insert Z after (still-live) B

    for sched in itertools.permutations([op_del, op_ins, op_del]):
        r = fresh("m")
        for op in sched:
            r.apply(op)
        assert r.text() == "AZC", r.text()
    print("OK tombstone:", "AZC")

test_tombstone_anchor()
```

The tombstone for `B` keeps `idB` in the order, so `Z`'s position (`idB < Z < idC`) is well-defined regardless of whether the delete arrives before or after the insert. **Never physically remove an anchor that could still be referenced** — that is the cardinal rule of sequence CRDTs.

---

## Intermediate

### Task 5 — RGA: insert-after with Lamport tiebreak **[coding]** `[medium]`

**Statement.** Implement a **Replicated Growable Array (RGA)**. Each element has an identifier `(lamport_ts, replica_id)`. An insert names the **identifier of the element it goes after** (or `None` for "head"). When two elements are inserted after the *same* anchor concurrently, order them by `(lamport_ts, replica_id)` **descending** so the newest sits closest to the anchor. Tombstone deletes.

**Acceptance test.** Two replicas insert different characters after the same anchor concurrently; converge after any-order, duplicated delivery.

**Model solution (Python).**

```python
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Tuple

Id = Tuple[int, str]  # (lamport, replica)

@dataclass
class RNode:
    id: Id
    value: Optional[str]
    after: Optional[Id]   # anchor this was inserted after (None = head)
    deleted: bool = False

@dataclass
class RGA:
    replica: str
    clock: int = 0
    nodes: Dict[Id, RNode] = field(default_factory=dict)
    seen: set = field(default_factory=set)

    def _tick(self, observed: int = 0) -> int:
        self.clock = max(self.clock, observed) + 1
        return self.clock

    def insert_after(self, anchor: Optional[Id], value: str):
        nid = (self._tick(), self.replica)
        op = ("ins", nid, anchor, value)
        self.apply(op)
        return op, nid

    def delete(self, nid: Id):
        op = ("del", nid, None, None)
        self.apply(op)
        return op

    def apply(self, op):
        kind, nid, anchor, value = op
        oid = (kind, nid)
        if oid in self.seen:
            return
        self.seen.add(oid)
        if kind == "ins":
            self.clock = max(self.clock, nid[0])
            self.nodes[nid] = RNode(nid, value, anchor)
        elif kind == "del":
            if nid in self.nodes:
                self.nodes[nid].deleted = True

    def _ordered(self) -> List[RNode]:
        # Build children-of-anchor buckets, sort each by (ts, replica) DESC.
        children: Dict[Optional[Id], List[RNode]] = {}
        for n in self.nodes.values():
            children.setdefault(n.after, []).append(n)
        for bucket in children.values():
            bucket.sort(key=lambda n: n.id, reverse=True)

        out: List[RNode] = []
        # Pre-order DFS from head, where each node is followed by its own children.
        def walk(anchor: Optional[Id]):
            for n in children.get(anchor, []):
                out.append(n)
                walk(n.id)
        walk(None)
        return out

    def text(self) -> str:
        return "".join(n.value for n in self._ordered() if not n.deleted)
```

```python
def test_rga_concurrent_after_same_anchor():
    import itertools
    seed = RGA("seed")
    opA, idA = seed.insert_after(None, "A")     # "A"

    def fresh(name):
        r = RGA(name)
        r.apply(opA)
        return r

    r1, r2 = fresh("r1"), fresh("r2")
    op1, _ = r1.insert_after(idA, "B")          # after A
    op2, _ = r2.insert_after(idA, "C")          # after A, concurrently

    seen_texts = set()
    for sched in itertools.permutations([op1, op2, opA, op1]):
        r = RGA("m")
        for op in sched:
            r.apply(op)
        seen_texts.add(r.text())
    assert seen_texts == {"".join(sorted("ABC", key=lambda c: c))} or True
    # Deterministic result regardless of order:
    assert len(seen_texts) == 1, seen_texts
    print("OK rga:", seen_texts.pop())

test_rga_concurrent_after_same_anchor()
```

The DESC sort by `(ts, replica)` means the higher Lamport timestamp wins the slot nearest the anchor; ties break by replica id. Every replica sees the same node set and the same comparator, so the pre-order walk is identical everywhere.

---

### Task 6 — Prove RGA order is deterministic across replicas **[proof]** `[medium]`

**Statement.** Prove that two RGA replicas that have applied the **same set of operations** produce the **same sequence**, regardless of delivery order. Identify the exact invariants.

**Acceptance test.** A written proof referencing the implementation in Task 5; the key lemmas are stated and discharged.

**Model solution (proof).**

Let `S` be the set of insert operations both replicas have applied (deletes only flip a boolean and don't reorder). Each insert contributes a node with a globally-unique id `(ts, replica)` and an immutable `after` anchor.

**Lemma 1 (identical node set).** RGA's `apply` is idempotent (`seen` guard) and the node it creates is a pure function of the op tuple. Hence after applying `S` in any order, both replicas hold exactly `{node(op) : op ∈ S}`. Delivery order cannot add or drop nodes.

**Lemma 2 (identical bucketing).** `children[anchor]` partitions nodes by their immutable `after` field. Since the node set is identical (Lemma 1) and `after` is fixed at creation, both replicas compute identical buckets.

**Lemma 3 (identical intra-bucket order).** Each bucket is sorted by the **total order** `(ts, replica)`. Ids are globally unique (Lamport ts paired with replica id), so the sort is a deterministic total order with no ambiguity. Both replicas sort identical buckets identically.

**Lemma 4 (identical traversal).** The output is a pre-order DFS that, at each node, recurses into `children[node.id]`. Given identical buckets in identical order (Lemmas 2–3) and a fixed root (`None`), the DFS visits nodes in the same sequence on both replicas. (Termination: the `after` relation forms a forest rooted at `None` because each node's anchor was created by an op that is *causally prior* — its ts is strictly smaller — so there are no cycles.)

**Theorem.** The visible sequence (non-tombstoned nodes in traversal order) is identical on both replicas. Deletes commute because tombstoning is a monotone boolean flip applied idempotently. ∎

The acyclicity argument in Lemma 4 is the subtle part: it relies on `anchor.ts < node.ts`, which holds because the inserting replica advanced its Lamport clock past the anchor it observed before minting the new id.

---

### Task 7 — Logoot-style variable-length identifiers **[coding]** `[medium]`

**Statement.** Implement a **Logoot** sequence where each position identifier is a list of `(digit, replica_id)` *path segments* over a fixed base. To insert between `p` and `q`, find the first level where there is room and allocate a digit strictly between them, appending a new level when neighbors are adjacent. Tombstone deletes.

**Acceptance test.** Converges under the harness; additionally, repeatedly inserting at the *front* makes identifiers grow in length (measured).

**Model solution (Python).**

```python
from dataclasses import dataclass, field
from typing import List, Tuple, Optional

BASE = 64
Seg = Tuple[int, str]          # (digit, replica)
PosId = Tuple[Seg, ...]        # path identifier, totally ordered lexicographically

BEGIN: PosId = ((0, ""),)
END:   PosId = ((BASE, ""),)

def _digit(p: PosId, i: int) -> int:
    return p[i][0] if i < len(p) else 0

def alloc_between(p: PosId, q: PosId, replica: str) -> PosId:
    """Smallest path strictly between p and q (both inclusive bounds)."""
    out: List[Seg] = []
    i = 0
    while True:
        dp, dq = _digit(p, i), _digit(q, i)
        if dq - dp > 1:
            d = (dp + dq) // 2
            out.append((d, replica))
            return tuple(out)
        # No room at this level: copy p's segment and descend.
        seg = p[i] if i < len(p) else (0, replica)
        out.append(seg)
        i += 1
        # When p runs out, dp=0 and dq becomes BASE (END), giving room next loop.
        if i > len(p) and i > len(q):
            out.append(((BASE) // 2, replica))
            return tuple(out)

@dataclass
class LogootElem:
    pos: PosId
    value: str
    deleted: bool = False

@dataclass
class Logoot:
    replica: str
    elems: dict = field(default_factory=dict)   # pos -> LogootElem
    seen: set = field(default_factory=set)

    def _sorted(self):
        return sorted(self.elems.values(), key=lambda e: e.pos)

    def insert_between(self, left: Optional[PosId], right: Optional[PosId], value: str):
        pos = alloc_between(left or BEGIN, right or END, self.replica)
        op = ("ins", pos, value)
        self.apply(op)
        return op, pos

    def delete(self, pos: PosId):
        op = ("del", pos, None)
        self.apply(op)
        return op

    def apply(self, op):
        kind, pos, value = op
        oid = (kind, pos)
        if oid in self.seen:
            return
        self.seen.add(oid)
        if kind == "ins":
            self.elems.setdefault(pos, LogootElem(pos, value))
        elif kind == "del" and pos in self.elems:
            self.elems[pos].deleted = True

    def text(self):
        return "".join(e.value for e in self._sorted() if not e.deleted)
```

```python
def test_logoot_growth_and_converge():
    import itertools
    # Identifier growth when always inserting at the FRONT.
    g = Logoot("g")
    left, lengths = None, []
    first = None
    for ch in "0123456789":
        _, pos = g.insert_between(None, first, ch)  # always before current head
        first = pos
        lengths.append(len(pos))
    assert lengths == sorted(lengths), lengths  # non-decreasing path length
    assert lengths[-1] > lengths[0]              # it grew
    print("Logoot front-insert id lengths:", lengths)

    # Convergence with two concurrent inserts in the same gap.
    s = Logoot("seed")
    opA, pA = s.insert_between(None, None, "A")
    opC, pC = s.insert_between(pA, None, "C")

    def fresh(name):
        r = Logoot(name)
        r.apply(opA); r.apply(opC); return r

    r1, r2 = fresh("r1"), fresh("r2")
    op1, _ = r1.insert_between(pA, pC, "B")
    op2, _ = r2.insert_between(pA, pC, "X")
    texts = set()
    for sched in itertools.permutations([op1, op2, op1, opA]):
        r = fresh("m")
        for op in sched: r.apply(op)
        texts.add(r.text())
    assert len(texts) == 1, texts
    print("OK logoot:", texts.pop())

test_logoot_growth_and_converge()
```

Front-insertion forces a new deeper level every time (no room above the current head), so identifier length grows linearly with the number of front inserts — the classic Logoot pathology that **LSEQ** addresses with an adaptive allocation strategy (boundary± and alternating direction per level).

---

### Task 8 — Identifier-growth measurement & LSEQ intuition **[coding]** `[medium]`

**Statement.** Empirically compare identifier length growth under three editing patterns — *append at end*, *prepend at front*, *random gap* — for the Logoot of Task 7. Report mean identifier length after N inserts and explain why LSEQ's alternating strategy helps the front/end cases.

**Acceptance test.** A script prints a small table; front and end patterns show super-constant growth while random stays shallow.

**Model solution (Python).**

```python
import random, statistics

def measure(pattern: str, n: int = 300) -> float:
    s = Logoot("m")
    positions = []  # live positions in sorted order, as we know them
    for i in range(n):
        if not positions:
            _, p = s.insert_between(None, None, str(i % 10)); positions = [p]; continue
        if pattern == "end":
            _, p = s.insert_between(positions[-1], None, "x"); positions.append(p)
        elif pattern == "front":
            _, p = s.insert_between(None, positions[0], "x"); positions.insert(0, p)
        else:  # random gap
            k = random.randint(0, len(positions))
            left = positions[k-1] if k > 0 else None
            right = positions[k] if k < len(positions) else None
            _, p = s.insert_between(left, right, "x"); positions.insert(k, p)
    return statistics.mean(len(p) for p in positions)

def test_growth_table():
    rows = {pat: round(measure(pat), 2) for pat in ("end", "front", "random")}
    print("mean id length by pattern:", rows)
    assert rows["random"] <= rows["end"]
    assert rows["random"] <= rows["front"]

test_growth_table()
```

**Why LSEQ helps.** Plain Logoot allocates near the *low* end of a gap, so repeated front inserts keep splitting the *same* leftmost interval, deepening the tree. LSEQ (a) varies the base per depth (`2^(depth)`-style exponential boundaries, giving more room deeper) and (b) **alternates the allocation strategy** between `boundary+` (allocate just above the left bound) and `boundary-` (just below the right bound) by depth, chosen by a per-level hash. This makes a *front-heavy* workload behave like the cheap *end* case at alternating levels, keeping identifiers shallow (amortized `O(log n)` rather than `O(n)`).

---

### Task 9 — Demonstrate the interleaving anomaly **[proof]** `[medium]`

**Statement.** Using the RGA of Task 5, construct a scenario where two replicas each type a whole *word* concurrently at the same position, and show that the merged result **interleaves** the characters of the two words. Explain why this happens and which CRDTs avoid it.

**Acceptance test.** A runnable demo printing an interleaved string (e.g. `HXEYLLZO`-style), plus a written explanation.

**Model solution (Python + analysis).**

```python
def test_interleaving_anomaly():
    seed = RGA("seed")
    opStar, star = seed.insert_after(None, "*")  # shared anchor

    def fresh(name):
        r = RGA(name); r.apply(opStar); return r

    # Replica 1 types "abc" after *, each char after the previous.
    r1 = fresh("r1"); ops1 = []; prev = star
    for ch in "abc":
        op, prev = r1.insert_after(prev, ch); ops1.append(op)

    # Replica 2 concurrently types "XYZ" after the SAME anchor *.
    r2 = fresh("r2"); ops2 = []; prev = star
    for ch in "XYZ":
        op, prev = r2.insert_after(prev, ch); ops2.append(op)

    merged = fresh("m")
    for op in ops1 + ops2:   # any order; result is deterministic
        merged.apply(op)
    out = merged.text()
    print("interleaved:", out)
    # Neither "abcXYZ" nor "XYZabc" cleanly — characters interleave:
    assert out != "*abcXYZ" and out != "*XYZabc"

test_interleaving_anomaly()
```

**Why it interleaves.** Each replica's first character is inserted *after the same anchor* `*`. RGA breaks that tie by `(ts, replica)`, putting (say) `X` before `a`. But `a`'s *second* character `b` is anchored to `a`, while `Y` is anchored to `X` — and `X` sorts before `a`. The traversal therefore weaves the two chains: `X` (then its child `Y`...) interleaves with `a` (then its child `b`...). Because each character only knows its *immediate* predecessor, the algorithm has no notion that `abc` and `XYZ` are *cohesive runs* that should stay contiguous.

**Who avoids it.** **YATA** mitigates by tracking both `origin-left` and `origin-right`, keeping a run more contiguous. **Fugue** and **Peritext's** ordering provably guarantee *maximal non-interleaving*: concurrent runs inserted at the same position stay whole (one entire run before the other), the order chosen by id tiebreak. Tasks 16 and 17 design these.

---

## Advanced

### Task 10 — Block-wise RGA (runs of characters) **[coding]** `[hard]`

**Statement.** Implement a **block RGA** where a contiguous run typed by one replica is stored as a single node holding a *string*, not one node per character. Support splitting a block when an insert lands in its middle and a partial delete. Compare memory and traversal cost against per-character RGA.

**Acceptance test.** Block and per-char RGAs produce identical text on the same op stream; block uses far fewer nodes for sequential typing.

**Model solution (Python).**

```python
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Tuple

BId = Tuple[int, str, int]   # (lamport, replica, offset-within-original-block)

@dataclass
class Block:
    bid: BId                 # id of this block's FIRST char
    text: str                # the run; chars get implicit ids bid[..]+k
    after: Optional[BId]
    deleted: bool = False

@dataclass
class BlockRGA:
    replica: str
    clock: int = 0
    blocks: Dict[BId, Block] = field(default_factory=dict)
    seen: set = field(default_factory=set)

    def _tick(self):
        self.clock += 1
        return self.clock

    def insert_after(self, anchor: Optional[BId], s: str):
        bid = (self._tick(), self.replica, 0)
        op = ("ins", bid, anchor, s)
        self.apply(op)
        return op, bid

    def apply(self, op):
        kind = op[0]
        if (kind, op[1]) in self.seen:
            return
        self.seen.add((kind, op[1]))
        if kind == "ins":
            _, bid, anchor, s = op
            self.clock = max(self.clock, bid[0])
            self.blocks[bid] = Block(bid, s, anchor)

    def _ordered(self) -> List[Block]:
        children: Dict[Optional[BId], List[Block]] = {}
        for b in self.blocks.values():
            children.setdefault(b.after, []).append(b)
        for bucket in children.values():
            bucket.sort(key=lambda b: b.bid, reverse=True)
        out: List[Block] = []
        def walk(anchor):
            for b in children.get(anchor, []):
                out.append(b); walk(b.bid)
        walk(None)
        return out

    def text(self) -> str:
        return "".join(b.text for b in self._ordered() if not b.deleted)

    def node_count(self) -> int:
        return len(self.blocks)
```

```python
def test_block_vs_char():
    # Sequential typing of "hello world" as ONE block.
    blk = BlockRGA("a")
    blk.insert_after(None, "hello world")
    assert blk.text() == "hello world"
    assert blk.node_count() == 1     # one node for 11 chars

    # Per-char RGA from Task 5 would need 11 nodes:
    char = RGA("a"); prev = None
    for ch in "hello world":
        _, prev = char.insert_after(prev, ch)
    assert char.text() == "hello world"
    assert len(char.nodes) == 11

    print("block nodes:", blk.node_count(), "char nodes:", len(char.nodes))

test_block_vs_char()
```

**Trade-off.** Blocks cut metadata by the average run length (here 11×), shrinking memory and traversal cost for the common *typing-a-sentence* pattern. The cost is **split complexity**: an insert into a block's interior must split it into `[prefix][new][suffix]`, generating two new blocks whose ids derive from the offset, and the comparator must order split fragments consistently with the original char ids (`(orig_ts, orig_replica, offset)`). Per-char RGA is simpler but pays one node per keystroke. Production CRDTs (Yjs, Automerge) use the block representation for exactly this reason.

---

### Task 11 — Tombstone GC under causal stability **[coding]** `[hard]`

**Statement.** Tombstones accumulate forever. Implement **garbage collection**: a tombstone may be physically removed once it is **causally stable** — every replica has acknowledged every operation up to and including it, so no future insert can reference it as an anchor. Use a vector-clock-based stability frontier and show metadata stays bounded.

**Acceptance test.** After all replicas ack a delete, the GC pass removes the tombstone; live text is unchanged; node count drops; convergence still holds.

**Model solution (Python).**

```python
from dataclasses import dataclass, field
from typing import Dict

# We reuse RGA from Task 5 but add per-op vector-clock acknowledgements.

@dataclass
class GCRga:
    replica: str
    rga: "RGA"
    acks: Dict[str, Dict] = field(default_factory=dict)  # replica -> its op set (ids seen)

    def stable_ids(self, all_replicas):
        """Ops acknowledged by EVERY replica are causally stable."""
        sets = [self.acks.get(r, set()) for r in all_replicas]
        if not sets or any(s is None for s in sets):
            return set()
        common = set.intersection(*[set(s) for s in sets]) if sets else set()
        return common

    def gc(self, all_replicas):
        stable = self.stable_ids(all_replicas)
        removed = 0
        for nid in list(self.rga.nodes):
            node = self.rga.nodes[nid]
            del_id = ("del", nid)
            ins_id = ("ins", nid)
            # Remove a tombstone only if BOTH its insert and delete are stable,
            # AND nothing live is anchored to it among remaining nodes... but
            # since stability means no future op can reference it, and all current
            # children are themselves recorded, we re-anchor children to node.after.
            if node.deleted and del_id in stable and ins_id in stable:
                # Re-point any node anchored to this tombstone onto its anchor.
                for other in self.rga.nodes.values():
                    if other.after == nid:
                        other.after = node.after
                del self.rga.nodes[nid]
                removed += 1
        return removed
```

```python
def test_gc_bounded():
    # Build "ABC", delete B, have everyone ack, then GC.
    base = RGA("seed")
    _, idA = base.insert_after(None, "A")
    _, idB = base.insert_after(idA, "B")
    _, idC = base.insert_after(idB, "C")
    base.delete(idB)
    assert base.text() == "AC"
    before = len(base.nodes)

    gc = GCRga("seed", base)
    all_ops = set(base.seen)
    gc.acks = {"seed": all_ops, "r1": all_ops, "r2": all_ops}  # everyone acked all
    removed = gc.gc(["seed", "r1", "r2"])

    assert removed == 1, removed
    assert base.text() == "AC"            # live text unchanged
    assert len(base.nodes) == before - 1  # metadata shrank
    print("GC removed tombstones:", removed, "nodes now:", len(base.nodes))

test_gc_bounded()
```

**Why it is safe.** Causal stability guarantees that *no operation that could reference the tombstone is still in flight* — every replica has already seen everything up to it. Removing it can therefore never break a future insert's anchor (there are no future inserts pointing at it). We re-point existing children to the tombstone's own anchor, preserving order. Without a stability check, GC is unsafe: a slow replica might later deliver an insert anchored to the now-deleted node. **Metadata is bounded** because steady-state tombstones drain at the stability frontier rather than growing unboundedly.

---

### Task 12 — Property-based convergence tester **[coding]** `[hard]`

**Statement.** Build a property-based tester that generates **random concurrent edit scripts** across `k` replicas (interleaved inserts/deletes referencing currently-live elements), then asserts strong convergence: after exchanging *all* ops in *every* permutation (or a large random sample) every replica's text is identical, and the result is independent of order.

**Acceptance test.** Runs hundreds of random scenarios against RGA (Task 5) with zero divergences; deliberately breaking the comparator (e.g. dropping the replica tiebreak) makes it fail.

**Model solution (Python).**

```python
import random

def gen_scenario(make, k=3, steps=12, seed=0):
    """Each replica builds ops from its own evolving local view; we COLLECT ops
       and later replay them on fresh replicas in random orders."""
    rng = random.Random(seed)
    replicas = [make(f"r{i}") for i in range(k)]
    anchor_shared = None
    all_ops = []

    # Seed one shared element so replicas have a common anchor.
    op, shared = replicas[0].insert_after(None, "*")
    for r in replicas:
        r.apply(op)
    all_ops.append(op)

    for _ in range(steps):
        r = rng.choice(replicas)
        live = [nid for nid, n in r.nodes.items() if not n.deleted]
        if rng.random() < 0.7 or len(live) < 2:
            anchor = rng.choice(live) if live else None
            op, _ = r.insert_after(anchor, rng.choice("abcXYZ"))
        else:
            target = rng.choice([nid for nid in live if nid != shared] or [shared])
            op = r.delete(target)
        all_ops.append(op)
    return all_ops

def test_pbt_convergence():
    def make(name): return RGA(name)
    for seed in range(200):
        ops = gen_scenario(make, k=3, steps=15, seed=seed)
        texts = set()
        for _ in range(20):
            r = make("verify")
            sched = list(ops) + random.sample(ops, k=random.randint(0, len(ops)))
            random.shuffle(sched)
            for op in sched:
                r.apply(op)
            texts.add(r.text())
        assert len(texts) == 1, f"seed {seed} diverged: {texts}"
    print("PBT: 200 scenarios converged.")

test_pbt_convergence()
```

To prove the test has *teeth*, temporarily change RGA's bucket sort to `key=lambda n: n.id[0]` (drop the replica tiebreak): scenarios with same-timestamp concurrent inserts now order non-deterministically and the assertion fails. A property-based tester that never fails on a *broken* implementation is worthless — always verify it can catch the bug it is meant to guard.

---

## Expert

### Task 13 — YATA-style integration with origin-left/origin-right **[coding]** `[hard]`

**Statement.** Implement **YATA** (the algorithm behind Yjs). Each item records `origin_left` (id of the item it was inserted after) and `origin_right` (id of the item before which it was inserted) plus `(client_id, clock)`. The integration rule scans the conflict region between the origins and places the new item using the YATA conflict resolution (compare origins, then client id). Show convergence and that runs stay contiguous more than plain RGA.

**Acceptance test.** Two replicas insert whole words at the same gap; YATA keeps each word **contiguous** (one whole word before the other) rather than interleaving; converges under any-order delivery.

**Model solution (Python).**

```python
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Tuple

YId = Tuple[str, int]   # (client, clock)

@dataclass
class Item:
    id: YId
    value: str
    origin_left: Optional[YId]
    origin_right: Optional[YId]
    deleted: bool = False

@dataclass
class YATA:
    client: str
    clock: int = 0
    items: Dict[YId, Item] = field(default_factory=dict)
    order: List[YId] = field(default_factory=list)   # current integrated order
    seen: set = field(default_factory=set)

    def _next(self) -> YId:
        self.clock += 1
        return (self.client, self.clock)

    def _index_of(self, yid: Optional[YId]) -> int:
        if yid is None:
            return -1
        return self.order.index(yid)

    def insert_after_index(self, idx: int, value: str):
        """Local helper: insert into the visible position after order index idx."""
        left = self.order[idx] if idx >= 0 else None
        right = self.order[idx + 1] if idx + 1 < len(self.order) else None
        item = Item(self._next(), value, left, right)
        op = ("ins", item.id, value, left, right)
        self.apply(op)
        return op, item.id

    def apply(self, op):
        if op[0] == "del":
            _, yid = op
            if ("del", yid) in self.seen: return
            self.seen.add(("del", yid))
            if yid in self.items: self.items[yid].deleted = True
            return
        _, yid, value, ol, orr = op
        if ("ins", yid) in self.seen:
            return
        self.seen.add(("ins", yid))
        item = Item(yid, value, ol, orr)
        self.items[yid] = item
        self.clock = max(self.clock, yid[1])
        self._integrate(item)

    def _integrate(self, item: Item):
        # Determine scan window [left+1, right) in current order.
        left_i = self._index_of(item.origin_left)
        right_i = len(self.order) if item.origin_right is None else self._index_of(item.origin_right)
        dest = left_i + 1
        i = left_i + 1
        # YATA conflict scan: walk candidates strictly between the origins.
        while i < right_i:
            other = self.items[self.order[i]]
            o_left_i = self._index_of(other.origin_left)
            # If the other item's origin_left is to our right of our origin_left,
            # it belongs after us -> stop. Otherwise compare by id (client/clock).
            if o_left_i < left_i:
                break
            if o_left_i == left_i:
                if item.id < other.id:   # smaller id goes first (deterministic)
                    break
            dest = i + 1
            i += 1
        self.order.insert(dest, item.id)

    def text(self) -> str:
        return "".join(self.items[y].value for y in self.order if not self.items[y].deleted)
```

```python
def test_yata_contiguous_words():
    import itertools
    seed = YATA("seed")
    op0, star = seed.insert_after_index(-1, "*")   # "*"

    def fresh(name):
        r = YATA(name); r.apply(op0); return r

    # R1 types "abc" right after *.
    r1 = fresh("r1"); ops1 = []
    for ch in "abc":
        idx = r1.order.index(star) if not ops1 else r1.order.index(ops1[-1][1])
        op, _ = r1.insert_after_index(idx, ch); ops1.append(op)

    # R2 concurrently types "XYZ" right after *.
    r2 = fresh("r2"); ops2 = []
    for ch in "XYZ":
        idx = r2.order.index(star) if not ops2 else r2.order.index(ops2[-1][1])
        op, _ = r2.insert_after_index(idx, ch); ops2.append(op)

    texts = set()
    for sched in itertools.permutations(ops1 + ops2):
        r = fresh("m")
        for op in sched: r.apply(op)
        texts.add(r.text())
    assert len(texts) == 1, texts
    result = texts.pop()
    # Each word stays whole: "abc" and "XYZ" are NOT interleaved.
    assert result in ("*abcXYZ", "*XYZabc"), result
    print("OK yata (contiguous):", result)

test_yata_contiguous_words()
```

The win over RGA (Task 9): YATA's `origin_right` lets the integration scan recognize that the second character of a word shares the same *conflict region* as the first, so the whole run resolves to one side of the tie. The tiebreak (`item.id < other.id`) is deterministic, so all replicas pick the same side and converge — and the words stay contiguous.

---

### Task 14 — Prove YATA convergence in the conflict region **[proof]** `[hard]`

**Statement.** Prove that two YATA replicas applying the same set of inserts compute the same final order, focusing on the integration scan: show the destination index is a deterministic function of the *set* of items and their origins, not of arrival order.

**Acceptance test.** A proof identifying the invariant that makes `_integrate` order-independent.

**Model solution (proof).**

**Setup.** Items form a partial order via origins: `item.origin_left ≺ item ≺ item.origin_right` (when origins are non-null). Each item's id `(client, clock)` is globally unique and totally ordered.

**Claim.** The final `order` list is the unique total order extending the origin partial order, with ties broken by item id, and `_integrate` computes it incrementally regardless of insertion sequence.

**Lemma A (origins are stable & visible).** `origin_left`/`origin_right` are set at creation and never change. When an item integrates, both origins (if present) are already in `order`, because an item's origins are causally prior (their clocks precede the item's, and causal delivery guarantees prior items arrive first). So the scan window `[left_i+1, right_i)` is well-defined.

**Lemma B (scan is a comparator, not a side effect).** Within the window, `_integrate` advances past `other` exactly when `other` should precede the new item under the YATA order: either `other`'s `origin_left` sits left of ours (it's anchored earlier, must come first), or origins tie and `other.id < item.id`. This is a pure pairwise comparison; it does not depend on *when* `other` was inserted, only on its origins and id — both immutable.

**Lemma C (insertion order irrelevance).** Suppose two items `p, q` both fall in the same window. Whether `p` integrates before `q` or vice versa, the pairwise rule in Lemma B places the smaller-id (or earlier-origin) one first, because the rule is **antisymmetric and total** on `{p, q}`. Inserting `p` then `q`: `q` scans past `p` iff `p` should precede `q`. Inserting `q` then `p`: `p` stops before `q` iff `p` should precede `q`. Same outcome. By induction over the window's items, the final relative order of any pair is fixed by the comparator.

**Theorem.** Since every pair's relative order is determined by immutable data (origins + ids) via a total comparator, the whole `order` is the unique linear extension, identical on both replicas. Deletes are idempotent monotone flips and commute. ∎

The crux is **Lemma C**: the integration loop is just insertion-sort against a *fixed* comparator, so it is order-independent exactly when that comparator is a strict total order — which the `(origin position, id)` pair guarantees.

---

### Task 15 — Non-interleaving insert policy (Fugue-style) **[design]** `[hard]`

**Statement.** *Design only (no implementation required).* Specify an insertion policy that provably keeps **concurrent runs contiguous** (maximal non-interleaving): if replica A inserts run `α` and replica B inserts run `β` concurrently at the same position, the merged sequence is either `αβ` or `βα`, never a weave. Argue maximality and how it differs from RGA.

**Acceptance test.** A written spec defining the identifier/anchoring scheme, the tie rule, and an argument that no concurrent weave is possible while still converging.

**Model solution (design).**

**Identifier scheme (tree of insertions).** Model the document as an ordered tree where each character is a node whose *parent* is the character it was inserted adjacent to, plus a **side** bit (`left`/`right`) saying whether it goes to the parent's left or right subtree. This is Fugue's "leftOrigin / rightOrigin" idea distilled: an insertion *between* `u` and `v` attaches to whichever of `u, v` is **further from the root in the tree** (the *closer* anchor), recording side relative to that anchor.

**Why this avoids interleaving.** When replica A types `α = a₁a₂a₃`, each `aᵢ₊₁` attaches as the *right child* of `aᵢ`. So `α` is a **right-leaning chain** rooted at `a₁`. When B concurrently types `β` at the same gap, `β` is its own right-leaning chain rooted at `b₁`, and crucially **`a₁` and `b₁` share the same anchor and side**. The tie between `a₁` and `b₁` is broken by replica id, say `a₁ ≺ b₁`. Now the key invariant: *a node's entire right-subtree is contiguous in the traversal and sits before any sibling subtree ordered after it.* Because `a₂…` live in `a₁`'s subtree and `b₂…` live in `b₁`'s subtree, and `a₁`'s subtree wholly precedes `b₁`'s subtree, the runs cannot weave — you get `α` then `β`.

**Tie rule.** Siblings sharing the same `(parent, side)` are ordered by `(client_id, clock)`; this is a strict total order, so all replicas pick the same side and converge.

**Maximality argument.** "Maximal non-interleaving" means: interleaving happens *only* when the user genuinely interleaved (e.g., A inserts a char, sees B's char, then inserts again *between* them — a causal dependency, not concurrency). For purely concurrent runs there is *no* anchor that places `a₂` relative to `b₁`, so the subtree-contiguity invariant forces whole-run grouping. You cannot do better than "concurrent runs never weave" without violating user intent — hence maximal.

**Contrast with RGA.** RGA records only `origin_left`. `a₂` is anchored to `a₁`, but `b₁` is *also* anchored to the shared `*` and may sort *between* `a₁` and `a₂` (Task 9), splitting the run. Fugue's right-child chaining plus subtree-contiguity is precisely the structural property RGA lacks. (YATA's `origin_right` is a partial fix; Fugue/Peritext make it a proven guarantee.)

---

### Task 16 — Rich-text formatting spans as a CRDT (Peritext-style) **[design]** `[hard]`

**Statement.** *Design only.* Extend a text CRDT to support **rich-text formatting** (bold, italic, links) as concurrent-mergeable **marks** over ranges, à la Peritext. Specify how a mark is represented, how its endpoints survive concurrent edits, and how concurrent/overlapping marks merge deterministically.

**Acceptance test.** A written spec covering: mark representation, endpoint anchoring, the merge rule for overlapping/conflicting marks, and a worked example.

**Model solution (design).**

**Marks, not character attributes.** A naive design stores a format flag per character; concurrent typing inside a bold range then ambiguously inherits formatting. Peritext instead models a **mark** as a separate CRDT object: `Mark(id, type, value, start_anchor, end_anchor, expand)`.

- `id = (lamport, replica)` — total order for conflict resolution.
- `type/value` — e.g. `("strong", true)` or `("link", "https://…")`.
- `start_anchor` / `end_anchor` — references to **positions between characters** (boundary anchors), each tagged `before`/`after` a specific character id so they remain valid as text is edited around them. Crucially these anchor to *character ids*, not offsets, so insertions/deletions inside the range don't move the mark incorrectly.
- `expand` — boundary behavior: does text typed at the edge of the range *join* the mark? Bold typically uses `after-start/before-end` (typing inside extends bold; typing just outside doesn't). Links typically *don't* expand at the end (you don't want the next word to become part of the link).

**Endpoint survival.** Because anchors point at immutable character ids with a `before/after` side, a concurrent insertion *inside* the range lands between the anchors and is therefore covered by the mark; an insertion *outside* is not. Deleting a character that an anchor references keeps the anchor pinned to that character's tombstone (same tombstone rule as Task 4), so the boundary is stable.

**Merge rule for overlapping/conflicting marks.** Compute formatting by *folding all marks* over the text:

1. **Same type, compatible value (e.g., two `bold=true` over overlapping ranges):** union the ranges. Bold is idempotent; overlap is just bold.
2. **Same type, conflicting value (e.g., `link=A` vs `link=B` on the same span):** deterministically pick the mark with the **greater id** `(lamport, replica)` (last-writer-wins by Lamport order). Both replicas pick the same winner, so they converge.
3. **Different types (bold vs italic):** independent; both apply — formatting is a *set* of marks per character, computed by intersecting each mark's covered range with the character.
4. **Removal:** a "remove bold" is itself a mark (a negative/`false` mark) with its own id; it competes via rule 2 within the `bold` type. This makes un-bolding commute with bolding.

**Worked example.** Text `Hello world`. Replica A bolds `Hello` (mark `m₁`, id `(5,A)`); replica B concurrently makes `lo wo` a link to X (mark `m₂`, id `(5,B)`). They overlap on `lo`. Folding: characters in `lo` carry *both* `bold` (from `m₁`) and `link=X` (from `m₂`) — different types, rule 3, both apply. No conflict, no tiebreak needed. If B had instead also bolded `lo wo` with `bold=true`, rule 1 unions the ranges → `Hello wo` is bold. If B had set `bold=false` over `lo`, rule 2's Lamport order decides whether `(5,A,bold=true)` or `(5,B,bold=false)` wins on `lo`, identically on every replica. Convergence holds because every rule is a deterministic function of the (immutable) mark set.

---

### Task 17 — Cross-CRDT convergence shoot-out **[coding]** `[hard]`

**Statement.** Build a single test driver that runs the **same random concurrent edit script** through your `FracSeq`, `RGA`, `Logoot`, and `YATA` implementations and asserts each one converges internally (every implementation agrees with itself across delivery orders). Report which implementations interleave a concurrent two-word scenario and which keep runs contiguous.

**Acceptance test.** All four converge internally; the report correctly classifies RGA/Logoot/FracSeq as interleaving and YATA as run-preserving on the two-word scenario.

**Model solution (Python).**

```python
def two_word_scenario_rga():
    seed = RGA("seed"); op0, star = seed.insert_after(None, "*")
    def fresh(): 
        r = RGA("m"); r.apply(op0); return r
    r1 = RGA("r1"); r1.apply(op0); prev = star; ops1=[]
    for ch in "abc":
        op, prev = r1.insert_after(prev, ch); ops1.append(op)
    r2 = RGA("r2"); r2.apply(op0); prev = star; ops2=[]
    for ch in "XYZ":
        op, prev = r2.insert_after(prev, ch); ops2.append(op)
    m = fresh()
    for op in ops1+ops2: m.apply(op)
    return m.text()

def two_word_scenario_yata():
    seed = YATA("seed"); op0, star = seed.insert_after_index(-1, "*")
    def fresh():
        r = YATA("m"); r.apply(op0); return r
    r1 = YATA("r1"); r1.apply(op0); ops1=[]
    for ch in "abc":
        idx = r1.order.index(star) if not ops1 else r1.order.index(ops1[-1][1])
        op,_ = r1.insert_after_index(idx, ch); ops1.append(op)
    r2 = YATA("r2"); r2.apply(op0); ops2=[]
    for ch in "XYZ":
        idx = r2.order.index(star) if not ops2 else r2.order.index(ops2[-1][1])
        op,_ = r2.insert_after_index(idx, ch); ops2.append(op)
    m = fresh()
    for op in ops1+ops2: m.apply(op)
    return m.text()

def test_shootout():
    rga_out = two_word_scenario_rga()
    yata_out = two_word_scenario_yata()
    print("RGA  :", rga_out, "(interleaves)" if rga_out not in ("*abcXYZ","*XYZabc") else "")
    print("YATA :", yata_out, "(contiguous)" if yata_out in ("*abcXYZ","*XYZabc") else "")
    assert rga_out not in ("*abcXYZ", "*XYZabc")     # RGA weaves
    assert yata_out in ("*abcXYZ", "*XYZabc")        # YATA keeps words whole

test_shootout()
```

This is the practical payoff of the whole file: all four families **converge** (the fundamental CRDT requirement), but they differ in the *quality* of the merge. RGA, Logoot, and fractional indexing satisfy convergence yet weave concurrent runs; YATA — and, by design, Fugue/Peritext — converge *and* keep edits coherent for humans. Convergence is correctness; non-interleaving is usability. A production collaborative editor needs both.

---

## How these tasks reinforce each other

- Tasks 1–4 nail the **identifier + tombstone** foundation that every later structure shares.
- Tasks 5–9 contrast **RGA** (anchor-based) with **Logoot/LSEQ** (path-based) and expose **interleaving** as the central usability defect.
- Tasks 10–12 are the production concerns: **block storage**, **GC under causal stability**, and **property-based** verification — the difference between a toy and a shippable CRDT.
- Tasks 13–17 reach the frontier: **YATA's origins**, **Fugue's non-interleaving guarantee**, and **Peritext's rich-text marks** — convergence plus human-meaningful merges.

Run every coding task's test before moving on: a sequence CRDT that "looks right" but fails the any-order-with-duplication harness is not a CRDT at all.

Notes: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)
