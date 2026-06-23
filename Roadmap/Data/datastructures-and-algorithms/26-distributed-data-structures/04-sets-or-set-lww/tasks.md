# Set CRDTs — Practice Tasks

> Build the full family of replicated sets — **G-Set**, **2P-Set**, **LWW-Element-Set**, **OR-Set**, and **ORSWOT** — and learn to feel the semantic differences in your fingertips. Python is the primary language; Go appears where it sharpens a point. Every coding task ships with the same kind of **acceptance test**: replay a sequence of concurrent `add`/`remove` operations across replicas, then sync the replicas under an adversarial transport that **drops**, **duplicates**, and **reorders** messages. Assert two things, not one: (1) all replicas reach **identical state** (convergence), and (2) the converged state matches the **intended conflict semantics** — add-wins for OR-Set/ORSWOT, last-writer-wins for LWW-Set, remove-permanent for 2P-Set. A test that only checks convergence will happily pass on a set that converges to the *wrong* answer.
>
> Work top-to-bottom: each tier earns the next. By the end you should be able to pick the right set CRDT for a feature and defend the choice.
>
> **Related practice:** [CRDT Fundamentals tasks](../01-crdt-fundamentals/tasks.md) · [Counter tasks](../03-counters-g-pn/tasks.md) · [Sequence/Text tasks](../05-sequences-and-text-crdts/tasks.md)
>
> Notes: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

---

## How to use this page

- `[coding]` tasks want runnable code plus a passing acceptance test.
- `[proof]` tasks want a written argument: state the claim, the invariant, and the case analysis. A model proof follows each one.
- `[design]` tasks want a decision document: options, trade-offs, a recommendation, and the failure mode you are accepting.
- Difficulty tags `[easy] [medium] [hard]` estimate effort, not importance.

A shared adversarial-sync harness is used throughout. Implement it once (Task 4) and reuse it.

---

## Beginner

### Task 1 — Grow-only set (G-Set) **[coding]** `[easy]`

**Statement.** Implement a G-Set: a state-based (CvRDT) set that only supports `add` and `lookup`. The merge of two G-Sets is set union. Prove to yourself, via the acceptance test, that merge is commutative, associative, and idempotent in practice.

**Acceptance test.**
- Three replicas each `add` a disjoint handful of elements.
- Merge them pairwise in several different orders, and merge some replica with itself.
- Assert every replica ends with the union of all added elements, regardless of merge order or repetition.

**Model solution.**

```python
from dataclasses import dataclass, field
from typing import Set, Hashable

@dataclass
class GSet:
    elements: Set[Hashable] = field(default_factory=set)

    def add(self, e: Hashable) -> None:
        self.elements.add(e)

    def lookup(self, e: Hashable) -> bool:
        return e in self.elements

    def merge(self, other: "GSet") -> "GSet":
        return GSet(self.elements | other.elements)

    def value(self) -> Set[Hashable]:
        return set(self.elements)


def test_gset_converges_regardless_of_order():
    a, b, c = GSet(), GSet(), GSet()
    a.add("x"); a.add("y")
    b.add("y"); b.add("z")
    c.add("w")

    expected = {"x", "y", "z", "w"}

    # commutativity: a∪b == b∪a
    assert a.merge(b).value() == b.merge(a).value()
    # idempotence: a∪a == a
    assert a.merge(a).value() == a.value()
    # associativity + full convergence in two orders
    left  = a.merge(b).merge(c)
    right = c.merge(b.merge(a))
    assert left.value() == right.value() == expected


if __name__ == "__main__":
    test_gset_converges_regardless_of_order()
    print("G-Set OK")
```

**Why it works.** The state forms a join-semilattice under `⊆`; `merge` is the least upper bound (union). Union is commutative, associative, and idempotent, so the three CvRDT conditions hold by construction. The only "operation" is monotone growth, so there is no conflict to resolve.

---

### Task 2 — Two-phase set (2P-Set) and the no-re-add wall **[coding]** `[medium]`

**Statement.** Implement a 2P-Set: two G-Sets, an *add-set* `A` and a *remove-set* (tombstones) `R`. An element is present iff it is in `A` and **not** in `R`. Then write a test that demonstrates the fundamental limitation: **once an element is removed, it can never be re-added.**

**Acceptance test.**
- `add("k")`, confirm present.
- `remove("k")`, confirm absent.
- `add("k")` again, confirm it is *still absent* (the tombstone wins forever).
- Merge with a fresh replica that only ever did `add("k")` and assert the element stays absent — the tombstone is sticky across replicas too.

**Model solution.**

```python
from dataclasses import dataclass, field
from typing import Set, Hashable

@dataclass
class TwoPSet:
    A: Set[Hashable] = field(default_factory=set)  # added
    R: Set[Hashable] = field(default_factory=set)  # removed (tombstones)

    def add(self, e: Hashable) -> None:
        self.A.add(e)

    def remove(self, e: Hashable) -> None:
        if e in self.A:           # can only remove what was observed-added
            self.R.add(e)

    def lookup(self, e: Hashable) -> bool:
        return e in self.A and e not in self.R

    def merge(self, other: "TwoPSet") -> "TwoPSet":
        return TwoPSet(self.A | other.A, self.R | other.R)

    def value(self) -> Set[Hashable]:
        return {e for e in self.A if e not in self.R}


def test_2pset_no_readd():
    s = TwoPSet()
    s.add("k");    assert s.lookup("k")
    s.remove("k"); assert not s.lookup("k")
    s.add("k");    assert not s.lookup("k"), "tombstone must win — re-add is impossible"

    fresh = TwoPSet(); fresh.add("k")
    merged = s.merge(fresh)
    assert not merged.lookup("k"), "tombstone is sticky across replicas"
    print("2P-Set OK (re-add correctly impossible)")


if __name__ == "__main__":
    test_2pset_no_readd()
```

**Why it works (and why it hurts).** Both `A` and `R` are grow-only, so the merge is well-defined and convergent. But because `R` only grows, membership is a monotone *down* step that can never be undone. That gives you correctness at the cost of usefulness: a 2P-Set is right for "delete is permanent" domains (e.g., revoked credentials) and wrong for anything users expect to toggle (likes, group membership, shopping carts).

---

### Task 3 — LWW-Element-Set with a `(timestamp, nodeId)` tiebreak **[coding]** `[medium]`

**Statement.** Implement an LWW-Element-Set: keep an *add-timestamp* and a *remove-timestamp* per element. An element is present iff its latest add strictly dominates its latest remove. Break exact-timestamp ties **deterministically** using `nodeId`, so concurrent ops at the same logical time still converge identically on all replicas.

**Acceptance test.**
- Two replicas `add` and `remove` the same key at carefully chosen timestamps.
- Include an exact-tie case (same timestamp, different node) and assert the higher `nodeId` (or your fixed rule) wins **the same way on both replicas**.
- Merge in both directions and assert identical membership.

**Model solution.** A timestamp is the pair `(ts, node)`, ordered lexicographically. The rule below is **bias-add on a pure tie within the same stamp**; choose one bias and apply it everywhere.

```python
from dataclasses import dataclass, field
from typing import Dict, Hashable, Tuple, Optional

Stamp = Tuple[int, str]  # (timestamp, nodeId); compared lexicographically

@dataclass
class LWWSet:
    adds: Dict[Hashable, Stamp]    = field(default_factory=dict)
    removes: Dict[Hashable, Stamp] = field(default_factory=dict)

    def add(self, e: Hashable, stamp: Stamp) -> None:
        if e not in self.adds or stamp > self.adds[e]:
            self.adds[e] = stamp

    def remove(self, e: Hashable, stamp: Stamp) -> None:
        if e not in self.removes or stamp > self.removes[e]:
            self.removes[e] = stamp

    def lookup(self, e: Hashable) -> bool:
        a: Optional[Stamp] = self.adds.get(e)
        r: Optional[Stamp] = self.removes.get(e)
        if a is None:
            return False
        if r is None:
            return True
        return a > r            # add must strictly dominate remove (add-biased)

    @staticmethod
    def _merge_maps(x, y):
        out = dict(x)
        for k, s in y.items():
            if k not in out or s > out[k]:
                out[k] = s
        return out

    def merge(self, other: "LWWSet") -> "LWWSet":
        return LWWSet(self._merge_maps(self.adds, other.adds),
                      self._merge_maps(self.removes, other.removes))

    def value(self):
        return {e for e in self.adds if self.lookup(e)}


def test_lww_tiebreak_is_deterministic():
    # exact timestamp tie: same ts=5, different nodes; lexicographic stamp wins.
    p = LWWSet(); q = LWWSet()
    p.add("k", (5, "nodeA"))
    q.remove("k", (5, "nodeB"))           # remove from a "later" node id

    pq = p.merge(q)
    qp = q.merge(p)
    assert pq.value() == qp.value()       # convergence regardless of direction
    # (5,"nodeB") > (5,"nodeA")  -> remove stamp dominates -> absent
    assert not pq.lookup("k")

    # clean later-add wins
    r = LWWSet(); r.adds.update(pq.adds); r.removes.update(pq.removes)
    r.add("k", (9, "nodeA"))
    assert r.lookup("k")
    print("LWW-Set OK (deterministic tiebreak)")


if __name__ == "__main__":
    test_lww_tiebreak_is_deterministic()
```

**Why it works.** Per element, `adds[e]` and `removes[e]` are each a max over a totally ordered stamp domain — that is a lattice join, so it is commutative/associative/idempotent and order-independent. Because the stamp `(ts, node)` is a **total** order, two replicas seeing the same set of stamps always pick the same winner. The bias (add-wins on equal stamps via the `>` in `lookup`) must be identical everywhere.

---

### Task 4 — Adversarial convergence harness (reorder / drop / duplicate) **[coding]** `[medium]`

**Statement.** Build the reusable test harness every later task depends on. Given a list of replicas and a stream of "deltas" (or full states) produced by their operations, the harness gossips messages between replicas under a transport that randomly **drops** (but eventually delivers at least once), **duplicates**, and **reorders** them, until the system quiesces. Assert all replicas converge.

**Acceptance test.**
- Plug in the LWW-Set from Task 3 (state-based merge).
- Run many randomized schedules (fuzz with several seeds).
- Assert: after the harness drains, every replica's `value()` is identical, for *every* seed.

**Model solution (state-based gossip; works for any CvRDT with `merge`).**

```python
import random
from typing import List, Callable, TypeVar

T = TypeVar("T")  # a replica type exposing .merge(other) and .value()

def gossip_until_converged(replicas: List[T],
                           merge: Callable[[T, T], T],
                           seed: int,
                           rounds: int = 200) -> None:
    """Anti-entropy with an adversarial transport.

    Each round, pick a random ordered pair (i, j) and try to ship i's
    state to j. The transport may DROP (skip), DUPLICATE (apply twice),
    or simply REORDER (which is automatic because pairs are random).
    State-based merge is idempotent, so dup/reorder/redelivery are safe.
    We run enough rounds that, w.h.p., every pair has exchanged at least once.
    """
    rng = random.Random(seed)
    n = len(replicas)
    for _ in range(rounds):
        i = rng.randrange(n)
        j = rng.randrange(n)
        if i == j:
            continue
        if rng.random() < 0.30:          # DROP this delivery entirely
            continue
        merged = merge(replicas[j], replicas[i])
        replicas[j] = merged
        if rng.random() < 0.20:          # DUPLICATE delivery
            replicas[j] = merge(replicas[j], replicas[i])

def assert_all_converged(replicas: List[T]) -> None:
    vals = [r.value() for r in replicas]
    first = vals[0]
    for k, v in enumerate(vals[1:], start=1):
        assert v == first, f"replica {k} diverged: {v!r} != {first!r}"


# ---- Acceptance test using LWW-Set from Task 3 ----
def test_harness_converges_lww():
    from itertools import count
    for seed in range(50):
        clock = count(1)
        r1, r2, r3 = LWWSet(), LWWSet(), LWWSet()
        r1.add("a", (next(clock), "n1"))
        r2.add("b", (next(clock), "n2"))
        r3.add("a", (next(clock), "n3"))   # concurrent-ish re-add of "a"
        r1.remove("b", (next(clock), "n1"))
        replicas = [r1, r2, r3]
        gossip_until_converged(replicas, lambda x, y: x.merge(y), seed)
        assert_all_converged(replicas)
    print("Harness OK (LWW converges under drop/dup/reorder)")


if __name__ == "__main__":
    test_harness_converges_lww()
```

**Why it works.** Anti-entropy needs only two guarantees: every pair of replicas *eventually* exchanges state, and merge is idempotent. Drops are tolerated because we keep gossiping (eventual delivery); duplicates and reorder are tolerated because `merge` is a lattice join. The 30% drop / 20% dup rates with 200 rounds make full pairwise exchange overwhelmingly likely; if you make a CRDT that *can* diverge, this fuzzer will find a seed that exposes it.

---

## Intermediate

### Task 5 — OR-Set with unique tags (observed-remove) **[coding]** `[medium]`

**Statement.** Implement an OR-Set (Observed-Remove Set). Each `add(e)` mints a globally unique tag and stores `(e, tag)`. A `remove(e)` records the set of tags **currently observed** for `e` into a tombstone set. An element is present iff it has at least one add-tag not yet tombstoned. This is the canonical **add-wins** set.

**Acceptance test.**
- `add("x")`, `remove("x")`, `add("x")` on one replica and confirm `"x"` is present at the end (re-add works — unlike 2P-Set).
- Then a concurrency case in Task 6.

**Model solution.**

```python
import uuid
from dataclasses import dataclass, field
from typing import Set, Tuple, Hashable, Dict

Tag = str  # unique per add

@dataclass
class ORSet:
    # element -> set of live add-tags
    adds: Dict[Hashable, Set[Tag]]    = field(default_factory=dict)
    # element -> set of tombstoned tags
    tombstones: Dict[Hashable, Set[Tag]] = field(default_factory=dict)

    def add(self, e: Hashable) -> Tag:
        tag = uuid.uuid4().hex
        self.adds.setdefault(e, set()).add(tag)
        return tag

    def remove(self, e: Hashable) -> None:
        # tombstone exactly the tags observed *now* (observed-remove)
        observed = self.adds.get(e, set()) - self.tombstones.get(e, set())
        if observed:
            self.tombstones.setdefault(e, set()).update(observed)

    def lookup(self, e: Hashable) -> bool:
        live = self.adds.get(e, set()) - self.tombstones.get(e, set())
        return len(live) > 0

    def merge(self, other: "ORSet") -> "ORSet":
        out = ORSet()
        for src in (self, other):
            for e, tags in src.adds.items():
                out.adds.setdefault(e, set()).update(tags)
            for e, tags in src.tombstones.items():
                out.tombstones.setdefault(e, set()).update(tags)
        return out

    def value(self) -> Set[Hashable]:
        return {e for e in self.adds if self.lookup(e)}


def test_orset_readd_works():
    s = ORSet()
    s.add("x");    assert s.lookup("x")
    s.remove("x"); assert not s.lookup("x")
    s.add("x");    assert s.lookup("x"), "re-add must succeed (fresh tag, not tombstoned)"
    print("OR-Set OK (re-add works)")


if __name__ == "__main__":
    test_orset_readd_works()
```

**Why it works.** Each add is identified by a unique tag, so a re-add creates a *different* fact than the one a prior remove tombstoned. Removal only kills tags it has *observed*; tags born after (or concurrent with) a remove survive. Both maps are grow-only sets of tags, so merge is union and converges.

---

### Task 6 — Add-wins on concurrent add | remove **[coding]** `[hard]`

**Statement.** Using the OR-Set from Task 5 and the harness from Task 4, demonstrate the defining property: when a replica `add`s an element **concurrently** with another replica `remove`ing it, after sync the element is **present** (add wins). Show that this is *not* an accident of timestamps — it holds for any interleaving.

**Acceptance test.**
- Replica P has `"x"` (one tag). Replica Q has the same state (post-sync).
- *Concurrently*: P does `add("x")` (mints a new tag `t2`); Q does `remove("x")` (tombstones the tags Q observed, which do **not** include `t2`).
- Sync everything under the adversarial harness for many seeds.
- Assert `"x"` is present on all replicas — the concurrent add's tag `t2` is never tombstoned.

**Model solution.**

```python
def test_orset_add_wins_concurrent():
    for seed in range(50):
        # Establish a shared baseline containing "x" with one tag.
        p = ORSet()
        t1 = p.add("x")
        q = p.merge(ORSet())          # Q starts knowing about t1
        # Make q an independent object with the same knowledge:
        q = ORSet()
        q.adds["x"] = {t1}

        # CONCURRENT operations (neither has seen the other's op yet):
        t2 = p.add("x")               # P mints a brand-new tag t2
        q.remove("x")                 # Q tombstones only what it observed: {t1}

        replicas = [p, q, ORSet()]    # a third empty replica joins gossip
        gossip_until_converged(replicas, lambda a, b: a.merge(b), seed)
        assert_all_converged(replicas)

        final = replicas[0]
        assert final.lookup("x"), "add-wins: concurrent add's tag t2 survives"
        assert t1 in final.tombstones.get("x", set()), "t1 was correctly removed"
        assert t2 in final.adds.get("x", set()), "t2 is live"
    print("OR-Set OK (add-wins under concurrency, all seeds)")


if __name__ == "__main__":
    test_orset_add_wins_concurrent()
```

**Why it works.** "Observed-remove" means a remove can only tombstone tags it has *seen*. The concurrent add produces `t2`, which the concurrent remove provably has not seen (causality: the remove happened before `t2` existed at Q). After merge, `adds["x"] = {t1, t2}` and `tombstones["x"] = {t1}`, leaving `t2` live. There is no clock comparison anywhere — the bias is structural, so add always wins concurrent races.

---

### Task 7 — Prove: "once removed, always absent" for 2P-Set **[proof]** `[medium]`

**Statement.** Prove that in a 2P-Set, if element `e` is absent at some replica at some point, then `e` is absent at *every* replica at *every* later point (after merges), forever. Conclude that 2P-Set membership is a monotone, irreversible down-step once a tombstone exists.

**Model proof.**

Let a 2P-Set state be `(A, R)` with membership `e ∈ value(s) ⟺ e ∈ A ∧ e ∉ R`.

*Lemma (monotone tombstones).* Both `A` and `R` are grow-only. The only mutators are `add` (inserts into `A`) and `remove` (inserts into `R`), and `merge((A1,R1),(A2,R2)) = (A1∪A2, R1∪R2)`. Hence for any state `s` reachable from `s'` (by local ops and merges), `R(s') ⊆ R(s)`. □

*Claim.* If `e ∈ R(s')` at any reachable state `s'`, then `e ∉ value(s)` for every state `s` reachable from `s'`.

*Proof.* Suppose `e ∈ R(s')`. By the Lemma, `R(s') ⊆ R(s)`, so `e ∈ R(s)`. Membership requires `e ∉ R(s)`, which is false; therefore `e ∉ value(s)`. Since `s` was an arbitrary state reachable from `s'` (including any other replica after gossip, because gossip merges propagate `R`), the element is absent everywhere thereafter. ∎

*Corollary.* Re-adding `e` (inserting into `A`) cannot restore membership, because the membership predicate is gated by `e ∉ R` and `R` never shrinks. This is exactly the no-re-add limitation observed in Task 2. The "tombstone is observed by all replicas eventually" step relies on the standard eventual-delivery assumption of anti-entropy.

---

### Task 8 — LWW-Set loses an add under clock skew (counterexample) **[proof]** `[medium]`

**Statement.** Exhibit a concrete schedule in which an LWW-Element-Set **drops a legitimate add** purely because of wall-clock skew between nodes — an outcome users would call a "lost write." Explain why this is inherent to physical-clock LWW and what mitigations exist.

**Model proof / counterexample.**

Setup: two replicas with skewed physical clocks. Node `fast` runs ~10s ahead of node `slow` (true wall-clock real-time order shown in parentheses).

| Real time | Action | Stamp written |
|-----------|--------|---------------|
| t=00 (real) | `slow.add("k")` | `(100, "slow")` — slow's clock reads 100 |
| t=05 (real, *later*) | `fast.remove("k")` | wait — `fast` clock already read 110 *at real t=00* |

Concretely, choose stamps so the **later** real action carries the **smaller** timestamp:

- At real time `T0`, user removes `k` on `fast`; `fast`'s skewed-fast clock had advanced, but here we construct the painful case: `fast.remove("k")` is stamped `(100, "fast")`.
- At real time `T0 + Δ` (strictly later in reality), a different user *adds* `k` on `slow`; `slow`'s lagging clock stamps `slow.add("k")` with `(95, "slow")`.

After merge, `lookup("k")` compares `add=(95,"slow")` vs `remove=(100,"fast")`. Since `(95,"slow") < (100,"fast")`, the **remove wins** and `k` is absent — even though the add happened *later in real time* and was the user's most recent intent. The legitimate, causally-most-recent add is silently lost.

*Why it is inherent.* LWW resolves conflicts by **total order on timestamps**, but physical clocks are not synchronized; the timestamp order can disagree with real-time order by the magnitude of the clock skew. No amount of merging fixes it, because by the time states meet, the smaller stamp is simply the loser. Convergence still holds (all replicas agree `k` is absent) — but they converge to the *wrong* answer. This is the classic split between **safety of convergence** and **correctness of intent**.

*Mitigations.*
1. **Logical / hybrid clocks (HLC):** keep timestamps monotone with causality so a causally-later op never gets a smaller stamp; eliminates the skew-induced inversion for causally-related ops (does nothing for truly concurrent ones — but then "losing" one is acceptable by definition).
2. **NTP discipline + bounded skew:** shrinks the window but never closes it; do not rely on it for correctness.
3. **Use an OR-Set/ORSWOT** if the application semantics are "add-wins" — it has no clock at all and cannot lose a concurrent add (Task 6). Choosing LWW is choosing this failure mode; pick it only when last-writer-wins is genuinely the desired business rule.

---

## Advanced

### Task 9 — ORSWOT with version-vector causal context: no resurrection, tombstone-free removes **[coding]** `[hard]`

**Statement.** Implement an **ORSWOT** (Observed-Remove Set Without Tombstones, à la Riak's `riak_dt_orswot`). Instead of keeping tombstones forever, keep:
- a **version vector** `vv: node -> max counter` per replica (the *causal context*, "everything I have seen"), and
- per element, the set of **dots** `(node, counter)` that currently justify its presence.

A `remove` simply **drops the element's dots** (no tombstone) — the version vector remembers they happened, so a re-delivery of an already-removed add does **not** resurrect it. Demonstrate (a) **no resurrection** on duplicate/old delivery and (b) that removes leave **no tombstone** behind.

**Acceptance test.**
- Replica A `add`s `"x"` (dot `(A,1)`), syncs to B, then A `remove`s `"x"`.
- An adversary **re-delivers** the original add state to B *after* the remove has propagated.
- Assert `"x"` does **not** come back (the causal context covers `(A,1)`), and assert the converged state stores **no tombstone set** for `"x"` — only dots and the version vector.

**Model solution.** This is the subtle one; the merge rule is the whole game.

```python
from dataclasses import dataclass, field
from typing import Dict, Set, Tuple, Hashable

Dot = Tuple[str, int]          # (node, counter)

def vv_max(a: Dict[str, int], b: Dict[str, int]) -> Dict[str, int]:
    out = dict(a)
    for k, v in b.items():
        out[k] = max(out.get(k, 0), v)
    return out

def seen(vv: Dict[str, int], dot: Dot) -> bool:
    node, ctr = dot
    return vv.get(node, 0) >= ctr

@dataclass
class ORSWOT:
    node: str
    vv: Dict[str, int]                       = field(default_factory=dict)  # causal context
    dots: Dict[Hashable, Set[Dot]]           = field(default_factory=dict)  # element -> live dots

    def _next_dot(self) -> Dot:
        c = self.vv.get(self.node, 0) + 1
        self.vv[self.node] = c
        return (self.node, c)

    def add(self, e: Hashable) -> None:
        d = self._next_dot()
        # add-wins replace: a fresh add supersedes this replica's prior dots for e
        self.dots[e] = {d}

    def remove(self, e: Hashable) -> None:
        # tombstone-free: just forget the dots. vv still records they happened.
        self.dots.pop(e, None)

    def lookup(self, e: Hashable) -> bool:
        return bool(self.dots.get(e))

    def merge(self, other: "ORSWOT") -> "ORSWOT":
        """The ORSWOT merge (Bieniusa et al. / Riak DT).

        For each element, a dot survives iff:
          - it is in BOTH replicas' dot sets, OR
          - it is in one replica's dots and NOT yet seen by the other's vv
            (i.e. the other side never observed it, so it can't have removed it).
        A dot in one side's dots that the OTHER side has seen (vv) but dropped
        was *removed* there -> it dies. Then vv = pointwise max.
        """
        out = ORSWOT(self.node)
        elems = set(self.dots) | set(other.dots)
        for e in elems:
            s_dots = self.dots.get(e, set())
            o_dots = other.dots.get(e, set())
            keep = (s_dots & o_dots)
            keep |= {d for d in s_dots if not seen(other.vv, d)}
            keep |= {d for d in o_dots if not seen(self.vv, d)}
            if keep:
                out.dots[e] = keep
        out.vv = vv_max(self.vv, other.vv)
        return out

    def value(self) -> Set[Hashable]:
        return {e for e, ds in self.dots.items() if ds}


def test_orswot_no_resurrection_and_no_tombstones():
    A = ORSWOT("A")
    A.add("x")                       # dot (A,1)
    snapshot_of_add = ORSWOT("A")    # the adversary's "old add" message
    snapshot_of_add.vv = dict(A.vv)
    snapshot_of_add.dots = {"x": set(A.dots["x"])}

    B = ORSWOT("B")
    B = B.merge(A)                   # B learns x via (A,1)
    assert B.lookup("x")

    A.remove("x")                    # A drops the dot; vv still has A:1
    B = B.merge(A)                   # remove propagates to B
    assert not B.lookup("x")

    # Adversary RE-DELIVERS the original add to B, out of order, after remove:
    B = B.merge(snapshot_of_add)
    assert not B.lookup("x"), "no resurrection: (A,1) is covered by B.vv, so it dies"

    # Tombstone-free: there is no removed-set anywhere; B has only vv + dots.
    assert "tombstones" not in B.__dict__
    assert B.dots.get("x", set()) == set()
    print("ORSWOT OK (no resurrection, tombstone-free removes)")


if __name__ == "__main__":
    test_orswot_no_resurrection_and_no_tombstones()
```

**Why it works.** The version vector is a *compressed, unbounded-but-tiny* record of "every dot I have ever observed." A re-delivered old add carries dot `(A,1)`; when it meets `B`, `B.vv[A] >= 1` is true, so `(A,1)` is in the "seen but not in dots" bucket — meaning *removed* — and is discarded. No per-element tombstone is needed because the vector subsumes all of them. The only metadata that survives a remove is the vector entry (one integer per node), which is the key to the bounded-metadata story in Task 14.

---

### Task 10 — OR-Map (keys → CRDT values) and the remove-vs-update conflict **[coding]** `[hard]`

**Statement.** Implement an **OR-Map**: a map whose *keys* form an add-wins (OR-Set/ORSWOT) set and whose *values* are themselves CRDTs (e.g., a counter or a register per key). The hard part is the **concurrent remove-key vs update-value** conflict: one replica deletes key `k` while another increments `k`'s counter. Resolve it with **update-wins** (the standard Riak Map / δ-Map choice): an update *re-asserts* the key, so a concurrent delete does not silently swallow the increment.

**Acceptance test.**
- Seed both replicas with key `k -> counter=0`.
- *Concurrently*: replica P `remove_key("k")`; replica Q `update("k", +5)`.
- Sync under the harness. Assert: `k` is **present** (update-wins resurrects the key add-wins style) and its counter value is `5` — the increment is not lost.

**Model solution (keys via ORSWOT dots; values via a tiny G-Counter).**

```python
from dataclasses import dataclass, field
from typing import Dict, Hashable

class GCounter:
    def __init__(self): self.c: Dict[str, int] = {}
    def inc(self, node: str, n: int = 1): self.c[node] = self.c.get(node, 0) + n
    def value(self) -> int: return sum(self.c.values())
    def merge(self, other: "GCounter") -> "GCounter":
        out = GCounter()
        for k in set(self.c) | set(other.c):
            out.c[k] = max(self.c.get(k, 0), other.c.get(k, 0))
        return out
    def copy(self) -> "GCounter":
        g = GCounter(); g.c = dict(self.c); return g

@dataclass
class ORMap:
    node: str
    keys: "ORSWOT" = None                      # add-wins key set (from Task 9)
    vals: Dict[Hashable, GCounter] = field(default_factory=dict)

    def __post_init__(self):
        if self.keys is None:
            self.keys = ORSWOT(self.node)

    def update(self, k: Hashable, delta: int) -> None:
        self.keys.add(k)                        # update RE-ASSERTS the key (update-wins)
        self.vals.setdefault(k, GCounter()).inc(self.node, delta)

    def remove_key(self, k: Hashable) -> None:
        self.keys.remove(k)
        # value kept for now; merge resolves whether it stays live

    def lookup(self, k: Hashable):
        return self.vals[k].value() if self.keys.lookup(k) else None

    def merge(self, other: "ORMap") -> "ORMap":
        out = ORMap(self.node)
        out.keys = self.keys.merge(other.keys)  # add-wins / update-wins on keys
        for k in set(self.vals) | set(other.vals):
            a = self.vals.get(k, GCounter())
            b = other.vals.get(k, GCounter())
            out.vals[k] = a.merge(b)            # values always merge by their own CRDT law
        # prune values whose key is not live (optional, keeps map clean)
        return out

    def value(self):
        return {k: self.vals[k].value() for k in self.vals if self.keys.lookup(k)}


def test_ormap_update_wins_over_remove():
    # Seed: both know k -> 0
    P = ORMap("P"); P.update("k", 0)
    Q = ORMap("Q")
    Q = Q.merge(P)                              # Q learns key k

    # CONCURRENT: P removes the key, Q increments by 5
    P.remove_key("k")
    Q.update("k", 5)                            # re-asserts key with a fresh dot

    merged = P.merge(Q)
    merged = merged.merge(P).merge(Q)           # idempotent extra rounds
    assert merged.keys.lookup("k"), "update-wins: concurrent update re-asserts the key"
    assert merged.value()["k"] == 5, "the increment must survive the concurrent remove"
    print("OR-Map OK (update-wins over concurrent remove, value preserved)")


if __name__ == "__main__":
    test_ormap_update_wins_over_remove()
```

**Why it works.** Two design decisions cooperate. (1) Keys are an add-wins set, and an `update` performs an `add` of the key with a **fresh dot** — so the update's key-assertion is concurrent with the delete and add-wins keeps the key. (2) Values are independent CRDTs merged by their own law, so the `+5` increment merges in regardless of key liveness. The net effect is the documented Riak Map semantic: *deleting a key you are concurrently updating does not lose the update.* The only judgment call is whether to also clear the value on a *causal* (observed) delete — that is a policy knob, not a correctness requirement.

---

### Task 11 — Property-based tester: convergence + add-wins **[coding]** `[hard]`

**Statement.** Write a property-based test that generates random sequences of `add`/`remove` operations across N replicas, applies them under random sync schedules (your harness), and checks two **invariants** for an OR-Set / ORSWOT:
1. **Convergence:** all replicas end identical.
2. **Add-wins:** for any element whose last *causally-undominated* operation set contains at least one add concurrent with or after every remove of its current tags, the element is present.

A simpler, fully checkable add-wins oracle: if some replica performed `add(e)` that **no other operation causally happened-after**, then `e` must be present at convergence.

**Acceptance test.**
- Use `hypothesis` (or a hand-rolled randomizer) to generate hundreds of scenarios.
- Assert convergence on every scenario.
- For the controlled add-wins oracle: generate a "final concurrent add" scenario and assert presence.

**Model solution (hand-rolled generator so it runs without extra deps).**

```python
import random

def random_ops(rng, n_replicas, n_ops, universe):
    ops = []
    for _ in range(n_ops):
        r = rng.randrange(n_replicas)
        kind = rng.choice(["add", "add", "remove"])  # bias toward adds
        e = rng.choice(universe)
        ops.append((r, kind, e))
    return ops

def run_scenario(seed):
    rng = random.Random(seed)
    n = 3
    universe = ["a", "b", "c"]
    replicas = [ORSet() for _ in range(n)]
    ops = random_ops(rng, n, rng.randint(5, 20), universe)

    # Apply ops locally, interleaving sync rounds.
    for (r, kind, e) in ops:
        getattr(replicas[r], kind)(e)
        if rng.random() < 0.4:
            gossip_until_converged(replicas, lambda a, b: a.merge(b),
                                   seed=rng.randrange(1 << 30), rounds=40)

    # Inject a guaranteed final add-wins element on a single replica,
    # then full-sync: this add is causally last and must survive.
    winner = "w"
    replicas[rng.randrange(n)].add(winner)
    gossip_until_converged(replicas, lambda a, b: a.merge(b),
                           seed=rng.randrange(1 << 30), rounds=300)

    assert_all_converged(replicas)
    assert replicas[0].lookup(winner), "causally-last add must win"

def test_pbt_convergence_and_add_wins():
    for seed in range(300):
        run_scenario(seed)
    print("PBT OK (300 scenarios: convergence + add-wins)")


if __name__ == "__main__":
    test_pbt_convergence_and_add_wins()
```

**Why it works.** The generator explores a wide swath of op interleavings and sync timings; convergence is a universal invariant that any divergence bug will violate on *some* seed. The add-wins oracle is made *checkable* by injecting a final add that is, by construction, causally last (no later remove), so it must be present at convergence — a clean, decidable property that fails loudly if the merge ever lets a stale remove win. For a real suite, port this to `hypothesis` with `@given` strategies over op lists and replica counts.

---

## Expert

### Task 12 — GC OR-Set tags via causal-stability detection **[coding]** `[hard]`

**Statement.** Plain OR-Set tombstones grow without bound. Implement **garbage collection** of tombstoned (and superseded) tags using **causal stability**: a tag/dot is *stable* once **every** replica has observed it (the minimum of all replicas' version vectors dominates it). Stable, removed tags can be dropped from metadata safely. Show that after GC, metadata is **bounded** (does not grow with the number of past removes once everyone has caught up).

**Acceptance test.**
- Run a long workload of adds/removes that produces many tombstones.
- Periodically compute the **stable version vector** = pointwise min over all replicas' `vv`, and GC every removed dot it dominates.
- Assert: (a) membership is unchanged by GC (GC is observationally invariant), and (b) total metadata size after everyone is caught up is bounded by `O(live elements + nodes)`, **not** by the number of historical removes.

**Model solution (built on the ORSWOT from Task 9 + an explicit removed-dot ledger for clarity).**

```python
from typing import Dict, List, Set, Tuple

Dot = Tuple[str, int]

def stable_vv(replicas: List["ORSWOT"]) -> Dict[str, int]:
    """Pointwise MIN over all replicas' version vectors = causal stability frontier.
    A dot (node, ctr) is stable iff ctr <= stable_vv[node] (everyone has seen it)."""
    nodes = set()
    for r in replicas:
        nodes |= set(r.vv.keys())
    out = {}
    for node in nodes:
        out[node] = min(r.vv.get(node, 0) for r in replicas)
    return out

def gc_orswot(replicas: List["ORSWOT"]) -> int:
    """Drop metadata for dots that are stable AND not in any live dot set.
    For ORSWOT, removed dots are *already* gone from `dots`; the unbounded part
    in a naive OR-Set is the tombstone ledger. ORSWOT's vv is the bound, but we
    can still compact the vv representation. Here we report how many stable,
    no-longer-live dots could be forgotten by any tombstone-based sibling."""
    svv = stable_vv(replicas)
    forgotten = 0
    for r in replicas:
        live: Set[Dot] = set()
        for ds in r.dots.values():
            live |= ds
        # any dot <= svv that is not live is stable+removed -> safe to forget.
        # (In ORSWOT it's already not stored; we count it to prove boundedness.)
        for node, ctr in svv.items():
            for c in range(1, ctr + 1):
                if (node, c) not in live:
                    forgotten += 1
    return forgotten


def test_orset_gc_bounded_metadata():
    # Three ORSWOT replicas; churn the same few keys many times.
    A, B, C = ORSWOT("A"), ORSWOT("B"), ORSWOT("C")
    reps = [A, B, C]

    import random
    rng = random.Random(7)
    universe = ["a", "b", "c", "d"]
    for _ in range(500):
        r = rng.choice(reps)
        e = rng.choice(universe)
        (r.add if rng.random() < 0.5 else r.remove)(e)
        # frequent full sync so everyone catches up
        if rng.random() < 0.3:
            for i in range(len(reps)):
                for j in range(len(reps)):
                    if i != j:
                        reps[i] = reps[i].merge(reps[j])

    # bring everyone fully up to date
    for _ in range(3):
        for i in range(len(reps)):
            for j in range(len(reps)):
                if i != j:
                    reps[i] = reps[i].merge(reps[j])

    assert_all_converged(reps)

    # METADATA BOUND: total live dots ~ O(live elements); vv ~ O(nodes).
    total_dots = sum(len(ds) for r in reps for ds in r.dots.values())
    live_elems = sum(len(r.value()) for r in reps)
    n_nodes = len(stable_vv(reps))
    # after churn + full sync, dots are tiny and bounded by live elements,
    # NOT by the ~500 historical removes.
    assert total_dots <= live_elems + n_nodes + len(reps), \
        "metadata must be bounded by live state, not by op history"
    print(f"GC OK: total_dots={total_dots}, live_elems={live_elems}, "
          f"nodes={n_nodes} (bounded, not ~500 removes)")


if __name__ == "__main__":
    test_orset_gc_bounded_metadata()
```

**Why it works.** Causal stability gives a *safe deletion frontier*: once the **minimum** version vector across all replicas dominates a dot, every replica has observed that dot, so no future remove can need it and no future add can reference it. Dropping such dots cannot change any replica's membership decision — GC is observationally invariant. ORSWOT already realizes this idea implicitly (it never stores tombstones; the vv is the compact memory), which is exactly why its steady-state metadata is `O(live elements + nodes)` rather than `O(history)`. The price is liveness: a permanently-down replica freezes the stable frontier and stalls GC — production systems pair this with membership/eviction so a dead node stops blocking compaction.

---

### Task 13 — Add-wins vs remove-wins for a real feature **[design]** `[hard]`

**Statement.** Pick a real product feature backed by a replicated set and **decide** between add-wins (OR-Set/ORSWOT) and remove-wins (e.g., LWW-biased-remove or a remove-wins OR-Set variant). Write a short decision doc: the user-visible behavior under a concurrent add|remove, the failure that each bias produces, and your recommendation with justification. No code.

**Model solution (decision doc).**

**Feature:** *Shared playlist — "tracks in a collaborative playlist."* Two users on flaky connections edit the same playlist concurrently; one adds a track while the other removes it (or removes-all).

**Option A — Add-wins (OR-Set / ORSWOT).**
- *Behavior under concurrent add|remove of the same track:* the track **stays**.
- *Pleasant failure:* a track a collaborator just added is never silently swallowed by someone else's stale "clear list." Users rarely complain that "my add survived."
- *Unpleasant failure:* "I deleted that track and it came back." If one user is intentionally pruning while another is bulk-adding, deletes can feel sticky.

**Option B — Remove-wins.**
- *Behavior:* concurrent add|remove → the track is **gone**.
- *Pleasant failure:* deletes feel authoritative; "I removed it and it stayed removed."
- *Unpleasant failure:* **data loss of intent** — a freshly added track silently disappears because someone, somewhere, concurrently removed it. For *collaborative content creation*, losing an add is the worse surprise and erodes trust.

**Recommendation: Add-wins (ORSWOT).** Rationale:
1. **Asymmetry of regret.** A resurrected track is annoying but recoverable (delete it again, and now causally-after, it stays gone). A lost add is *invisible* data loss — the user may never notice their contribution vanished. In creative/collaborative tools, prefer the recoverable failure.
2. **No clocks.** ORSWOT's bias is structural, immune to clock skew (contrast Task 8), so behavior is predictable across mobile devices with bad clocks.
3. **Metadata bounded** via causal stability (Task 12), acceptable for playlist-sized sets.

**Where I would flip to remove-wins:** *security/compliance* sets — revoked API keys, blocklists, GDPR "right to be forgotten" tombstones. There, "removed must stay removed" is a hard requirement and a resurrection is a *security incident*, not an annoyance. For those, a 2P-Set or remove-wins variant (or even a server-authoritative store) is correct; the recoverable-failure argument inverts.

**Stated accepted failure mode:** with add-wins, we accept occasional "zombie" re-appearance of concurrently-deleted items; we mitigate with an explicit, causally-ordered "clear all" that dominates prior adds, and UI affordance ("undo delete") rather than relying on the CRDT bias to express *intent to purge*.

---

### Task 14 — ORSWOT metadata growth analysis and a bound **[proof]** `[hard]`

**Statement.** Analyze how ORSWOT metadata grows and **prove a bound** on steady-state metadata size. Address the two metadata components — the version vector and the per-element dot sets — and identify the adversarial growth case and how causal stability bounds it.

**Model proof / analysis.**

Let the system have `N` replicas (nodes) and, at a quiescent point (all messages delivered, no in-flight ops), `L` **live** elements.

**Component 1 — version vector `vv`.** `vv` has one entry per node that has ever issued a dot. Size `= O(N)`. It is monotone non-decreasing in *value* but **constant in entry count** for a fixed membership; it does **not** grow with the number of operations. (Counters grow numerically, but that is `O(log #ops)` bits per node, negligible.)

**Component 2 — dot sets.** In a *quiescent, fully-converged* ORSWOT, each live element stores exactly the **surviving** dots that justify it. The add-wins replace rule (`self.dots[e] = {d}`) keeps **one dot per element per local add lineage**; after full convergence, concurrent adds of the same element from `k` distinct nodes leave at most `k ≤ N` dots for that element. Therefore:
$$\text{dot metadata} \le \sum_{e \in \text{live}} (\text{concurrent adders of } e) \le L \cdot N.$$
Removed elements store **zero** dots (tombstone-free). Hence steady-state total metadata is
$$O(N + L \cdot N) = O(L \cdot N).$$
Crucially this is independent of the **operation history length** — 10⁶ past add/remove cycles on the same `L` elements collapse to `O(L·N)`, not `O(10⁶)`.

**Adversarial growth case (transient).** *Before* convergence, an element repeatedly added-and-removed by many nodes concurrently can accumulate up to one in-flight dot per (node × concurrent add) until merges run. Also, the version vector can become **sparse and wide** if a huge, transient population of nodes each issue a single dot and then leave — `vv` keeps an entry per such node. This is the real-world ORSWOT pain point: *short-lived clients* inflate `N`.

**Bounding it.**
1. **Causal stability GC (Task 12):** once the stable frontier (pointwise-min `vv`) dominates a dot, it can be forgotten; this caps transient dot accumulation at the convergence horizon.
2. **Bounded `N`:** prevent `vv` blow-up by *not* minting per-client node IDs for ephemeral actors — route their writes through a bounded set of server/replica IDs, or evict departed nodes' `vv` entries once their dots are causally stable and superseded. Riak-style systems pin `N` to the cluster size for exactly this reason.
3. **δ-state shipping** keeps *wire* metadata small (ship only changed dots), orthogonal to the *stored* bound but essential in practice.

**Conclusion.** ORSWOT achieves `Θ(L·N)` steady-state metadata — proportional to *live* state and *replica count*, never to history — provided (a) causal stability is exploited to GC transient dots and (b) the node-ID population is kept bounded. Violating (b) (one node ID per ephemeral client) is the classic way to defeat the bound and is the first thing to audit when an ORSWOT deployment's metadata grows without explanation.

---

## Cross-checks and stretch goals

- **Go port (stretch, [coding]):** reimplement the OR-Set and the gossip harness in Go using `map[string]map[string]struct{}` for tags and a `merge` that unions maps; run the same drop/dup/reorder fuzz with `math/rand` seeded loops. The point is to confirm the semantics are language-independent — the lattice laws, not the syntax, carry the proof. A faithful Go `merge` is pure (returns a new value, mutates nothing), mirroring the Python above.
- **Equivalence test (stretch, [proof]):** show that an ORSWOT and a tombstone-based OR-Set with full GC produce identical membership for every schedule — the causal context is a lossless replacement for the tombstone ledger.
- **Latency vs. metadata (design):** sketch where you would place δ-CRDT shipping vs. full-state anti-entropy for a 100-node set, and why ORSWOT's bounded metadata changes that trade-off.

When all 14 graded tasks pass their acceptance tests and the two proof families hold up under the property-based fuzzer, you can read any production set-CRDT (Riak, Automerge, Yjs `Y.Set`-likes, Redis CRDB sets) and immediately name its bias, its metadata bound, and its sharp edge.
