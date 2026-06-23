# CRDT Fundamentals — Junior Level

> **Audience:** You know basic data structures (sets, maps, counters) and Big-O, but you have never touched distributed systems, replication, or "eventual consistency."
> **Read time:** ~35 minutes.
> **Focus:** Why do copies of the same data on different machines disagree — and how can a data structure be *designed* so all copies ALWAYS reconcile to the same value, with **no coordinator and no locks**?

---

## Table of Contents

1. [Introduction — the replication problem](#1-introduction--the-replication-problem)
2. [Prerequisites](#2-prerequisites)
3. [Glossary](#3-glossary)
4. [The Hook: two replicas, who wins?](#4-the-hook-two-replicas-who-wins)
5. [Eventual vs strong consistency](#5-eventual-vs-strong-consistency)
6. [The big idea: a merge function that is order-independent](#6-the-big-idea-a-merge-function-that-is-order-independent)
7. [Your first CRDT: the Grow-only Set (G-Set)](#7-your-first-crdt-the-grow-only-set-g-set)
8. [Why union "just works" (and "set to X" does not)](#8-why-union-just-works-and-set-to-x-does-not)
9. [Runnable code: 3 replicas converging](#9-runnable-code-3-replicas-converging)
10. [Real-world analogies](#10-real-world-analogies)
11. [Common Misconceptions](#11-common-misconceptions)
12. [Common Mistakes](#12-common-mistakes)
13. [Cheat Sheet](#13-cheat-sheet)
14. [Summary](#14-summary)
15. [Further Reading](#15-further-reading)

---

## 1. Introduction — the replication problem

Imagine a shopping cart. Not in your head — a real one, stored as data. So far this is a topic for a beginner data-structures course: a cart is just a **set** of product IDs, or a **map** from product to quantity. You add an item, you remove an item, you read the contents. Big-O is small, the code is boring, life is good.

Now change exactly one thing: **the cart lives on more than one machine at the same time.**

Why would anyone do that? Three very ordinary reasons:

1. **Speed.** Users in Tokyo, Berlin, and São Paulo all want their cart to load instantly. The fastest way is to keep a *copy* of the cart physically near each of them.
2. **Availability.** If the one machine holding the cart catches fire (or just reboots), the user should not lose their cart. So you keep copies on several machines.
3. **Offline.** Your phone caches your cart so the app works in a subway tunnel. The phone *is* one of the copies.

Each independent copy of the data is called a **replica**. The moment you have more than one replica, you have created a problem that does not exist on a single machine:

> The replicas can be edited independently, and then they **disagree**.

Here is the scenario that ruins everyone's afternoon. You open the app on your **phone** and on your **laptop**. Both currently show a cart `{milk}`. Then:

- On your **laptop**, you add `eggs`. Laptop's cart is now `{milk, eggs}`.
- At the *same moment*, on your **phone** (which is in a subway tunnel, no signal), you add `bread`. Phone's cart is now `{milk, bread}`.

Neither edit was "wrong." Neither device knew about the other's edit, because the network was down between them — a situation called a **network partition**. When the phone comes back online, the two replicas must somehow combine their views. What *should* the cart be?

Most people answer instantly: `{milk, eggs, bread}`. Obviously. Keep both additions.

Hold onto that instinct — it is exactly right, and the rest of this document is about *why* it is right, *when* that instinct fails, and how to design data structures so the "obviously correct" answer is also the *guaranteed* answer, computed automatically, with no human in the loop and no central referee.

That family of data structures is called **CRDTs**: **Conflict-free Replicated Data Types**. By the end of this page you will have built one by hand and in code.

---

## 2. Prerequisites

You only need a handful of things, all of which you likely already have:

| You should be comfortable with… | Why it matters here | Brush up |
| --- | --- | --- |
| Sets and the union operation (`A ∪ B`) | The simplest CRDT *is* a set whose merge is union | [Hash Tables](../../05-basic-data-structures/05-hash-tables/junior.md) |
| Maps / dictionaries | Counters and richer CRDTs are built on maps | [Hash Tables](../../05-basic-data-structures/05-hash-tables/junior.md) |
| Integer counters | We contrast a counter with a set to show *why* sets are easier | (any intro DS material) |
| Big-O, just enough to reason about cost | Merging touches every element; you should notice that | [Big-O Notation](../../06-algorithmic-complexity/01-time-vs-space-complexity/junior.md) |

You do **not** need any prior distributed-systems knowledge. We build that from zero. If you have heard the words "vector clock," "Paxos," or "Raft" and they scared you — forget them for now. None are required here.

---

## 3. Glossary

Read this once now; it will make the rest click. Refer back as needed.

| Term | Plain-English meaning |
| --- | --- |
| **Replica** | One independent copy of the data, living on one machine (a server, a phone, a browser tab). If there are 3 copies, there are 3 replicas. |
| **Partition** | A period when some replicas *cannot talk to each other* over the network. Messages are delayed or lost. Edits still happen on each side, blind to the others. |
| **Eventual consistency** | A promise: *if* updates stop for a while *and* replicas can exchange their data, they will all end up showing the **same** value. It does NOT promise they agree *at every instant*. |
| **Convergence** | The actual event of all replicas reaching the same value. "The replicas converged on `{milk, eggs, bread}`." |
| **Conflict** | When two replicas made changes that *seem* to disagree (one added `eggs`, the other added `bread`; or worse, one set price to `$5`, the other to `$7`). |
| **Merge** | The function that takes two replica states and produces one combined state. The heart of every CRDT. We will obsess over its properties. |
| **CRDT** | **Conflict-free Replicated Data Type.** A data type whose merge is designed so replicas *always* converge, automatically, without a coordinator. |
| **Coordinator** | A central referee that all replicas must ask before making a change ("may I write?"). CRDTs are special because they need **no** coordinator. |

---

## 4. The Hook: two replicas, who wins?

Let's make the problem concrete and uncomfortable. Forget sets for a second and use a single value: a **product price** stored on two replicas, A and B. Both start at `$5`.

- At 10:00:00, on replica **A**, a manager sets price to `$7`.
- At 10:00:00 (the *same wall-clock second*), on replica **B**, a different manager sets price to `$9`.

The network is partitioned, so neither knows about the other. Later the partition heals, A and B exchange states, and now they must agree on **one** price. Who wins?

### The naive answer: "Last Write Wins" (LWW)

The most popular first idea is **Last Write Wins**: attach a timestamp to each write, and on merge, keep the value with the *latest* timestamp. Sounds airtight. Each replica reads its local clock when it writes:

| Replica | Value written | Local clock said |
| --- | --- | --- |
| A | `$7` | `10:00:00.000` |
| B | `$9` | `10:00:00.000` |

First problem you can already see: **the timestamps are equal.** A coin flip decides the price of a product. Annoying, but maybe survivable.

Now the deeper problem, the one that makes LWW genuinely dangerous: **clocks lie.**

Real computer clocks are not synchronized to the microsecond. They drift. They get corrected by NTP and *jump backwards*. A laptop that has been asleep can be seconds or minutes off. So consider:

| Replica | Value written | Local clock said | What the clock *should* have said |
| --- | --- | --- | --- |
| A | `$7` | `10:00:00.000` | `10:00:00.000` (correct) |
| B | `$9` | `09:59:58.000` | `10:00:05.000` (B's clock is 7s slow!) |

B actually wrote **later** in real time, but its slow clock makes it *look* earlier. LWW will silently keep A's `$7` and **throw B's `$9` away** — even though B was the more recent decision. No error. No warning. The data is just quietly wrong, and you will find out from an angry customer.

> **The lesson of the hook:** you cannot reliably order "what happened first" across machines using wall-clock time. Clocks are not a source of truth. LWW *is* a real, sometimes-acceptable strategy (we'll meet it again at the [middle](middle.md) tier), but it resolves conflicts by **discarding** data, and it leans on clocks you cannot trust.

So here is the question that births the entire field:

> Can we design a data structure where the merge **never has to pick a loser**, never consults a clock, and yet **all replicas still end up identical**?

For a *set*, the answer is a beautiful yes — because the cart instinct from Section 1 (`{milk, eggs, bread}`) keeps *both* edits instead of choosing. Let's build toward it.

---

## 5. Eventual vs strong consistency

Before the solution, name the two worlds you're choosing between.

### Strong consistency

**Strong consistency** means: every read sees the most recent write, as if there were only one copy of the data, no matter which replica you ask. The system behaves like a single machine.

How do you get that with multiple replicas? You **coordinate**. Before any replica accepts a write, the replicas (or a leader among them) must *agree* — typically by voting, using protocols with names like Paxos and Raft. Concretely, a write often has to:

1. Ask a leader / quorum for permission.
2. Wait for a majority to acknowledge.
3. Only then return "success" to the user.

This is the world of **locks** and **coordinators**. It gives you a clean mental model — there are never two disagreeing values — but it costs you dearly:

- **Latency:** every write waits for a network round-trip to other replicas, possibly across continents.
- **Availability:** during a **partition**, a replica that can't reach the majority must *refuse writes* (or risk inconsistency). Your subway-tunnel phone simply stops working.

### Eventual consistency

**Eventual consistency** makes a weaker, cheaper promise:

> Each replica accepts writes *immediately and locally*, with no coordination. Replicas gossip their changes to each other in the background. **If** updates pause and replicas exchange data, they will **eventually converge** to the same value.

This is fast (no waiting) and available (the phone keeps working offline). The price you pay: at any given instant, two replicas might show *different* values, and you must have a rule for **how to merge** them when they finally talk.

That merge rule is where everything can go wrong. A bad merge rule loses data (LWW) or, worse, leaves replicas *permanently disagreeing* — which is not consistency of any kind.

**CRDTs are the disciplined way to do eventual consistency.** They constrain the data type and its merge so that convergence is not a hope but a *mathematical guarantee* — while keeping the speed and availability of the eventual-consistency world, with **no coordinator and no locks**. (The strong-but-cheap-sounding name for this guarantee is *Strong Eventual Consistency*; you don't need the formal definition yet, just the slogan: **same updates seen ⟹ same state, always**.)

| | Strong consistency | Eventual consistency (CRDT-style) |
| --- | --- | --- |
| Needs a coordinator / quorum? | Yes | **No** |
| Write latency | High (wait for agreement) | Low (write locally, sync later) |
| Works during a partition? | Often no | **Yes** |
| Two replicas ever disagree momentarily? | No | Yes (then they converge) |
| Can it silently lose data? | No | Only if merge is badly designed — CRDTs prevent this |

---

## 6. The big idea: a merge function that is order-independent

Here is the entire trick of CRDTs in one sentence:

> **Design the merge function so the *order* and *number of times* updates arrive doesn't change the final result.**

Why does order matter so much? Because the network is chaotic. When replicas gossip, messages can:

- **Arrive out of order** — replica C might hear A's update *after* it hears B's, while D hears them the other way around.
- **Be delivered more than once** — networks retry. A "deliver at least once" channel will sometimes deliver the *same* message twice, three times, ten times.
- **Be delayed for a long time** — a message can sit in a queue for minutes.

If your merge gives different answers depending on these accidents of timing, your replicas will **not** converge. So we demand that merge have three specific properties. Each has an intimidating math name and a five-year-old's explanation. Learn both.

### Property 1 — Commutative ("order between two doesn't matter")

`merge(a, b) = merge(b, a)`

Merging A-then-B gives the same result as B-then-A.

Tiny concrete example with set union (`∪`):

```
{milk, eggs} ∪ {milk, bread}  =  {milk, eggs, bread}
{milk, bread} ∪ {milk, eggs}  =  {milk, eggs, bread}   ✅ same
```

Counter-example — subtraction is *not* commutative: `5 - 3 = 2` but `3 - 5 = -2`. If your merge were "subtract," order would change the answer, and replicas would diverge.

### Property 2 — Associative ("grouping doesn't matter")

`merge(merge(a, b), c) = merge(a, merge(b, c))`

When you fold three or more states together, how you parenthesize them doesn't matter. This is what lets each replica merge incoming updates *as they arrive*, in whatever clumps the network delivers them.

Tiny concrete example with union:

```
({a} ∪ {b}) ∪ {c}  =  {a, b} ∪ {c}  =  {a, b, c}
{a} ∪ ({b} ∪ {c})  =  {a} ∪ {b, c}  =  {a, b, c}   ✅ same
```

### Property 3 — Idempotent ("merging the same thing twice = once")

`merge(a, a) = a`

Merging a state with itself (or re-applying an update you already have) changes nothing.

This is the property people forget, and it is **the one the network forces on you**. Because messages get redelivered, your merge *will* see the same update multiple times. With union:

```
{milk, eggs} ∪ {milk, eggs}  =  {milk, eggs}   ✅ unchanged
```

Now the contrast that shows why idempotence matters. Suppose instead of a set you tracked a **count** and your "merge" was "add the incoming count." A redelivered message would be counted **twice** — your number inflates every time the network hiccups. That structure is *not* idempotent, so it is *not* a safe CRDT under at-least-once delivery. (CRDT counters exist, but they're built more cleverly — see [G-Counter / PN-Counter](../03-counters-g-pn/junior.md).)

### Why these three together = guaranteed convergence

Put them together and something wonderful happens. If merge is **commutative + associative + idempotent**, then no matter:

- in **what order** a replica receives the set of all updates,
- how many **duplicate** copies it receives, or
- how the updates are **grouped** as they arrive,

…every replica that has *seen the same set of updates* computes the **exact same final state**. Reordering is handled by commutativity + associativity; duplication is handled by idempotence. The accidents of the network are mathematically erased.

> A merge with all three properties forms what mathematicians call a *join on a semilattice*. You will meet that phrase at the [senior](senior.md) tier. For now the slogan is enough: **commutative, associative, idempotent ⟹ replicas converge, period.**

---

## 7. Your first CRDT: the Grow-only Set (G-Set)

The **G-Set** (Grow-only Set) is the "Hello, World" of CRDTs. The rules:

- The state of each replica is a **set** of elements.
- The only mutation is **`add(x)`** — insert an element. There is *no remove*. (That restriction is what "grow-only" means, and it's exactly why merge stays simple. Removing is genuinely harder; that's a later topic.)
- **`merge(a, b)` = `a ∪ b`** (set union).
- To **read** the value, you just look at the set.

That's the whole specification. Let's prove to ourselves it converges by running a messy, realistic scenario **by hand**.

### The scenario

Three replicas — call them **R1**, **R2**, **R3** — start empty: `{}`. Users add elements at different replicas while partitions and reordering and duplication happen. We'll write each replica's state after every event.

**The local additions (the "ground truth" of what users did):**

- A user adds `apple` at **R1**.
- A user adds `banana` at **R2**.
- A user adds `cherry` at **R3**.
- Later, a user adds `date` at **R1**.

So the *correct* final answer, that all replicas must reach, is:

```
{apple, banana, cherry, date}
```

Now the network delivers the gossip messages in a deliberately ugly order, with one duplicate. Let's trace it.

### The trace

We track three columns. Each row is one event: either a *local add* or a *received merge* (an incoming state from another replica that gets unioned in). Watch the right-hand replica states.

| Step | Event | R1 state | R2 state | R3 state |
| --- | --- | --- | --- | --- |
| 0 | (start) | `{}` | `{}` | `{}` |
| 1 | Local `add(apple)` at R1 | `{apple}` | `{}` | `{}` |
| 2 | Local `add(banana)` at R2 | `{apple}` | `{banana}` | `{}` |
| 3 | Local `add(cherry)` at R3 | `{apple}` | `{banana}` | `{cherry}` |
| 4 | R3 → R2: R2 merges `{cherry}` | `{apple}` | `{banana, cherry}` | `{cherry}` |
| 5 | Local `add(date)` at R1 | `{apple, date}` | `{banana, cherry}` | `{cherry}` |
| 6 | R1 → R3: R3 merges `{apple, date}` | `{apple, date}` | `{banana, cherry}` | `{apple, cherry, date}` |
| 7 | R2 → R1: R1 merges `{banana, cherry}` | `{apple, banana, cherry, date}` | `{banana, cherry}` | `{apple, cherry, date}` |
| 8 | **R2 → R1 AGAIN (duplicate!)**: R1 merges `{banana, cherry}` once more | `{apple, banana, cherry, date}` | `{banana, cherry}` | `{apple, cherry, date}` |
| 9 | R3 → R2: R2 merges `{apple, cherry, date}` | `{apple, banana, cherry, date}` | `{apple, banana, cherry, date}` | `{apple, cherry, date}` |
| 10 | R1 → R3: R3 merges `{apple, banana, cherry, date}` | `{apple, banana, cherry, date}` | `{apple, banana, cherry, date}` | `{apple, banana, cherry, date}` |

Read the final row. **All three replicas now hold `{apple, banana, cherry, date}`.** They converged.

Notice what we got away with:

- **Reordering:** R3 learned about `apple`/`date` (step 6) *before* it learned about `banana`/`cherry` (step 10), while R2 learned them in the opposite order. Different orders, same result — thanks to **commutativity + associativity**.
- **Duplication:** Step 8 re-delivered the *exact same* message from step 7. R1's state did **not** budge. Thanks to **idempotence**.
- **No coordinator:** At no point did a replica ask permission, take a lock, or consult a clock. Each replica accepted local adds instantly and merged gossip whenever it arrived.

That is a CRDT working. The "magic" is just set union being commutative, associative, and idempotent.

> **Try it yourself:** take a pen, shuffle the order of steps 4–10 into a different sequence, and re-run the trace. Keep step 8's duplicate, or add three more duplicates. You will land on the same `{apple, banana, cherry, date}` every time. That robustness is the whole point.

---

## 8. Why union "just works" (and "set to X" does not)

Let's check union against our three properties, and then look at an operation that *fails* them — so you can recognize danger.

### Union passes all three

| Property | Check with sets | Verdict |
| --- | --- | --- |
| Commutative | `A ∪ B = B ∪ A` | ✅ |
| Associative | `(A ∪ B) ∪ C = A ∪ (B ∪ C)` | ✅ |
| Idempotent | `A ∪ A = A` | ✅ |

All three hold for *any* sets, always. That's why a G-Set is a valid CRDT with zero extra machinery.

There is also a comforting intuition: union only ever **grows** the set. A merge can never shrink it, never remove an element someone added. The set marches monotonically "upward" toward the union of everything anyone has ever added. There is no way for two replicas to "fight," because adding `eggs` and adding `bread` are not in opposition — the result simply contains both. **Conflict-free.**

### "Set the value to X" fails

Contrast a single mutable variable whose operation is `set(x)` — overwrite the value. Suppose merge is "take the other replica's value" (or "take the newer one"). Check:

| Property | Check | Verdict |
| --- | --- | --- |
| Commutative | If A=`7`, B=`9`: keeping A's value vs keeping B's value gives different answers depending on which side you treat as "the merge" | ❌ |
| Idempotent | Merging may flip the value back and forth depending on direction | ❌ (no stable, order-free answer) |

There is **no order-independent way** to merge two blind overwrites of the same slot, because the two writes genuinely conflict — `7` and `9` cannot both survive in one slot. *Something must be discarded*, and any rule for who-gets-discarded either depends on a clock (LWW — clocks lie) or on a coordinator (which we're trying to avoid).

This is the deep reason CRDTs are *designed*, not stumbled upon. You start from the merge you want — one that is commutative, associative, and idempotent — and you let that constraint *shape the data type*. A grow-only set is mergeable; a blind overwrite slot is not. Richer CRDTs (counters, removable sets, even text documents) are clever tricks to *make* otherwise-conflicting operations fit inside an order-free, idempotent merge. You'll see the first such trick in [G-Counter / PN-Counter](../03-counters-g-pn/junior.md).

> **Preview term — CvRDT:** what we built here, where replicas exchange their *whole state* and merge by union, is the **state-based** flavor, formally a **CvRDT** (Convergent Replicated Data Type). There's a second flavor that ships *operations* ("add apple") instead of states. The difference is the entire subject of the next page: [State-based vs Operation-based CRDTs](../02-state-vs-operation-based-crdts/junior.md). Don't worry about it yet.

---

## 9. Runnable code: 3 replicas converging

Let's turn the hand-trace into a program you can actually run. We simulate three replicas that gossip their G-Set states to each other in **random order with random duplicates**, then assert they all converge.

### Python (primary)

```python
"""
G-Set CRDT simulation.

Three replicas each accept local add()s, then gossip their full state
to each other in a randomized, duplicate-prone order. We assert that
all replicas converge to the union of everything anyone added.

Run:  python gset_sim.py
"""

import random


class GSet:
    """A Grow-only Set CRDT. State = a Python set. Merge = union."""

    def __init__(self, name):
        self.name = name
        self.state = set()

    def add(self, element):
        # Local mutation: instant, no coordination, no lock.
        self.state.add(element)

    def merge(self, other_state):
        # The CRDT merge: union. Commutative, associative, idempotent.
        # |= is in-place union; merging a state we've already seen is a no-op.
        self.state |= other_state

    def __repr__(self):
        return f"{self.name}={sorted(self.state)}"


def run_once(seed):
    random.seed(seed)

    r1, r2, r3 = GSet("R1"), GSet("R2"), GSet("R3")
    replicas = [r1, r2, r3]

    # --- Local additions happen independently on each replica ---
    r1.add("apple")
    r2.add("banana")
    r3.add("cherry")
    r1.add("date")

    # The single correct answer everyone must reach:
    expected = {"apple", "banana", "cherry", "date"}

    # --- Gossip: many random "sender -> receiver" deliveries, ---
    # --- some of which are duplicates of earlier ones.         ---
    # We deliver a generous number of random messages so that, eventually,
    # every update has reached every replica (possibly several times over).
    for _ in range(40):
        sender = random.choice(replicas)
        receiver = random.choice(replicas)
        if sender is receiver:
            continue
        # Snapshot the sender's state and "send" it.
        message = set(sender.state)
        # Randomly redeliver the SAME message to stress idempotence.
        deliveries = random.choice([1, 1, 2, 3])  # often 1, sometimes more
        for _ in range(deliveries):
            receiver.merge(message)

    # --- After enough gossip, all replicas must be identical & correct ---
    for r in replicas:
        assert r.state == expected, f"DIVERGED: {r} != {sorted(expected)}"

    return r1, r2, r3


if __name__ == "__main__":
    # Try many random schedules. Convergence must hold for ALL of them.
    for seed in range(1000):
        r1, r2, r3 = run_once(seed)
    print("All 1000 random gossip schedules converged. ✅")
    print(r1)
    print(r2)
    print(r3)
```

Expected output:

```
All 1000 random gossip schedules converged. ✅
R1=['apple', 'banana', 'cherry', 'date']
R2=['apple', 'banana', 'cherry', 'date']
R3=['apple', 'banana', 'cherry', 'date']
```

The key line is the `assert`. We run **1000 different random schedules** — different orderings, different duplication patterns — and *every single one* converges to the same correct set. That is the empirical face of the math from Section 6. If you replaced `merge` with something non-idempotent or non-commutative, some seed would eventually trip the assert.

> **Caveat for honesty:** the simulation delivers "enough" messages (40) that every update reaches every replica. Convergence is only guaranteed *once a replica has seen all the updates*. In the real world you keep gossiping forever in the background so this stays true. CRDTs guarantee that *if* all updates propagate, replicas agree — they don't magically teleport updates around.

### Go (secondary)

The same idea in Go, to show it isn't Python-specific. Go has no built-in set, so we use `map[string]struct{}`.

```go
package main

import (
	"fmt"
	"math/rand"
	"sort"
)

// GSet is a Grow-only Set CRDT.
type GSet struct {
	name  string
	state map[string]struct{}
}

func NewGSet(name string) *GSet {
	return &GSet{name: name, state: make(map[string]struct{})}
}

func (g *GSet) Add(e string) {
	g.state[e] = struct{}{} // local, instant, no coordination
}

// Merge unions another replica's state in. Idempotent: re-merging is a no-op.
func (g *GSet) Merge(other map[string]struct{}) {
	for k := range other {
		g.state[k] = struct{}{}
	}
}

func (g *GSet) Snapshot() map[string]struct{} {
	cp := make(map[string]struct{}, len(g.state))
	for k := range g.state {
		cp[k] = struct{}{}
	}
	return cp
}

func (g *GSet) Sorted() []string {
	out := make([]string, 0, len(g.state))
	for k := range g.state {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func main() {
	rand.Seed(42)
	r1, r2, r3 := NewGSet("R1"), NewGSet("R2"), NewGSet("R3")
	reps := []*GSet{r1, r2, r3}

	r1.Add("apple")
	r2.Add("banana")
	r3.Add("cherry")
	r1.Add("date")

	// Randomized gossip with occasional duplicate deliveries.
	for i := 0; i < 40; i++ {
		s := reps[rand.Intn(3)]
		recv := reps[rand.Intn(3)]
		if s == recv {
			continue
		}
		msg := s.Snapshot()
		deliveries := 1 + rand.Intn(3) // 1..3 copies of the same message
		for d := 0; d < deliveries; d++ {
			recv.Merge(msg)
		}
	}

	want := []string{"apple", "banana", "cherry", "date"}
	for _, r := range reps {
		got := r.Sorted()
		if fmt.Sprint(got) != fmt.Sprint(want) {
			panic(fmt.Sprintf("DIVERGED: %s = %v", r.name, got))
		}
		fmt.Printf("%s = %v\n", r.name, got)
	}
	fmt.Println("Converged. ✅")
}
```

Both programs say the same thing: feed a grow-only set the same adds in any order, with any duplicates, and the replicas end up identical. **No locks were taken. No coordinator was asked. No clock was read.**

---

## 10. Real-world analogies

CRDTs are not academic toys — they ship in software you use daily.

- **Shopping carts (the classic).** Amazon's Dynamo paper famously used a mergeable cart so that adding items never failed, even during failures. The merge biased toward *keeping* items (union-like) — better to occasionally resurrect a removed item than to lose an add. A pure G-Set is exactly this "never lose an add" behavior.

- **Collaborative documents (Google Docs, Notion, Figma).** When two people type in the same paragraph offline and reconnect, *both* edits should survive and the document must look identical on every screen. Real collaborative editors use sophisticated CRDTs (or the related "Operational Transformation"), but the foundational requirement is the one you now understand: a merge that converges regardless of message order.

- **Distributed caches and key-value stores (Redis, Riak, Cassandra-style systems).** These keep multiple replicas for availability. Several offer CRDT types — counters, sets, registers — precisely so writes can happen on any replica during a partition and reconcile automatically afterward.

- **Multiplayer and offline-first mobile apps.** A note-taking app that works on the subway and a laptop simultaneously, then syncs without a "your changes conflict, pick one" dialog, is almost certainly leaning on CRDT ideas.

The common thread: **stay available and fast by letting every replica accept writes locally, and rely on a well-designed merge to reconcile — instead of a central referee.** A G-Set is the smallest, clearest instance of that pattern.

---

## 11. Common Misconceptions

- **"CRDTs make replicas always identical."** No. They make replicas *eventually* identical, once updates have propagated. At any instant, two replicas can show different values. The guarantee is convergence, not instantaneous agreement.

- **"CRDTs eliminate conflicts."** They eliminate *conflict resolution that requires a human or a coordinator*. The conflict (two concurrent adds) still happens; the data type just has a built-in, deterministic, order-free way to absorb both. "Conflict-free" means "the merge always succeeds and converges," not "concurrent edits never occur."

- **"You can turn any data structure into a CRDT by writing a merge function."** Not any merge — only merges that are commutative, associative, and idempotent. A blind "set to X" slot has no such merge. Building CRDTs for rich types (lists, text, removable sets) is genuinely clever work.

- **"A G-Set is useless because you can't remove."** Grow-only is restrictive, but lots of real data is append-only: event logs, sets of "users who liked this," sets of seen message IDs (for deduplication). And the no-remove rule is *why* it's bulletproof. Removal needs cleverer designs (you'll meet 2P-Sets and OR-Sets later).

- **"Eventual consistency is just 'weak' / sloppy consistency."** It's a deliberate, principled trade: you give up instantaneous global agreement to gain availability and low latency during partitions. For carts and docs, that trade is usually *correct*, not lazy.

- **"CRDTs need clocks."** The *G-Set does not touch a clock at all.* Some other CRDTs (LWW-Register) use timestamps as a tiebreaker, but the foundational ones rely purely on the structure of the merge, which is exactly why they're robust against lying clocks.

---

## 12. Common Mistakes

- **Using a non-idempotent merge under at-least-once delivery.** If you "merge" by *adding* counts or *appending* to a list, a redelivered message double-counts. Networks redeliver. Your merge must be idempotent or you must deduplicate messages yourself.

- **Assuming messages arrive in order.** They don't. If your merge only works when updates arrive in send-order, you don't have a CRDT — you have a bug waiting for a slow network.

- **Reaching for wall-clock timestamps to "just pick the latest."** This is LWW, and it (a) needs clocks you can't trust and (b) discards data. Sometimes acceptable, but never your *default* and never silent.

- **Forgetting that merge must be defined for *every* pair of states.** Merge isn't only for "the nice case." It must produce a sensible, convergent result for any two states, including ones that overlap or are wildly different.

- **Confusing "converged" with "complete."** Replicas converge on the updates they've *seen*. If a replica hasn't received an update yet, it's not wrong — it's just behind. Keep gossiping.

- **Letting the set grow without bound and ignoring cost.** Merge is `O(size)` and a G-Set never shrinks. For huge or long-lived sets this matters (memory, network). Note it; richer CRDTs and compaction address it later. (Recall your [Big-O Notation](../../06-algorithmic-complexity/01-time-vs-space-complexity/junior.md) instincts here.)

---

## 13. Cheat Sheet

| Concept | One-liner |
| --- | --- |
| **Replica** | One independent copy of the data on one machine. |
| **Partition** | Replicas temporarily can't talk; edits happen blind. |
| **Eventual consistency** | If updates stop and replicas sync, they all converge. |
| **Convergence** | All replicas reach the same value. |
| **CRDT** | A type whose merge guarantees convergence — no coordinator, no locks. |
| **Merge must be** | **Commutative** (order of 2 ✗matters), **Associative** (grouping ✗matters), **Idempotent** (dupes ✗matter). |
| **Why all three** | Reordering + duplication from the network are mathematically erased. |
| **G-Set** | Grow-only set; only `add`; merge = **union**; the simplest CRDT. |
| **Why union works** | `∪` is commutative, associative, idempotent, and only ever grows. |
| **Why "set to X" fails** | Two blind overwrites conflict; no order-free merge exists → must discard. |
| **LWW** | Last-Write-Wins: timestamp tiebreak. Discards data; clocks lie. Use with care. |
| **CvRDT (preview)** | State-based CRDT: ship whole state, merge by union/join. |

Mental model to keep:

```
Single machine          ->  one truth, easy, but a single point of failure & slow far away
Many replicas + locks   ->  strong consistency, but coordination cost; dies in a partition
Many replicas + CRDT    ->  write locally, merge later; ALWAYS converges; no coordinator
                            merge MUST be commutative + associative + idempotent
                            G-Set = the canonical example (merge = union)
```

---

## 14. Summary

- The instant data has **more than one replica**, those replicas can be edited independently during a **network partition** and end up **disagreeing**. That's the replication problem.
- The naive fix, **Last-Write-Wins by wall clock**, is dangerous: clocks drift and lie, and LWW resolves conflicts by **discarding** data.
- **Strong consistency** avoids disagreement but needs a **coordinator/locks**, costing latency and availability — it stops working during partitions.
- **Eventual consistency** lets every replica write locally and reconcile later. Done carelessly it loses data; done with discipline it's powerful.
- **CRDTs** are that discipline. The core idea: a **merge** function that is **commutative**, **associative**, and **idempotent**, so replicas converge regardless of message **order** or **duplication** — with **no coordinator and no locks**.
- The **G-Set** is the canonical first CRDT: grow-only, `add` only, **merge = union**. We traced 3 replicas through reordered and duplicated gossip and watched them converge, then proved it empirically across 1000 random schedules in code.
- Union works because it has all three properties and only ever grows (conflict-free). A blind "set to X" slot has **no** order-free merge — which is why richer CRDTs must be cleverly *designed*.

**Where to go next:** the two ways replicas can actually *communicate* — shipping whole states vs shipping individual operations — in [State-based vs Operation-based CRDTs](../02-state-vs-operation-based-crdts/junior.md). Then watch the same three properties tame a *number* in [G-Counter / PN-Counter](../03-counters-g-pn/junior.md). For a deeper, more formal treatment of the semilattice math and richer types, continue to [middle](middle.md) and [senior](senior.md).

---

## 15. Further Reading

- **Within this roadmap**
  - [State-based vs Operation-based CRDTs](../02-state-vs-operation-based-crdts/junior.md) — the next topic; the two communication models.
  - [G-Counter / PN-Counter](../03-counters-g-pn/junior.md) — making a *counter* converge.
  - [Hash Tables](../../05-basic-data-structures/05-hash-tables/junior.md) — sets and maps, the substrate CRDTs are built on.
  - [Big-O Notation](../../06-algorithmic-complexity/01-time-vs-space-complexity/junior.md) — the cost lens for merge and state size.
  - This topic at the [middle](middle.md) and [senior](senior.md) tiers — semilattices, LWW done right, deletion, and real systems.

- **Foundational papers & talks (for the curious)**
  - Shapiro, Preguiça, Baquero, Zawirski — *"A Comprehensive Study of Convergent and Commutative Replicated Data Types"* (2011). The paper that named and catalogued CRDTs.
  - Shapiro et al. — *"Conflict-free Replicated Data Types"* (2011). The shorter companion introducing Strong Eventual Consistency.
  - DeCandia et al. — *"Dynamo: Amazon's Highly Available Key-value Store"* (2007). The mergeable shopping cart in the wild.
  - Marc Shapiro's talks on CRDTs — accessible video introductions to the same ideas.

- **Practical systems to poke at**
  - Riak (CRDT data types: counters, sets, maps), Redis (CRDT-based active-active in Redis Enterprise), and Automerge / Yjs (CRDT libraries for collaborative apps).
