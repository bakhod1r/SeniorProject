# Distributed Counters: G-Counter & PN-Counter — Junior Level

> **The question this page answers:** How do you count likes (or views, or ad impressions) across many servers — where each server keeps accepting clicks even when it's temporarily cut off from the others — so that once everyone syncs back up, the total is *exactly right*, with no locks and no lost increments?

If you have read the [CRDT Fundamentals](../01-crdt-fundamentals/junior.md) page, you already know the three magic words: **replicas**, **merge**, and **convergence**. A counter is the simplest possible CRDT, and it is the perfect place to *feel* why those ideas work. By the end of this page you will be able to build a like-counter that survives network partitions, server crashes, duplicate messages, and out-of-order delivery — and still gives you the correct total down to the last like.

---

## Table of Contents

1. [The problem: a like-counter that loses likes](#1-the-problem-a-like-counter-that-loses-likes)
2. [The key idea: one slot per replica](#2-the-key-idea-one-slot-per-replica)
3. [G-Counter: a full worked example](#3-g-counter-a-full-worked-example)
4. [Why "max per slot" is the right merge](#4-why-max-per-slot-is-the-right-merge)
5. [PN-Counter: supporting decrements](#5-pn-counter-supporting-decrements)
6. [Runnable code](#6-runnable-code)
7. [Where this is used in the real world](#7-where-this-is-used-in-the-real-world)
8. [Misconceptions](#8-misconceptions)
9. [Common mistakes](#9-common-mistakes)
10. [Cheat sheet](#10-cheat-sheet)
11. [Summary](#11-summary)
12. [Further reading](#12-further-reading)

---

## 1. The problem: a like-counter that loses likes

Imagine you run a social app. A post can be liked by millions of people, and your traffic is spread across **three servers** behind a load balancer: `A`, `B`, and `C`. Each server independently receives "like" requests for the same post.

The obvious design — the one almost everyone tries first — is a **single shared integer**:

> "Each server reads the current count, adds the new likes, and writes the count back. When two servers update at once, whoever writes last wins."

This is "last-write-wins on a shared integer." It is wrong, and the failure is not subtle. Let's watch it lose data.

### 1.1 A worked example of the loss

Start with the post at **0 likes**. The shared value lives in some central store (or is replicated and reconciled by last-write-wins). Then:

- Server `A` receives **5** likes.
- Server `B` receives **3** likes.

These two bursts happen at roughly the same time. Each server does the classic *read–modify–write*:

| Step | Who | Reads count | Adds | Wants to write |
|------|-----|-------------|------|----------------|
| 1 | `A` | 0 | +5 | 5 |
| 2 | `B` | 0 | +3 | 3 |
| 3 | `A` | — | — | **writes 5** |
| 4 | `B` | — | — | **writes 3** |

Both `A` and `B` read `0` *before* either of them wrote. So `A` computes `0 + 5 = 5`, and `B` computes `0 + 3 = 3`. Now they both write. Because the rule is "last write wins," and `B` happened to write last, the final stored value is:

```
final count = 3
```

We received **8** likes. We stored **3**. We silently destroyed five likes. Nobody got an error. The counter just... lied.

This is a textbook **lost update**. The deeper reason is that *integers are not safe to merge by overwriting*. The value `5` carries no memory of "I am 0 plus A's five." The value `3` carries no memory of "I am 0 plus B's three." When you overwrite one with the other, the information about who contributed what is gone forever.

### 1.2 "Just use a lock!" — and why we don't want to

You might say: *put a lock around read–modify–write*. Then `A` finishes (count = 5), `B` reads 5, adds 3, writes 8. Correct!

But a lock means **every like must talk to one coordinator**, in order, one at a time. That gives us three problems:

1. **It doesn't scale.** A globally hot post (a celebrity's photo) funnels every like through a single lock. That lock becomes the bottleneck and the whole point of having three servers evaporates.
2. **It dies during partitions.** If server `C` is briefly cut off from the lock service (a network partition — see the [CRDT Fundamentals](../01-crdt-fundamentals/junior.md) discussion of partitions), it can either *block* (refuse likes — bad UX) or *cheat* (skip the lock — lost updates again). There is no good answer.
3. **It's slow.** A round-trip to a coordinator on every single like adds latency to something that should be instant.

What we actually want is for **each server to accept likes locally, immediately, even fully offline**, and then have the servers reconcile *whenever they happen to talk*, with a guarantee that the reconciliation is always correct. No locks. No coordinator. No lost likes.

That is exactly what a **G-Counter** delivers.

---

## 2. The key idea: one slot per replica

Here is the entire trick, and it is small enough to fit in one sentence:

> **Give every replica its own private slot. A replica only ever increments its own slot. The counter's value is the sum of all slots. To merge two replicas, take the element-wise maximum of each slot.**

Let's unpack each clause, because every word is doing work.

### 2.1 "Each replica has its own slot"

Instead of one shared integer, the counter is a small **map** (a dictionary) from replica-id to a count:

```
counter = { "A": 0, "B": 0, "C": 0 }
```

The value of the counter is the sum of the map's values:

```
value = 0 + 0 + 0 = 0
```

### 2.2 "A replica only ever increments its own slot"

When server `A` receives 5 likes, it changes **only** `counter["A"]`:

```
A's state = { "A": 5, "B": 0, "C": 0 }   ->  value = 5
```

Server `B` receives 3 likes and changes **only** `counter["B"]`:

```
B's state = { "A": 0, "B": 3, "C": 0 }   ->  value = 3
```

Notice that `A` never touches `B`'s slot, and `B` never touches `A`'s slot. Each slot has exactly one **owner** that is allowed to grow it. Because of that ownership rule, **every individual slot is grow-only and monotonic** — it never goes down, and only its owner changes it. That single property is what makes the merge safe.

### 2.3 "Merge = element-wise max"

When `A` and `B` finally talk to each other, they merge by taking the larger value in each slot:

```
A's state:    { "A": 5, "B": 0, "C": 0 }
B's state:    { "A": 0, "B": 3, "C": 0 }
            -----------------------------------
merged:       { "A": max(5,0)=5, "B": max(0,3)=3, "C": max(0,0)=0 }
            = { "A": 5, "B": 3, "C": 0 }
            -> value = 5 + 3 + 0 = 8   ✅
```

There it is. **8 likes preserved.** No lock, no coordinator — just "keep your own slot, sum all slots, merge by max."

The "G" in **G-Counter** stands for **Grow-only**: the value can only ever go up. We'll handle decrements (unlikes) in [section 5](#5-pn-counter-supporting-decrements). For now, hold this picture:

```
        +---------+        +---------+        +---------+
        |  A: 5   |        |  A: 0   |        |  A: 0   |
        |  B: 0   |        |  B: 3   |        |  B: 0   |
        |  C: 0   |        |  C: 0   |        |  C: 0   |
        +---------+        +---------+        +---------+
         replica A          replica B          replica C

   value of A = 5      value of B = 3      value of C = 0
   merge all three  ->  { A:5, B:3, C:0 }  ->  total = 8
```

---

## 3. G-Counter: a full worked example

Let's run a complete scenario across all three replicas, including a **network partition**, **concurrent increments**, and a sync that arrives **out of order and duplicated** — to prove the merge handles every case.

### 3.1 The setup

Three replicas, all starting at zero:

```
A = { A:0, B:0, C:0 }
B = { A:0, B:0, C:0 }
C = { A:0, B:0, C:0 }
```

Now the network splits: `A` and `B` can talk to each other, but `C` is **partitioned** (offline, on its own). Likes keep pouring in to all three servers.

### 3.2 Increments happen everywhere, concurrently

While partitioned, each server accepts likes and bumps **only its own slot**:

| Event | Replica | Action | New local state |
|-------|---------|--------|-----------------|
| e1 | `A` | +4 likes | `{ A:4, B:0, C:0 }` |
| e2 | `B` | +2 likes | `{ A:0, B:2, C:0 }` |
| e3 | `C` | +7 likes | `{ A:0, B:0, C:7 }` |
| e4 | `A` | +1 like | `{ A:5, B:0, C:0 }` |

So far each replica only knows about its own likes:

```
A = { A:5, B:0, C:0 }   ->  A thinks total = 5
B = { A:0, B:2, C:0 }   ->  B thinks total = 2
C = { A:0, B:0, C:7 }   ->  C thinks total = 7
```

The *true* total of likes that the system has received is `5 + 2 + 7 = 14`. No single replica knows this yet — and that's fine. The whole promise of a CRDT is that they don't *need* to know it instantly; they only need to converge to it once they sync.

### 3.3 A and B sync (they're on the same side of the partition)

`A` sends its state to `B`. `B` merges (element-wise max):

```
B before:   { A:0, B:2, C:0 }
A's state:  { A:5, B:0, C:0 }
          -----------------------------------------
B after:    { A:max(0,5)=5, B:max(2,0)=2, C:max(0,0)=0 }
          = { A:5, B:2, C:0 }   ->  B thinks total = 7
```

Now `B` sends its merged state back to `A`:

```
A before:   { A:5, B:0, C:0 }
B's state:  { A:5, B:2, C:0 }
          -----------------------------------------
A after:    { A:5, B:2, C:0 }   ->  A thinks total = 7
```

Good. `A` and `B` now agree: `{ A:5, B:2, C:0 }`, total `7`. They have correctly combined their two contributions. `C`'s 7 likes are still missing only because `C` is still partitioned — not because of any error.

### 3.4 The partition heals; C syncs in

The network recovers. `C` now sends its state to `A`:

```
A before:   { A:5, B:2, C:0 }
C's state:  { A:0, B:0, C:7 }
          -----------------------------------------
A after:    { A:max(5,0)=5, B:max(2,0)=2, C:max(0,7)=7 }
          = { A:5, B:2, C:7 }   ->  total = 14   ✅
```

And `A` propagates the full state to `B` and `C`. Everyone ends at:

```
A = B = C = { A:5, B:2, C:7 }   ->  total = 5 + 2 + 7 = 14   ✅
```

**Every like is accounted for.** No coordinator was ever involved. Each replica accepted likes the entire time, even while partitioned.

### 3.5 The part that scares people: duplicated and reordered syncs

In a real network, sync messages get **retried** (so you see the same message twice) and **reordered** (a later message arrives before an earlier one). Let's prove this doesn't matter.

Suppose `C`'s old, stale state from *before* it learned anything — `{ A:0, B:0, C:7 }` — arrives at `A` **again**, late, *after* `A` already reached `{ A:5, B:2, C:7 }` (a duplicate delivery):

```
A current:     { A:5, B:2, C:7 }
stale C dup:   { A:0, B:0, C:7 }
             -----------------------------------------
A after:       { A:max(5,0)=5, B:max(2,0)=2, C:max(7,7)=7 }
             = { A:5, B:2, C:7 }   ->  unchanged   ✅
```

Nothing changed. Re-applying a message that `A` has already "seen" (or one that contains no new information) is a **no-op**. This property is called **idempotence**: applying the same merge twice gives the same result as applying it once. The max function gives us this for free, because `max(x, x) = x` and `max(x, y)` never depends on *how many times* you've applied it or *in what order*.

Let's also confirm **order doesn't matter** (commutativity + associativity). Merge `A`, `B`, `C` in two different orders:

```
Order 1:  merge(merge(A, B), C)
  merge(A,B) = { A:5, B:2, C:0 }
  merge(that, C) = { A:5, B:2, C:7 }   total 14

Order 2:  merge(A, merge(C, B))
  merge(C,B) = { A:0, B:2, C:7 }
  merge(A, that) = { A:5, B:2, C:7 }   total 14
```

Same answer. **This is the heart of CRDT convergence:** because merge is *commutative* (order-independent), *associative* (grouping-independent), and *idempotent* (duplicate-safe), it does not matter how messages are delayed, reordered, retried, or duplicated. As long as every replica eventually hears every other replica's latest state, **everyone lands on the same value** — and that value is exactly correct.

---

## 4. Why "max per slot" is the right merge

It's worth pausing to understand *why* `max` is the correct way to combine slots, because it's tempting to reach for `+` instead (and that's a classic bug — see [misconceptions](#8-misconceptions)).

The reasoning has two layers.

### 4.1 Each slot is a grow-only number with one owner

Slot `A` is **only ever incremented by replica `A`**. So at any moment, `A`'s own copy of slot `A` holds the *true, latest* value of how many likes `A` has accepted. Any *other* replica's copy of slot `A` is either equal to that (if it has fully synced) or **smaller** (if it's stale and hasn't heard `A`'s latest yet). It can never be larger — nobody but `A` can grow that slot.

So when two replicas compare their copies of slot `A`, the **bigger one is the more up-to-date one**. Taking `max` means "trust the more recent value." That's exactly what you want.

### 4.2 Max is the "join" — it's safe to repeat

Because the more-recent value is always the larger one, `max` over a slot never *loses* information and never *invents* information:

- If both replicas agree on a slot, `max` keeps that value (no change).
- If one is ahead, `max` adopts the ahead value (catches up).
- If you apply it twice, nothing extra happens (`max(x,x) = x`).

In CRDT vocabulary, `max` is the **join** (least upper bound) of the slot values, and the slot values form a structure where "more likes" means "further along." Merging by join is what makes a *state-based CRDT* converge. If you want the deeper theory of why join-merge guarantees convergence, that's covered in [State vs Op CRDTs](../02-state-vs-operation-based-crdts/junior.md) and explored further in the [middle](middle.md) tier. For now, the intuition is enough: **per-slot, the bigger number is the newer truth, and `max` always picks the newer truth.**

### 4.3 Why not max the *total* instead of per-slot?

A natural wrong turn: "Why keep a whole map? Just keep a single number per replica and merge by `max(total_A, total_B)`."

Watch it fail. `A` has 5 likes, `B` has 3 likes:

```
total_A = 5,  total_B = 3
max(5, 3) = 5     ->   we'd report 5, losing B's 3 likes ❌
```

`max` on the *combined total* throws away the breakdown of who contributed what — the exact information we worked so hard to keep. **`max` is only safe when applied per-slot**, because only a per-slot value has a single owner that grows it monotonically. The *sum* across slots is what gives the final count; the *max* within each slot is what reconciles. Keep those two operations straight and you've understood the whole data structure.

---

## 5. PN-Counter: supporting decrements

A G-Counter can only go **up**. But sometimes you need to go down: a user **unlikes** a post, an item is **removed** from a cart, inventory is **shipped**. Can we just subtract from a slot?

**No** — and it's important to see why. The entire correctness argument in [section 4](#4-why-max-per-slot-is-the-right-merge) rests on each slot being **grow-only**: the bigger value is always the newer one. The moment a slot can go *down*, `max` breaks. Picture replica `A` at `slot=5`, then it decrements to `slot=4`. A stale copy still holding `5` syncs in, and `max(4, 5) = 5` — the decrement is silently erased. Grow-only and `max` are a package deal; you can't keep one without the other.

### 5.1 The fix: two grow-only counters

The trick is elegantly simple. Keep **two** G-Counters:

- **P** ("plus") counts all the **increments**.
- **N** ("negative") counts all the **decrements**.

Both `P` and `N` are ordinary grow-only G-Counters — they only ever go up. The reported value is just:

```
value = sum(P) - sum(N)
```

To **increment**, you bump your own slot in `P`. To **decrement**, you bump your own slot in `N`. Neither sub-counter ever decreases, so each one keeps the grow-only property, and we merge each one with the same per-slot `max` we already trust. This is the **PN-Counter** (Positive-Negative counter).

```
PN-Counter on replica A:
    P = { A: ?, B: ?, C: ? }   (increments, grow-only)
    N = { A: ?, B: ?, C: ? }   (decrements, grow-only)
    value = sum(P) - sum(N)
```

### 5.2 A full worked example with a decrement

Three replicas, all starting empty (`P` and `N` all zeros). Let's track likes *and* unlikes for one post.

| Event | Replica | Action | P after | N after |
|-------|---------|--------|---------|---------|
| e1 | `A` | +3 likes | `{A:3,B:0,C:0}` | `{A:0,B:0,C:0}` |
| e2 | `B` | +2 likes | `{A:0,B:2,C:0}` | `{A:0,B:0,C:0}` |
| e3 | `A` | −1 unlike | `{A:3,B:0,C:0}` | `{A:1,B:0,C:0}` |
| e4 | `C` | +4 likes | `{A:0,B:0,C:4}` | `{A:0,B:0,C:0}` |
| e5 | `C` | −2 unlikes | `{A:0,B:0,C:4}` | `{A:0,B:0,C:2}` |

Each replica only knows its own events so far. Their local values:

```
A: value = sum(P=3) - sum(N=1) = 2
B: value = sum(P=2) - sum(N=0) = 2
C: value = sum(P=4) - sum(N=2) = 2
```

The *true* result we expect after everyone syncs:

```
total increments = 3 + 2 + 4 = 9
total decrements = 1 + 0 + 2 = 3
true value       = 9 - 3 = 6
```

Now everyone syncs (in any order — it doesn't matter). We merge `P` by per-slot max and `N` by per-slot max, **independently**:

```
Merged P = { A:max(3,0,0)=3, B:max(0,2,0)=2, C:max(0,0,4)=4 } = { A:3, B:2, C:4 }
Merged N = { A:max(1,0,0)=1, B:max(0,0,0)=0, C:max(0,0,2)=2 } = { A:1, B:0, C:2 }

value = sum(P) - sum(N)
      = (3 + 2 + 4) - (1 + 0 + 2)
      = 9 - 3
      = 6   ✅
```

**Exactly 6**, the correct net likes, with two unlikes properly subtracted — and it converges regardless of partitions, reordering, or duplicate syncs, because both `P` and `N` are themselves G-Counters that we already trust.

### 5.3 The one rule to remember about PN-Counters

> A PN-Counter is **not** one number that goes up and down. It's **two numbers that only go up**, and you subtract them. "Down" is just "up, in a different counter."

That reframing is the whole insight. It's also why you should never "optimize" a PN-Counter by merging `P` and `N` into a single signed slot — you'd lose the grow-only property and `max` would start eating your decrements.

---

## 6. Runnable code

Below is a complete, runnable implementation. Python is the primary version; short Go and Java versions follow. The Python file includes a **3-replica convergence simulation** that applies syncs in **shuffled and duplicated** order and asserts the final total is exactly correct.

### 6.1 Python — G-Counter and PN-Counter

```python
"""
G-Counter and PN-Counter: grow-only and increment/decrement CRDT counters.
Pure Python, no dependencies. Run: python3 counters.py
"""
import random


class GCounter:
    """A grow-only counter. Value can only ever increase."""

    def __init__(self, replica_id):
        self.replica_id = replica_id
        # slot per replica; missing slots are treated as 0
        self.slots = {}

    def increment(self, amount=1):
        if amount < 0:
            raise ValueError("G-Counter cannot decrement")
        # a replica only ever touches its OWN slot
        self.slots[self.replica_id] = self.slots.get(self.replica_id, 0) + amount

    def value(self):
        # the counter's value is the SUM of all slots
        return sum(self.slots.values())

    def merge(self, other):
        """Merge another G-Counter in: per-slot MAX. Idempotent & commutative."""
        for rid in set(self.slots) | set(other.slots):
            self.slots[rid] = max(self.slots.get(rid, 0), other.slots.get(rid, 0))

    def copy(self):
        g = GCounter(self.replica_id)
        g.slots = dict(self.slots)
        return g

    def __repr__(self):
        return f"G({self.slots} -> {self.value()})"


class PNCounter:
    """An increment/decrement counter: two G-Counters, P and N. value = sum(P) - sum(N)."""

    def __init__(self, replica_id):
        self.replica_id = replica_id
        self.P = GCounter(replica_id)  # increments
        self.N = GCounter(replica_id)  # decrements

    def increment(self, amount=1):
        self.P.increment(amount)

    def decrement(self, amount=1):
        # "down" is just "up" in the N counter
        self.N.increment(amount)

    def value(self):
        return self.P.value() - self.N.value()

    def merge(self, other):
        # merge each component independently, each by per-slot max
        self.P.merge(other.P)
        self.N.merge(other.N)

    def copy(self):
        pn = PNCounter(self.replica_id)
        pn.P = self.P.copy()
        pn.N = self.N.copy()
        return pn

    def __repr__(self):
        return f"PN(P={self.P.slots}, N={self.N.slots} -> {self.value()})"


def demo_gcounter():
    print("=== G-Counter demo ===")
    A, B, C = GCounter("A"), GCounter("B"), GCounter("C")

    # concurrent increments while partitioned
    A.increment(4)
    A.increment(1)   # A: 5
    B.increment(2)   # B: 2
    C.increment(7)   # C: 7
    print("before sync:", A, B, C)

    # A and B sync (same side of a partition)
    B.merge(A)
    A.merge(B)
    print("after A<->B:", A, B)

    # partition heals, C joins
    A.merge(C)
    B.merge(A)
    C.merge(A)
    print("after C joins:", A, B, C)

    assert A.value() == B.value() == C.value() == 14
    print("all converged to", A.value(), "(expected 14)\n")


def demo_pncounter():
    print("=== PN-Counter demo ===")
    A, B, C = PNCounter("A"), PNCounter("B"), PNCounter("C")

    A.increment(3)   # +3
    B.increment(2)   # +2
    A.decrement(1)   # -1
    C.increment(4)   # +4
    C.decrement(2)   # -2
    print("before sync:", A, B, C)

    # merge everyone, in any order
    for x in (A, B, C):
        for y in (A, B, C):
            x.merge(y)

    print("after sync:", A, B, C)
    assert A.value() == B.value() == C.value() == 6
    print("all converged to", A.value(), "(expected 9 - 3 = 6)\n")


def demo_convergence_under_chaos(trials=500):
    """
    The real proof: apply syncs in SHUFFLED and DUPLICATED order,
    many times, and assert every replica lands on the exact true total.
    """
    print("=== convergence under shuffled + duplicated syncs ===")
    rng = random.Random(42)

    for t in range(trials):
        ids = ["A", "B", "C"]
        replicas = {rid: PNCounter(rid) for rid in ids}

        # each replica makes some random local +/- moves
        expected_p = 0
        expected_n = 0
        for rid in ids:
            ups = rng.randint(0, 9)
            downs = rng.randint(0, ups)  # don't go wildly negative; any value is fine
            replicas[rid].increment(ups)
            replicas[rid].decrement(downs)
            expected_p += ups
            expected_n += downs
        true_value = expected_p - expected_n

        # build a bag of sync messages: every (src -> dst) pair...
        messages = [(src, dst) for src in ids for dst in ids if src != dst]
        # ...DUPLICATE every message (retries happen)...
        messages = messages * 3
        # ...and SHUFFLE the delivery order (reordering happens).
        rng.shuffle(messages)

        # deliver. each message carries a SNAPSHOT taken at "send" time,
        # so even stale/duplicate snapshots get merged in.
        snapshots = {rid: replicas[rid].copy() for rid in ids}
        for src, dst in messages:
            # sometimes send a fresh snapshot, sometimes the old one (staleness)
            payload = replicas[src].copy() if rng.random() < 0.5 else snapshots[src]
            replicas[dst].merge(payload)

        # one final full gossip round so everyone definitely hears everyone
        for _ in range(2):
            for src in ids:
                for dst in ids:
                    if src != dst:
                        replicas[dst].merge(replicas[src])

        values = {rid: replicas[rid].value() for rid in ids}
        assert len(set(values.values())) == 1, f"diverged: {values}"
        assert values["A"] == true_value, f"wrong total: got {values['A']}, want {true_value}"

    print(f"{trials} chaotic trials: every replica converged to the EXACT total.\n")


if __name__ == "__main__":
    demo_gcounter()
    demo_pncounter()
    demo_convergence_under_chaos()
    print("ALL OK ✅")
```

Expected output (the chaos test is the important one):

```
=== G-Counter demo ===
before sync: G({'A': 5} -> 5) G({'B': 2} -> 2) G({'C': 7} -> 7)
after A<->B: G({'A': 5, 'B': 2} -> 7) G({'B': 2, 'A': 5} -> 7)
after C joins: G({'A': 5, 'B': 2, 'C': 7} -> 14) ...
all converged to 14 (expected 14)

=== PN-Counter demo ===
...
all converged to 6 (expected 9 - 3 = 6)

=== convergence under shuffled + duplicated syncs ===
500 chaotic trials: every replica converged to the EXACT total.

ALL OK ✅
```

The key line is the assertion inside `demo_convergence_under_chaos`: no matter how we shuffle and duplicate the sync messages, **every replica ends on the exact true total**. That assertion passing is the whole promise of the data structure, made executable.

### 6.2 Go — compact version

```go
package main

import "fmt"

type GCounter struct {
	id    string
	slots map[string]int
}

func NewGCounter(id string) *GCounter {
	return &GCounter{id: id, slots: map[string]int{}}
}

func (g *GCounter) Increment(n int) { g.slots[g.id] += n } // own slot only

func (g *GCounter) Value() int {
	total := 0
	for _, v := range g.slots {
		total += v
	}
	return total
}

func (g *GCounter) Merge(other *GCounter) { // per-slot max
	for id, v := range other.slots {
		if v > g.slots[id] {
			g.slots[id] = v
		}
	}
}

type PNCounter struct{ P, N *GCounter }

func NewPNCounter(id string) *PNCounter {
	return &PNCounter{P: NewGCounter(id), N: NewGCounter(id)}
}
func (p *PNCounter) Increment(n int)     { p.P.Increment(n) }
func (p *PNCounter) Decrement(n int)     { p.N.Increment(n) }
func (p *PNCounter) Value() int          { return p.P.Value() - p.N.Value() }
func (p *PNCounter) Merge(o *PNCounter)  { p.P.Merge(o.P); p.N.Merge(o.N) }

func main() {
	a, b, c := NewPNCounter("A"), NewPNCounter("B"), NewPNCounter("C")
	a.Increment(3)
	b.Increment(2)
	a.Decrement(1)
	c.Increment(4)
	c.Decrement(2)

	for _, x := range []*PNCounter{a, b, c} {
		for _, y := range []*PNCounter{a, b, c} {
			x.Merge(y)
		}
	}
	fmt.Println("A:", a.Value(), "B:", b.Value(), "C:", c.Value()) // 6 6 6
}
```

### 6.3 Java — compact version

```java
import java.util.*;

class GCounter {
    final String id;
    final Map<String, Integer> slots = new HashMap<>();

    GCounter(String id) { this.id = id; }

    void increment(int n) { slots.merge(id, n, Integer::sum); } // own slot only

    int value() {
        int total = 0;
        for (int v : slots.values()) total += v;
        return total;
    }

    void merge(GCounter other) { // per-slot max
        for (var e : other.slots.entrySet())
            slots.merge(e.getKey(), e.getValue(), Math::max);
    }
}

class PNCounter {
    final GCounter P, N;
    PNCounter(String id) { P = new GCounter(id); N = new GCounter(id); }
    void increment(int n) { P.increment(n); }
    void decrement(int n) { N.increment(n); }
    int value() { return P.value() - N.value(); }
    void merge(PNCounter o) { P.merge(o.P); N.merge(o.N); }
}

public class Counters {
    public static void main(String[] args) {
        PNCounter a = new PNCounter("A"), b = new PNCounter("B"), c = new PNCounter("C");
        a.increment(3); b.increment(2); a.decrement(1);
        c.increment(4); c.decrement(2);

        for (PNCounter x : List.of(a, b, c))
            for (PNCounter y : List.of(a, b, c))
                x.merge(y);

        System.out.println(a.value() + " " + b.value() + " " + c.value()); // 6 6 6
    }
}
```

All three implementations agree: the PN-Counter converges to **6**, and the G-Counter to **14**, regardless of merge order.

---

## 7. Where this is used in the real world

These counters are not academic toys — they ship in production systems you've used today.

| Use case | Why a CRDT counter fits |
|----------|-------------------------|
| **Likes / reactions** | Hot posts get liked from everywhere at once. A G-Counter lets every edge server accept likes locally and reconcile later, with no global lock. Unlikes need a PN-Counter. |
| **View / play counts** | Video and article views are pure increments across many CDN edges. A G-Counter sums them exactly even when edges sync sloppily. |
| **Ad impressions / clicks** | Ad networks count impressions across thousands of servers and must not lose or double-count billing events. Per-slot ownership prevents both. |
| **Inventory deltas** | Stock goes up (restock) and down (sale). A PN-Counter tracks the net across warehouses; merges reconcile concurrent sales without a central lock. (Caveat: it can't *prevent* overselling on its own — counting is not the same as enforcing a bound.) |
| **Distributed metrics / telemetry** | Request counts, error counts, and bytes-served are aggregated from many nodes. CRDT counters give an exact total even with lossy, retrying transport. |
| **Shopping-cart item quantity** | "Add 2, remove 1" across a user's phone and laptop while offline. PN-Counter merges to the right quantity when devices sync. |

The common thread: **many independent writers, a network that drops/reorders/duplicates messages, and a hard requirement that the final tally be exact.** Whenever you see that shape, reach for a G-Counter (additions only) or a PN-Counter (additions and subtractions). Real databases that ship these include **Redis** (CRDTs in Redis Enterprise), **Riak** (its classic counter datatype), and **Akka Distributed Data**.

---

## 8. Misconceptions

**"On merge, just add the two counters together."**
This is the single most common bug, and it **double-counts**. Suppose `A = {A:5}` and `B` has already synced once so `B = {A:5, B:3}`. If they merge by *adding* slot values, slot `A` becomes `5 + 5 = 10` — but there were only ever 5 likes on `A`! The merge must be **`max` per slot** (`max(5,5)=5`), *not* `+`. Addition is for combining slots into the *final value* (the sum), never for combining two replicas' copies of the *same* slot. Keep these straight: **sum across slots, max within a slot.**

**"The value of a G-Counter is whatever's in my own slot."**
No — your slot only holds *your* contribution. The value is the **sum of every slot**, including the ones owned by replicas you've synced from.

**"A PN-Counter is a single integer that goes up and down."**
No — it's **two grow-only counters**, `P` and `N`, and the value is `sum(P) - sum(N)`. If you collapse it into one signed slot, `max`-merge will erase decrements. "Down" must always be recorded as "up in `N`."

**"If I miss a sync message, I lose data."**
No — missing one message is harmless because each message carries the **full state**, and merges are idempotent. As long as you *eventually* receive *some* later message that includes that information, `max` catches you up. A dropped sync just means "catch up next time."

**"Duplicate sync messages will double-count."**
No — that's the whole point of `max` being idempotent. `merge(x, x) == x`. Re-delivering the same state changes nothing. (This is also why you can retry sends freely.)

**"Two replicas must never increment at the same time."**
The opposite — **concurrent increments on different slots are exactly the case CRDTs are built for.** `A` bumping slot `A` while `B` bumps slot `B` never conflicts, because they touch disjoint slots.

---

## 9. Common mistakes

| Mistake | What goes wrong | Fix |
|---------|-----------------|-----|
| Merging slots with `+` instead of `max` | Double-counting on every re-sync | Always `max` per slot; sum only for the value |
| A replica increments **another** replica's slot | Breaks the single-owner rule; `max` loses updates | A replica may only ever grow **its own** slot |
| Storing a PN-Counter as one signed map | `max`-merge erases decrements | Keep two G-Counters, `P` and `N` |
| Reusing the same replica-id on two servers | Their slots collide; `max` drops one's increments | Every replica needs a **globally unique** id |
| Treating missing slot as anything but 0 | Off-by-one totals after merge | Default any absent slot to `0` |
| Assuming you need ordered/once delivery | Over-engineered transport, fragile | Merge tolerates reorder + duplication by design |
| Expecting a PN-Counter to *prevent* oversell | Counts correctly but doesn't enforce a floor | Counting ≠ enforcing bounds; add a separate guard |

---

## 10. Cheat sheet

```
G-COUNTER (grow-only)
  state    : map { replicaId -> count }, missing = 0
  increment: slots[myId] += n      (own slot ONLY, n >= 0)
  value    : sum(slots.values())
  merge    : for each slot, take MAX(mine, theirs)
  props    : commutative, associative, idempotent  ->  converges

PN-COUNTER (increment + decrement)
  state    : two G-Counters,  P (plus)  and  N (negative)
  increment: P.increment(n)
  decrement: N.increment(n)         ("down" = "up in N")
  value    : sum(P) - sum(N)
  merge    : P.merge(other.P) ; N.merge(other.N)   (each by per-slot MAX)

GOLDEN RULES
  - SUM across slots   -> the value
  - MAX within a slot  -> the merge
  - own slot only      -> who may increment
  - unique replica id  -> who owns each slot
  - never use '+' to merge two copies of the same slot (double-count!)
```

Quick mental model:

```
                 increment own slot
                         |
   { A:5, B:2, C:7 }  <--+          value = 5+2+7 = 14
        |  |  |
        |  |  +--- C's likes
        |  +------ B's likes
        +--------- A's likes

   merge two states  ->  per-slot max  ->  newest truth in every slot
```

---

## 11. Summary

- A **shared integer with last-write-wins loses increments** under concurrency — we watched `5 + 3` collapse to `3`. A lock fixes correctness but destroys scalability and dies during partitions.
- A **G-Counter** solves this with one idea: **give each replica its own slot, let a replica grow only its own slot, take the value as the sum of all slots, and merge by per-slot `max`.** No locks, no coordinator.
- Per-slot `max` is correct because each slot is **grow-only and single-owner**, so the larger value is always the newer truth. Because `max` is commutative, associative, and idempotent, the counter **converges to the exact total** no matter how syncs are delayed, reordered, or duplicated.
- A **PN-Counter** adds decrements by keeping **two** G-Counters, `P` and `N`, with `value = sum(P) - sum(N)`. "Down" is recorded as "up in `N`," which preserves the grow-only property each sub-counter needs.
- The biggest trap is merging with `+` (double-counting). Remember: **sum across slots, `max` within a slot.**
- These counters power likes, views, ad impressions, inventory deltas, and distributed metrics — anywhere many writers must produce one exact tally over an unreliable network.

Next, see how the same convergence ideas extend from numbers to **collections** in [Sets / OR-Set / LWW](../04-sets-or-set-lww/junior.md), and deepen your grasp of the state-merge model in [State vs Op CRDTs](../02-state-vs-operation-based-crdts/junior.md). When you're ready for delta-merges, vector-clock comparisons, and garbage-collecting stale slots, continue to the [middle](middle.md) and [senior](senior.md) tiers.

---

## 12. Further reading

- [CRDT Fundamentals](../01-crdt-fundamentals/junior.md) — replicas, merge, convergence, and the partition model these counters rely on.
- [State vs Operation-Based CRDTs](../02-state-vs-operation-based-crdts/junior.md) — why state-based merge (the model used here) converges, and the op-based alternative.
- [Sets / OR-Set / LWW](../04-sets-or-set-lww/junior.md) — the next step up: convergent *collections* instead of counters.
- [middle](middle.md) and [senior](senior.md) — this same topic with delta-state optimization, pruning, and production concerns.
- Shapiro, Preguiça, Baquero, Zawirski — *"A Comprehensive Study of Convergent and Commutative Replicated Data Types"* (2011), the paper that named and catalogued G-Counter and PN-Counter.
- Marc Shapiro et al. — *"Conflict-Free Replicated Data Types"* (SSS 2011), the shorter introduction.
- The Redis and Riak documentation on their counter datatypes, for how these ideas look in a real database.
