# Set CRDTs: G-Set, 2P-Set, LWW & OR-Set — Junior Level

> **The one-sentence version.** Adding to a replicated set is trivial — merge is just a union, and union never loses data. *Removing* is where every interesting decision lives: if you add an element on one replica while I remove the same element on another, who wins when the replicas sync? This page walks through the four standard set CRDTs — **G-Set**, **2P-Set**, **LWW-Element-Set**, and **OR-Set** — and shows, with concrete worked numbers, exactly how each one answers "add vs. remove."

**Prerequisites:** You've read [CRDT Fundamentals](../01-crdt-fundamentals/junior.md) (so you know what *convergence*, *merge*, and a *join-semilattice* mean), [State vs Op CRDTs](../02-state-vs-operation-based-crdts/junior.md), and [Counters](../03-counters-g-pn/junior.md) (so you've seen G-Counter and PN-Counter and the "split positive and negative" trick — sets reuse that idea).

**Read time:** ~35 minutes. **Goal:** by the end you can pick the right set CRDT for a real feature (shopping cart, tags, friend list) and explain *why* removing is the hard part.

---

## Table of Contents

1. [Recap: the G-Set, where everything is easy](#1-recap-the-g-set-where-everything-is-easy)
2. [Why naive remove breaks: the "zombie" re-add](#2-why-naive-remove-breaks-the-zombie-re-add)
3. [The four designs](#3-the-four-designs)
   - [3.1 G-Set — add only](#31-g-set--add-only)
   - [3.2 2P-Set — add-set + tombstone-set](#32-2p-set--add-set--tombstone-set)
   - [3.3 LWW-Element-Set — let the clock decide](#33-lww-element-set--let-the-clock-decide)
   - [3.4 OR-Set — observed-remove, the practical winner](#34-or-set--observed-remove-the-practical-winner)
4. [Comparison table](#4-comparison-table)
5. [Runnable code](#5-runnable-code)
6. [Real-world uses](#6-real-world-uses)
7. [Misconceptions](#7-misconceptions)
8. [Common mistakes](#8-common-mistakes)
9. [Cheat sheet](#9-cheat-sheet)
10. [Summary](#10-summary)
11. [Further reading](#11-further-reading)

---

## 1. Recap: the G-Set, where everything is easy

A **G-Set** (Grow-only Set) is a set you can only *add* to. Each replica keeps a plain set of elements. To merge two replicas, you take the **union**.

```
merge(A, B) = A ∪ B
```

Union is the perfect CRDT merge operation because it is:

- **Commutative** — `A ∪ B = B ∪ A`. Order of merging doesn't matter.
- **Associative** — `(A ∪ B) ∪ C = A ∪ (B ∪ C)`. Grouping doesn't matter.
- **Idempotent** — `A ∪ A = A`. Merging the same thing twice is harmless.

Those three properties are exactly what make a **join-semilattice**, and that's the whole reason a G-Set converges no matter what order updates and merges arrive in. (If "join-semilattice" is fuzzy, re-skim [CRDT Fundamentals](../01-crdt-fundamentals/junior.md).)

**Tiny worked example.** Two replicas start empty. Replica A adds `apple`; replica B adds `banana`. They sync:

| Step | Replica A | Replica B |
|------|-----------|-----------|
| start | `{}` | `{}` |
| A adds apple | `{apple}` | `{}` |
| B adds banana | `{apple}` | `{banana}` |
| sync (union both ways) | `{apple, banana}` | `{apple, banana}` |

Both converge to `{apple, banana}`. No conflict is even *possible*, because there's no operation that could disagree with another — you only ever add. **This is the easy case.** The entire rest of this page is about what happens when you also want to remove.

---

## 2. Why naive remove breaks: the "zombie" re-add

Here's the obvious-but-wrong idea: "I'll just store a normal set, and remove means *delete the element from my local set*."

It seems fine on one machine. On replicated machines it produces **zombies** — elements that you deleted but that come *back from the dead* on the next sync.

**Worked example of the bug.** Two replicas, both holding `{x}`.

| Step | Replica A | Replica B | What happened |
|------|-----------|-----------|---------------|
| start | `{x}` | `{x}` | both agree |
| A removes x | `{}` | `{x}` | A deleted it locally |
| sync: merge = union | `{} ∪ {x} = {x}` | `{x} ∪ {} = {x}` | **x is back!** |

A genuinely removed `x`. But when A merges with B, the merge rule (union) sees that B *still has* `x`, so the union puts `x` back. A's removal is silently undone. From A's user's point of view, "I deleted it and it reappeared" — a **zombie**.

The root cause: **union has no way to tell the difference between "B never knew about the removal" and "B re-added it on purpose."** A bare set has no memory of *intent*. Every set CRDT below is, fundamentally, a different strategy for **recording the intent to remove** so that merge can respect it.

There are three honest strategies, and they map onto the three non-trivial CRDTs:

1. **Remember removed elements forever** (tombstones) → **2P-Set**.
2. **Attach timestamps and let the latest write win** → **LWW-Element-Set**.
3. **Tag every add with a unique id and only remove the tags you've actually seen** → **OR-Set**.

---

## 3. The four designs

For each design we'll run the *same* scenario — **a concurrent add and remove of the same element `x`** — and see who wins. That scenario is the acid test, because it's the case where union alone fails.

### 3.1 G-Set — add only

**State:** one set, `elements`.

| Operation | What it does |
|-----------|--------------|
| `add(e)` | `elements ← elements ∪ {e}` |
| `lookup(e)` | `e ∈ elements` |
| `remove(e)` | **not supported** |
| `merge(A, B)` | `elements ← A.elements ∪ B.elements` |

**Concurrent add/remove example:** there's no remove, so the "hard case" can't arise. That's the point — G-Set buys correctness by giving up removal entirely.

**Use it when** the set is genuinely append-only: a log of seen message-ids for deduplication, a set of "users who ever logged in," the union of all tags ever applied (and you don't care about un-applying). Cheap, simple, impossible to break.

---

### 3.2 2P-Set — add-set + tombstone-set

**2P-Set** ("Two-Phase Set") is the simplest design that supports removal. The trick is the same one you saw with the PN-Counter in [Counters](../03-counters-g-pn/junior.md): **don't try to subtract — keep two grow-only sets and combine them.**

**State:** two G-Sets.

- `A` — the **add-set**: every element ever added.
- `R` — the **remove-set** (the **tombstones**): every element ever removed.

```
lookup(e)  =  (e ∈ A)  and  (e ∉ R)
```

| Operation | What it does |
|-----------|--------------|
| `add(e)` | `A ← A ∪ {e}` |
| `remove(e)` | only allowed if `e ∈ A`; then `R ← R ∪ {e}` |
| `lookup(e)` | `e ∈ A and e ∉ R` |
| `merge` | `A ← A₁ ∪ A₂`, `R ← R₁ ∪ R₂` (union both sets independently) |

Because `A` and `R` are each grow-only G-Sets, the whole thing converges (a pair of semilattices is still a semilattice). And it kills the zombie: once `x ∈ R`, no amount of merging removes it from `R`, so `x` stays gone.

**Worked example — concurrent add/remove. Who wins? REMOVE wins.**

Both replicas start with `x` added: `A = {x}`, `R = {}`.

| Step | Replica A (`A` / `R`) | Replica B (`A` / `R`) |
|------|-----------------------|-----------------------|
| start | `{x}` / `{}` | `{x}` / `{}` |
| A removes x | `{x}` / `{x}` | `{x}` / `{}` |
| B re-adds x | `{x}` / `{x}` | `{x}` / `{}` (add is a no-op, x already in A) |
| sync | `A={x}`, `R={x}` | `A={x}`, `R={x}` |
| `lookup(x)` | `x∈A and x∉R` → `true and false` = **false** | **false** |

Result: `x` is **gone on both replicas**, even though B tried to re-add it. In 2P-Set, **once you tombstone an element, you can never bring it back** — the tombstone wins permanently.

**The killer limitation (worked).** Suppose a friend list. You add `bob`, later remove `bob` (he left), then he comes back and you `add(bob)` again:

| Step | `A` | `R` | `lookup(bob)` |
|------|-----|-----|---------------|
| add bob | `{bob}` | `{}` | true |
| remove bob | `{bob}` | `{bob}` | **false** |
| add bob (again!) | `{bob}` | `{bob}` | **still false** — `bob ∈ R` forever |

`bob` is in the tombstone set forever, so `add(bob)` can never make `lookup(bob)` true again. **2P-Set cannot re-add a removed element.** For a friend list, a shopping cart, or tags — anything where the same value legitimately comes and goes — this is a dealbreaker. 2P-Set also grows forever: tombstones accumulate and are never reclaimed.

> **Rule of thumb:** 2P-Set is fine only when removals are *final* — e.g. a set of "revoked certificate ids" or "permanently banned users," where re-adding the exact same value is something you'd never want anyway.

---

### 3.3 LWW-Element-Set — let the clock decide

**LWW-Element-Set** ("Last-Writer-Wins") fixes 2P-Set's re-add problem by attaching a **timestamp to every add and every remove**, instead of permanent tombstones. An element is present if its **most recent add is newer than its most recent remove**.

**State:** two maps from element → timestamp.

- `addTs[e]` — timestamp of the latest `add(e)`.
- `removeTs[e]` — timestamp of the latest `remove(e)`.

```
present(e)  =  e ∈ addTs  and  ( e ∉ removeTs  or  addTs[e] >  removeTs[e] )
```

| Operation | What it does |
|-----------|--------------|
| `add(e, t)` | `addTs[e] ← max(addTs[e], t)` |
| `remove(e, t)` | `removeTs[e] ← max(removeTs[e], t)` |
| `lookup(e)` | the `present(e)` formula above |
| `merge` | for every element, take `max` of add timestamps and `max` of remove timestamps |

Merge is element-wise `max` of timestamps — `max` is commutative, associative, and idempotent, so it converges. Taking `max` on merge means a re-add with a newer timestamp can **beat** an older remove, so unlike 2P-Set, **re-adding works**.

**The tie-break — you must define it.** What if `addTs[e] == removeTs[e]` exactly (same timestamp)? The formula above uses strict `>`, which means **on a tie, remove wins** (the `addTs[e] > removeTs[e]` part is false). You could instead make **add win on ties** by using `>=`. *Either is valid — but you must pick one and document it*, because both replicas must use the same rule or they'll disagree. We'll use **"add wins on ties"** (`addTs[e] >= removeTs[e]`) in the code below, because "if in doubt, keep the data" is the friendlier default for carts and lists.

**Worked example — concurrent add/remove. Who wins? THE BIGGER TIMESTAMP wins.**

Replica A removes `x` at time `t=5`. Concurrently, replica B adds `x` at time `t=7`. Then they sync.

| Step | A `addTs/removeTs` | B `addTs/removeTs` |
|------|--------------------|--------------------|
| start (x added @1) | `{x:1}` / `{}` | `{x:1}` / `{}` |
| A removes x @5 | `{x:1}` / `{x:5}` | `{x:1}` / `{}` |
| B adds x @7 | `{x:1}` / `{x:5}` | `{x:7}` / `{}` |
| merge (max each) | `{x:7}` / `{x:5}` | `{x:7}` / `{x:5}` |
| `present(x)` | `addTs=7 >= removeTs=5` → **true** | **true** |

`x` survives because its add (7) is newer than its remove (5). Flip the numbers — remove at 7, add at 5 — and `x` would be gone. **The clock decides.**

**Where the clock loses data (the danger, worked).** Wall-clock timestamps are not reliable across machines. Suppose replica A's clock is **skewed 10 seconds fast**. A user adds `x` on B at *real* time 12:00:05. Earlier, at *real* time 12:00:00, someone removed `x` on A — but A stamped it `12:00:10` because A's clock runs fast.

| Event (real time) | Stamped time | Replica |
|-------------------|--------------|---------|
| remove x @ 12:00:00 | **12:00:10** (A is fast) | A |
| add x @ 12:00:05 | 12:00:05 | B |
| merge → present? | removeTs `12:00:10` > addTs `12:00:05` → **x removed** | — |

The user's *later* add is silently discarded because a clock-skewed *earlier* remove carries a bigger number. **LWW always picks a winner — and silently throws the loser away.** That's acceptable for things like a "last known status" field, dangerous for "did the user mean to add this item?" To reduce (not eliminate) the risk, production systems use **logical clocks / Lamport timestamps** with a tie-break on replica id rather than raw wall-clock time — see [middle](middle.md).

---

### 3.4 OR-Set — observed-remove, the practical winner

The **OR-Set** ("Observed-Remove Set") is the design most real systems reach for. It needs no synchronized clocks and gives intuitive **"add-wins"** semantics: *a concurrent add always survives a concurrent remove.*

**The core idea.** Every time you add an element, you don't just record "x is here" — you record `(x, unique-tag)` where the **tag** is a globally-unique id (e.g. `replicaId + counter`, or a UUID). The same element can carry *many* tags if it was added multiple times. **Remove only deletes the tags it has actually observed** — never tags it has never seen.

**State:** a set of `(element, tag)` pairs. (Equivalently: a map from element → set of live tags.)

```
lookup(e)  =  there exists at least one tag t with (e, t) live
```

| Operation | What it does |
|-----------|--------------|
| `add(e)` | mint a fresh unique tag `t`; insert `(e, t)` |
| `remove(e)` | collect the tags currently observed for `e`; mark exactly *those* `(e, t)` as removed |
| `lookup(e)` | true iff at least one `(e, t)` is still live |
| `merge` | union the live pairs, then apply each side's removed-tags |

The magic is in **"only the observed tags."** When you remove `x`, you remove *the specific tags you can see right now*. If, concurrently, another replica adds `x` with a **brand-new tag**, your remove never knew about that tag, so it can't kill it. That new tag survives the merge → `x` stays present → **add wins.**

**Worked example — concurrent add/remove. Who wins? ADD wins.**

`x` was originally added on A with tag `a1`, and synced, so both replicas see `(x, a1)`.

| Step | Replica A — live tags for x | Replica B — live tags for x |
|------|------------------------------|------------------------------|
| start (synced) | `{a1}` | `{a1}` |
| A removes x | removes **observed** tag `a1` → `{}` | `{a1}` |
| B adds x (new tag `b1`) | `{}` | `{a1, b1}` |
| merge | A sees `b1` is new & not removed by A; A's remove only killed `a1` → live `{b1}` | B's view also keeps `b1`, drops `a1` (A removed it) → `{b1}` |
| `lookup(x)` | live tags `{b1}` non-empty → **true** | **true** |

`x` **survives** on both replicas. A's remove killed only the tag it had seen (`a1`); B's concurrent add minted a fresh tag (`b1`) that A's remove never observed, so it lives. This is exactly the "add wins" behavior users expect from a shopping cart: *if you removed an item but I just added it, the item stays.*

**Re-add works freely.** Unlike 2P-Set, after a remove you can `add(x)` again — it mints a new tag and `x` is present again. No permanent tombstone on the *element*; we only ever talk about specific tags.

```
remove x   →  kills tags {a1}
add x      →  mints tag a2, now live {a2}  →  lookup(x) = true ✅
```

**Cost.** OR-Set stores tags, and a basic implementation keeps removed tags around as tombstones too (so a late-arriving merge doesn't resurrect them). That metadata grows with the number of add/remove operations. Real systems use cleverer variants — **OR-Set with version vectors** (sometimes called an *optimized OR-Set* or *ORSWOT*, "OR-Set Without Tombstones") that summarize seen tags compactly and let old tombstones be garbage-collected. That's a [senior](senior.md)-level topic; for now, just know "OR-Set = add-wins, re-add-friendly, costs some metadata."

> **Why OR-Set is the default.** It needs no synchronized clocks (so no clock-skew data loss like LWW), it allows re-adding (unlike 2P-Set), and "add wins" matches what users intuitively expect. The price is bookkeeping. For most application-level replicated sets, that's a great trade.

---

## 4. Comparison table

| Property | **G-Set** | **2P-Set** | **LWW-Element-Set** | **OR-Set** |
|----------|-----------|------------|---------------------|------------|
| Supports remove? | ❌ no | ✅ yes | ✅ yes | ✅ yes |
| **Can re-add after remove?** | n/a | ❌ **never** (permanent tombstone) | ✅ yes (newer add ts wins) | ✅ yes (new tag) |
| **Concurrent add+remove winner** | n/a | **remove** wins (tombstone永) | **bigger timestamp** wins (you pick add/remove on tie) | **add** wins (always) |
| Needs synchronized clocks? | no | no | ⚠️ yes (or logical clocks) | no |
| Can it silently lose a user's write? | no | only the re-add | ⚠️ yes (clock skew) | no |
| **Metadata cost** | tiny (just elements) | grows: add-set + tombstones forever | moderate: 2 timestamps per element | higher: tags per add (+ tombstones in basic form) |
| Merge operation | union | union ×2 | element-wise `max` | union of live tags, apply removes |
| Typical use | dedup log, "ever-seen" | revoked-id list, ban list | last-known status field | cart, friends, tags, flags |

> The cell `tombstone永` is a typo for "tombstone forever" — corrected here so you don't copy it: **remove wins permanently in 2P-Set.**

A quick way to remember the three remove strategies: **2P-Set remembers removals forever, LWW dates every action and trusts the clock, OR-Set tags every add and only removes what it has seen.**

---

## 5. Runnable code

All four designs in **Python** (primary, fully runnable), plus the OR-Set in **Go** and **Java** so you can see the structure in a typed language. Each Python class supports `add` / `remove` / `lookup` / `merge`, and at the end we run a **2-replica concurrent add/remove simulation** and print each design's outcome.

### 5.1 Python — all four CRDTs + simulation

```python
"""Set CRDTs: G-Set, 2P-Set, LWW-Element-Set, OR-Set.
Runnable as-is:  python3 set_crdts.py
"""
from __future__ import annotations
import itertools


# --------------------------------------------------------------------------
# 1) G-Set: grow-only. Merge = union. No remove.
# --------------------------------------------------------------------------
class GSet:
    def __init__(self):
        self.elements: set = set()

    def add(self, e):
        self.elements.add(e)

    def lookup(self, e) -> bool:
        return e in self.elements

    def merge(self, other: "GSet") -> "GSet":
        out = GSet()
        out.elements = self.elements | other.elements   # union
        return out

    def values(self):
        return set(self.elements)


# --------------------------------------------------------------------------
# 2) 2P-Set: add-set A + tombstone-set R. present iff in A and not in R.
#    Remove is PERMANENT (cannot re-add).
# --------------------------------------------------------------------------
class TwoPhaseSet:
    def __init__(self):
        self.A: set = set()   # added
        self.R: set = set()   # removed (tombstones)

    def add(self, e):
        self.A.add(e)

    def remove(self, e):
        if e in self.A:        # convention: can only remove what was added
            self.R.add(e)

    def lookup(self, e) -> bool:
        return e in self.A and e not in self.R

    def merge(self, other: "TwoPhaseSet") -> "TwoPhaseSet":
        out = TwoPhaseSet()
        out.A = self.A | other.A
        out.R = self.R | other.R
        return out

    def values(self):
        return {e for e in self.A if e not in self.R}


# --------------------------------------------------------------------------
# 3) LWW-Element-Set: addTs / removeTs maps. present iff add ts >= remove ts.
#    Tie-break here: ADD WINS on equal timestamps (we use >=).
# --------------------------------------------------------------------------
class LWWSet:
    def __init__(self):
        self.addTs: dict = {}     # element -> latest add timestamp
        self.removeTs: dict = {}  # element -> latest remove timestamp

    def add(self, e, t):
        self.addTs[e] = max(self.addTs.get(e, t), t)

    def remove(self, e, t):
        self.removeTs[e] = max(self.removeTs.get(e, t), t)

    def lookup(self, e) -> bool:
        if e not in self.addTs:
            return False
        if e not in self.removeTs:
            return True
        return self.addTs[e] >= self.removeTs[e]   # ADD wins on tie

    def merge(self, other: "LWWSet") -> "LWWSet":
        out = LWWSet()
        for e in set(self.addTs) | set(other.addTs):
            out.addTs[e] = max(self.addTs.get(e, float("-inf")),
                               other.addTs.get(e, float("-inf")))
        for e in set(self.removeTs) | set(other.removeTs):
            out.removeTs[e] = max(self.removeTs.get(e, float("-inf")),
                                  other.removeTs.get(e, float("-inf")))
        return out

    def values(self):
        return {e for e in self.addTs if self.lookup(e)}


# --------------------------------------------------------------------------
# 4) OR-Set: tag every add with a unique id. Remove only kills OBSERVED tags.
#    Concurrent add (new tag) survives  =>  ADD WINS, and re-add works.
# --------------------------------------------------------------------------
class ORSet:
    def __init__(self, replica_id: str):
        self.replica_id = replica_id
        self._counter = itertools.count()       # local unique-tag source
        # live[e] = set of tags currently present for e
        self.live: dict[object, set] = {}
        # removed = set of (element, tag) pairs we've seen removed (tombstones)
        self.removed: set = set()

    def _new_tag(self):
        return (self.replica_id, next(self._counter))

    def add(self, e):
        tag = self._new_tag()
        self.live.setdefault(e, set()).add(tag)

    def remove(self, e):
        # remove ONLY the tags we currently observe for e
        for tag in list(self.live.get(e, ())):
            self.removed.add((e, tag))
            self.live[e].discard(tag)
        if e in self.live and not self.live[e]:
            del self.live[e]

    def lookup(self, e) -> bool:
        return e in self.live and len(self.live[e]) > 0

    def merge(self, other: "ORSet") -> "ORSet":
        out = ORSet(self.replica_id)
        out.removed = self.removed | other.removed
        # union all live tags from both sides, then drop any tag that
        # either side has tombstoned.
        for src in (self.live, other.live):
            for e, tags in src.items():
                for tag in tags:
                    if (e, tag) not in out.removed:
                        out.live.setdefault(e, set()).add(tag)
        # clean up empties
        out.live = {e: t for e, t in out.live.items() if t}
        return out

    def values(self):
        return set(self.live.keys())


# --------------------------------------------------------------------------
# Simulation: two replicas. x is present on both. Then CONCURRENTLY:
#   replica A removes x   |   replica B adds x   →   merge →  who wins?
# --------------------------------------------------------------------------
def banner(title):
    print("\n" + title)
    print("-" * len(title))


def sim_gset():
    banner("G-Set (no remove possible)")
    a, b = GSet(), GSet()
    a.add("x"); b.add("x")
    merged = a.merge(b)
    print(f"  lookup(x) = {merged.lookup('x')}   # always present; can't remove")


def sim_2pset():
    banner("2P-Set (remove is permanent)")
    a, b = TwoPhaseSet(), TwoPhaseSet()
    a.add("x"); b.add("x")
    a = a.merge(b); b = a.merge(b)     # both know x
    a.remove("x")                      # A removes
    b.add("x")                         # B "re-adds" (no-op, x already in A)
    merged = a.merge(b)
    print(f"  lookup(x) = {merged.lookup('x')}   # REMOVE wins; re-add impossible")


def sim_lww():
    banner("LWW-Element-Set (bigger timestamp wins)")
    a, b = LWWSet(), LWWSet()
    a.add("x", 1); b.add("x", 1)       # added @1 on both
    a.remove("x", 5)                   # A removes @5
    b.add("x", 7)                      # B adds @7  (newer!)
    merged = a.merge(b)
    print(f"  lookup(x) = {merged.lookup('x')}   # ADD wins: addTs 7 >= removeTs 5")
    # Now flip it: remove is newer
    a2, b2 = LWWSet(), LWWSet()
    a2.add("x", 1); b2.add("x", 1)
    a2.remove("x", 9)                  # A removes @9 (newer)
    b2.add("x", 4)                     # B adds @4
    merged2 = a2.merge(b2)
    print(f"  lookup(x) = {merged2.lookup('x')}   # REMOVE wins: removeTs 9 > addTs 4")


def sim_orset():
    banner("OR-Set (add always wins on concurrent add/remove)")
    a, b = ORSet("A"), ORSet("B")
    a.add("x")                         # A adds x with tag (A,0)
    a = a.merge(b); b = b.merge(a)     # sync so both observe (A,0)
    a.remove("x")                      # A removes the tag it observed: (A,0)
    b.add("x")                         # B concurrently adds x with NEW tag (B,0)
    merged = a.merge(b)
    print(f"  lookup(x) = {merged.lookup('x')}   # ADD wins: new tag (B,0) survives")
    # And re-add after remove works:
    merged.remove("x")
    print(f"  after remove        lookup(x) = {merged.lookup('x')}")
    merged.add("x")
    print(f"  after re-add        lookup(x) = {merged.lookup('x')}   # re-add OK")


if __name__ == "__main__":
    sim_gset()
    sim_2pset()
    sim_lww()
    sim_orset()
```

**Expected output:**

```
G-Set (no remove possible)
--------------------------
  lookup(x) = True   # always present; can't remove

2P-Set (remove is permanent)
----------------------------
  lookup(x) = False   # REMOVE wins; re-add impossible

LWW-Element-Set (bigger timestamp wins)
---------------------------------------
  lookup(x) = True   # ADD wins: addTs 7 >= removeTs 5
  lookup(x) = False   # REMOVE wins: removeTs 9 > addTs 4

OR-Set (add always wins on concurrent add/remove)
-------------------------------------------------
  lookup(x) = True   # ADD wins: new tag (B,0) survives
  after remove        lookup(x) = False
  after re-add        lookup(x) = True   # re-add OK
```

Read those four results side by side — they *are* the whole lesson: **2P-Set → remove wins, LWW → clock wins, OR-Set → add wins.**

### 5.2 Go — OR-Set sketch

```go
package main

import "fmt"

type tag struct {
	replica string
	seq     int
}

type ORSet struct {
	replica string
	seq     int
	live    map[string]map[tag]bool // element -> set of live tags
	removed map[string]map[tag]bool // tombstoned (element,tag) pairs
}

func NewORSet(replica string) *ORSet {
	return &ORSet{replica: replica,
		live:    map[string]map[tag]bool{},
		removed: map[string]map[tag]bool{}}
}

func (s *ORSet) Add(e string) {
	t := tag{s.replica, s.seq}
	s.seq++
	if s.live[e] == nil {
		s.live[e] = map[tag]bool{}
	}
	s.live[e][t] = true
}

func (s *ORSet) Remove(e string) {
	for t := range s.live[e] { // only tags we observe
		if s.removed[e] == nil {
			s.removed[e] = map[tag]bool{}
		}
		s.removed[e][t] = true
		delete(s.live[e], t)
	}
}

func (s *ORSet) Lookup(e string) bool {
	return len(s.live[e]) > 0
}

func (s *ORSet) Merge(o *ORSet) {
	for e, tags := range o.removed { // union tombstones
		if s.removed[e] == nil {
			s.removed[e] = map[tag]bool{}
		}
		for t := range tags {
			s.removed[e][t] = true
			delete(s.live[e], t)
		}
	}
	for e, tags := range o.live { // union live tags not tombstoned
		for t := range tags {
			if s.removed[e][t] {
				continue
			}
			if s.live[e] == nil {
				s.live[e] = map[tag]bool{}
			}
			s.live[e][t] = true
		}
	}
}

func main() {
	a, b := NewORSet("A"), NewORSet("B")
	a.Add("x")
	b.Merge(a) // b observes (A,0)
	a.Remove("x")
	b.Add("x") // concurrent add, new tag (B,0)
	a.Merge(b)
	fmt.Println("lookup(x) =", a.Lookup("x")) // true: add wins
}
```

### 5.3 Java — OR-Set sketch

```java
import java.util.*;

public class ORSet {
    record Tag(String replica, int seq) {}

    private final String replica;
    private int seq = 0;
    private final Map<String, Set<Tag>> live = new HashMap<>();
    private final Map<String, Set<Tag>> removed = new HashMap<>();

    public ORSet(String replica) { this.replica = replica; }

    public void add(String e) {
        live.computeIfAbsent(e, k -> new HashSet<>()).add(new Tag(replica, seq++));
    }

    public void remove(String e) {                 // remove only observed tags
        Set<Tag> tags = live.getOrDefault(e, Set.of());
        removed.computeIfAbsent(e, k -> new HashSet<>()).addAll(tags);
        live.remove(e);
    }

    public boolean lookup(String e) {
        return live.containsKey(e) && !live.get(e).isEmpty();
    }

    public void merge(ORSet o) {
        o.removed.forEach((e, tags) -> {
            removed.computeIfAbsent(e, k -> new HashSet<>()).addAll(tags);
            if (live.containsKey(e)) live.get(e).removeAll(tags);
        });
        o.live.forEach((e, tags) -> {
            for (Tag t : tags) {
                if (removed.getOrDefault(e, Set.of()).contains(t)) continue;
                live.computeIfAbsent(e, k -> new HashSet<>()).add(t);
            }
        });
    }

    public static void main(String[] args) {
        ORSet a = new ORSet("A"), b = new ORSet("B");
        a.add("x");
        b.merge(a);            // b observes (A,0)
        a.remove("x");
        b.add("x");            // concurrent add -> new tag (B,0)
        a.merge(b);
        System.out.println("lookup(x) = " + a.lookup("x")); // true: add wins
    }
}
```

---

## 6. Real-world uses

These designs are not academic toys — they ship in production databases and apps. Pick by *what should happen on a concurrent add/remove.*

- **Shopping cart (OR-Set).** A user edits their cart on phone and laptop offline; both sync later. With OR-Set, if one device adds "milk" while the other removes "milk," **the add survives** — losing an intended *add* annoys customers far more than keeping an item they can delete again. Amazon's Dynamo paper famously discusses this exact "add to cart wins" intuition. (Naive last-write-wins once made deleted items reappear — the classic cart bug.)

- **Friend / follower lists (OR-Set).** You unfriend someone while they (concurrently) re-appear via a "follow back." OR-Set lets the same person be removed and re-added freely; 2P-Set could never re-add them.

- **Tags / labels on a document (OR-Set).** Two editors tag and untag concurrently; add-wins keeps a label that anyone reapplied. Re-adding a previously removed tag must work — rules out 2P-Set.

- **Feature-flag membership / "users in experiment B" (depends).** If membership is append-only ("ever enrolled"), a **G-Set** is enough. If flags toggle on and off and you want the latest toggle to win, **LWW-Element-Set** keyed by a logical clock is a clean fit — the value is a single state and "latest decision wins" is exactly what you want.

- **Revoked-token / ban lists (2P-Set).** Removal here means "permanently revoked," and you never legitimately re-add the same id. 2P-Set's permanence is a *feature*, not a bug.

The next page up, [Sequence/Text CRDTs](../05-sequences-and-text-crdts/junior.md), tackles a harder structure — *ordered* collaborative text — where you can't just union, because position matters.

---

## 7. Misconceptions

- **"Merging sets is union, so removal is just as easy."** No — union is *why* removal is hard. Union always re-adds, so removal needs extra state (tombstones, timestamps, or tags) to survive a merge. (See §2.)

- **"LWW-Element-Set never loses data because it always picks a winner."** It *always picks a winner precisely by discarding the loser.* On clock skew, the discarded write can be the one the user actually intended. "Always converges" ≠ "never loses an update."

- **"OR-Set is just 2P-Set with extra steps."** No. 2P-Set tombstones the *element* permanently; OR-Set tombstones individual *tags*. That difference is exactly what lets OR-Set re-add and makes "add win" over a concurrent remove.

- **"Tombstones are free."** They are stored forever in the basic 2P-Set and OR-Set, so the set's memory grows with operation count even if the visible set is small. Garbage-collecting tombstones safely is a real, non-trivial problem (version vectors / ORSWOT — see [senior](senior.md)).

- **"OR-Set removal is non-deterministic / random."** It's fully deterministic: it removes *exactly the tags observed at the moment of the remove*. The only thing that "survives" is a tag the remove never saw — and that's by design.

---

## 8. Common mistakes

- **Using a plain replicated set and calling delete.** This is the zombie bug from §2. Always use one of the four CRDTs above for a *replicated* set.

- **Picking 2P-Set for data that legitimately comes and goes** (carts, friends, tags). You'll discover too late that removed values can never be re-added. Use OR-Set.

- **Using wall-clock time for LWW across machines.** Clock skew silently drops writes. Prefer a **Lamport/logical clock** with a deterministic tie-break (e.g. on replica id) so that ties are resolved the *same way everywhere* and "newer" is causally meaningful, not just whichever server's clock ran fast.

- **Forgetting to define the LWW tie-break.** If two replicas resolve `addTs == removeTs` differently (one uses `>`, the other `>=`), they *diverge* — the cardinal sin for a CRDT. Pick one rule and bake it into every replica.

- **Minting non-unique OR-Set tags.** Tags must be globally unique (e.g. `replicaId + monotonic counter`, or UUIDs). Two replicas that mint the same tag for different adds will incorrectly cancel each other on remove.

- **Merging only one of the two sets in 2P-Set / LWW.** You must union/`max` **both** the add side and the remove side. Merging only the add-set resurrects removed elements.

---

## 9. Cheat sheet

| Question | Answer |
|----------|--------|
| Why is add easy? | Merge = union, and union is commutative/associative/idempotent (a semilattice). |
| Why is remove hard? | Union re-adds anything still present elsewhere → "zombie." You need extra state to record removal *intent*. |
| Need add only? | **G-Set** — set + union. |
| Removals are permanent, never re-added? | **2P-Set** — add-set `A` + tombstone-set `R`; present iff `e∈A and e∉R`. |
| Have trustworthy logical clocks, want "latest decision wins"? | **LWW-Element-Set** — `present(e) = addTs ≥/> removeTs`; **define the tie-break.** |
| Want intuitive "add wins" + free re-add, no clocks? | **OR-Set** — tag each add uniquely; remove only observed tags. **The default.** |
| Concurrent add+remove: who wins? | 2P-Set → remove. LWW → bigger timestamp. OR-Set → **add**. |
| Main cost? | 2P-Set & OR-Set: tombstones grow. LWW: needs reliable clocks. |
| Production garbage-collection trick? | OR-Set with version vectors (ORSWOT) — drops tombstones safely. |

**Mental model:** *Adding is union (free). Removing is bookkeeping — and the bookkeeping you choose IS the conflict-resolution policy.*

---

## 10. Summary

- A **G-Set** is a grow-only set whose merge is **union** — the easy, always-correct case, but it can't remove.
- **Naive removal breaks** because union re-adds any element a peer still holds (the zombie). Every real set CRDT records *removal intent* in extra state.
- **2P-Set** keeps an add-set and a permanent tombstone-set: simple, but **removal is forever — you can never re-add.** Good only for "revoked/banned" data.
- **LWW-Element-Set** timestamps adds and removes; the **latest timestamp wins** (you must define the tie-break). It re-adds fine but **silently loses writes under clock skew**, so use logical clocks.
- **OR-Set** tags every add uniquely and removes only *observed* tags, giving **"add wins"** on concurrent add/remove and **free re-adding**, at the cost of metadata. It's the **practical default** for application-level replicated sets.
- Choose by asking: *on a concurrent add and remove of the same element, what should the user see?* That single question selects your CRDT.

Next: go deeper on logical clocks, version vectors, and tombstone garbage collection in [middle](middle.md) and [senior](senior.md); or move to ordered data in [Sequence/Text CRDTs](../05-sequences-and-text-crdts/junior.md).

---

## 11. Further reading

- Shapiro, Preguiça, Baquero, Zawirski — *A Comprehensive Study of Convergent and Commutative Replicated Data Types* (2011). The canonical catalogue; defines G-Set, 2P-Set, LWW-Element-Set, and OR-Set with proofs.
- Shapiro et al. — *Conflict-Free Replicated Data Types* (2011, SSS). The shorter companion paper.
- DeCandia et al. — *Dynamo: Amazon's Highly Available Key-Value Store* (2007). Origin of the "shopping cart add-wins" intuition.
- Riley/Brown et al. — *ORSWOT / Optimized OR-Sets* (Riak DT). How real systems drop tombstones with version vectors.
- [CRDT Fundamentals](../01-crdt-fundamentals/junior.md) · [State vs Op CRDTs](../02-state-vs-operation-based-crdts/junior.md) · [Counters](../03-counters-g-pn/junior.md) · [middle](middle.md) · [senior](senior.md) · [Sequence/Text CRDTs](../05-sequences-and-text-crdts/junior.md)
- crdt.tech — a curated, beginner-friendly index of CRDT papers, talks, and libraries.
