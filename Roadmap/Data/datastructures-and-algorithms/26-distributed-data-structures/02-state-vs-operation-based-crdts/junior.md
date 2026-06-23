# State-based vs Operation-based CRDTs — Junior Level

> **Audience:** You've read the [CRDT Fundamentals](../01-crdt-fundamentals/junior.md) junior file. You already know what a *replica* is, why we want *eventual consistency*, how a **G-Set** (grow-only set) works, what a **merge** does, and the intuition that the "fix" for unordered, repeated, or lost messages is to make our combine operation **commutative**, **associative**, and **idempotent**.
>
> **Read time:** ~35 minutes
>
> **Focus:** There are exactly **two** ways to keep replicas in sync. You can mail a **photocopy of your whole notebook** every time (ship the full *state*, let the receiver *merge*), or you can mail a **postcard for each individual edit** (ship each *operation*, let the receiver *apply* it). This file is about the difference, the trade-offs, and how to pick one.

---

## Table of Contents

1. [Recap: the convergence problem](#1-recap-the-convergence-problem)
2. [The two strategies, as a vivid analogy](#2-the-two-strategies-as-a-vivid-analogy)
3. [State-based CRDTs (CvRDT): ship the whole state](#3-state-based-crdts-cvrdt-ship-the-whole-state)
4. [Operation-based CRDTs (CmRDT): ship each operation](#4-operation-based-crdts-cmrdt-ship-each-operation)
5. [Side-by-side worked example: one Set, both ways](#5-side-by-side-worked-example-one-set-both-ways)
6. [The delivery-guarantee trade-off](#6-the-delivery-guarantee-trade-off)
7. [Runnable code: prove it](#7-runnable-code-prove-it)
8. [When to choose which](#8-when-to-choose-which)
9. [Misconceptions](#9-misconceptions)
10. [Mistakes](#10-mistakes)
11. [Cheat sheet](#11-cheat-sheet)
12. [Summary](#12-summary)
13. [Further reading](#13-further-reading)

---

## 1. Recap: the convergence problem

A CRDT (Conflict-free Replicated Data Type) is a data structure that lives on **many machines at once**. Each machine holds its own copy — a **replica** — and edits it locally without asking permission from anybody else. No central server, no lock, no "please wait for the leader." Replicas talk to each other over a network that is **slow, unreliable, and out of order**: messages arrive late, arrive twice, or never arrive.

The promise of a CRDT is **strong eventual convergence**:

> If two replicas have received the **same set of updates** — in *any* order, with *any* number of duplicates — they hold **exactly the same value**. No conflict resolution code, no merge dialogs, no "last write wins" guesswork. The math guarantees it.

In the fundamentals file you saw why this works for a **G-Set** (grow-only set). Two replicas reconcile by taking the **union** of their sets. Union has three magic properties:

| Property | Meaning | Why it saves us |
|---|---|---|
| **Commutative** | `A ∪ B = B ∪ A` | Order of messages doesn't matter |
| **Associative** | `(A ∪ B) ∪ C = A ∪ (B ∪ C)` | Grouping/batching doesn't matter |
| **Idempotent** | `A ∪ A = A` | Re-delivering the same message does no harm |

Those three properties are the whole game. **Everything in this file is about *where* you put that math** — into the *merge* of full states, or into the *operations* you broadcast. That single decision splits all CRDTs into two families:

- **State-based** CRDTs, also called **CvRDTs** ("Convergent Replicated Data Types").
- **Operation-based** CRDTs, also called **CmRDTs** ("Commutative Replicated Data Types").

Same goal — converge. Two completely different shipping strategies to get there.

---

## 2. The two strategies, as a vivid analogy

Imagine you and two friends each keep a **shopping notebook**. You all add items independently, and you want everyone's notebook to eventually list the same items. You can only sync by **mailing letters**. The post office is awful: it loses letters, sometimes delivers the same letter twice, and delivers them in a random order.

### Strategy A — Mail a photocopy of the *whole notebook* (state-based)

Every so often, you photocopy your **entire current notebook** and mail it to a friend. When a friend receives your photocopy, they lay it next to their own notebook and **merge**: any item on either page goes into the combined list. They throw your photocopy away afterward; the merged notebook is the new truth.

Notice what this survives:

- **Lost letter?** No problem. Your *next* photocopy still contains everything (the whole notebook), so the missing items show up later anyway.
- **Duplicate letter?** No problem. Merging the same photocopy twice gives the same result — items already present just stay present. (That's **idempotence**.)
- **Out of order?** No problem. "Merge whatever you've got" doesn't care which photocopy arrived first. (**Commutative + associative**.)

The cost: a photocopy of the **whole notebook** is **big and gets bigger** as the list grows. You're re-sending items the friend already has, every single time.

### Strategy B — Mail a *postcard per edit* (operation-based)

Instead of the whole notebook, every time you add **one** item you scribble a postcard: *"Add: milk."* You mail that single postcard to each friend. When a friend gets the postcard, they perform the edit: they write "milk" into their notebook.

Notice what this needs:

- The postcards are **tiny** — one edit each, no matter how big the notebook gets. Cheap to mail.
- **But**: if the post office *loses* the "Add: milk" postcard, that friend **never** learns about milk. There's no later message that re-includes it (unlike the photocopy). So the network **must not lose anything**.
- And: if the post office *duplicates* a postcard that says *"Add 1 to the running total,"* a naive friend applies "+1" **twice** and their total is now **wrong**. So either the network must **never duplicate**, or the operation must be carefully designed so that re-applying it is harmless.

The cost has flipped. Postcards are cheap, but you've pushed the burden onto the **post office**: it must deliver **every** postcard, **exactly once**, and (as we'll see) sometimes **in the right order**.

### The one-sentence summary

> **State-based** moves the hard guarantees into the **merge function** (the receiver's job) and asks **little** of the network.
> **Operation-based** moves the hard guarantees onto the **network** (deliver each op once, in causal order) and asks **little** of the message size.

Hold that sentence. The rest of this file unpacks it.

---

## 3. State-based CRDTs (CvRDT): ship the whole state

### 3.1 The mechanism

A state-based CRDT has three pieces:

1. A **value** (the replica's current full state — e.g. the whole set `{a, b, c}`).
2. A **query** to read it.
3. A **merge** function (often written `⊔`, called the **join**) that takes *two* full states and produces a *combined* state.

Syncing is dead simple. Periodically — on a timer, or when you reconnect — a replica sends its **entire state** to a peer. The peer calls `merge(my_state, received_state)` and adopts the result. That's it. There is no "apply the edit" step; there is only "merge two complete pictures."

### 3.2 What `merge` must be

The merge function must compute a **least upper bound** over a structure called a **join-semilattice**. That's a fancy name, but for a junior the practical checklist is exactly the three properties from §1:

```
merge(a, b) == merge(b, a)                       # commutative
merge(merge(a, b), c) == merge(a, merge(b, c))   # associative
merge(a, a) == a                                  # idempotent
```

Concrete merge functions you already half-know:

| CRDT | State | `merge` is... |
|---|---|---|
| **G-Set** (grow-only set) | a set | **union** (`∪`) |
| **G-Counter** (grow-only counter) | a map `replica → count` | **per-key max** then sum |
| **LWW-Register** (last-write-wins) | `(value, timestamp)` | **keep the larger timestamp** |

In every case, `merge` only ever moves the state **"upward"** — it never loses information, and applying it again changes nothing.

### 3.3 Why it is bullet-proof against a flaky network

Because `merge` is commutative, associative, **and idempotent**, the receiver does not care:

- **in what order** states arrive,
- **how many times** the same state arrives,
- **whether some states were dropped** entirely (a later, fuller state will carry the missing info).

A dropped message is "self-healing": the next full state you send already contains everything the dropped one did, plus more. You never need acknowledgements, never need to retransmit a *specific* message, never need de-duplication logic. The merge math absorbs all of it.

### 3.4 The downside: message size

You ship the **entire state** every sync. If your set has a million elements, every sync is a million-element message — even if only one element changed since last time. That is wasteful on bandwidth and CPU.

> **This is the central tension.** State-based is *robust* but *fat*. There's a whole family of optimizations called **delta-state CRDTs** (δ-CRDTs) that send only the *changed part* of the state while keeping the merge math intact — that's a middle/senior topic. See [middle](middle.md) for delta-state. For now, learn the simple, fat version first.

---

## 4. Operation-based CRDTs (CmRDT): ship each operation

### 4.1 The mechanism

An operation-based CRDT splits each update into two halves:

1. **Prepare** (local): the replica computes a small **operation message** describing the change — e.g. `("add", "milk")` or `("increment", 1)`. It applies the change to itself immediately, then **broadcasts** the operation to all other replicas.
2. **Effect** (remote): each peer receives the operation message and **applies** it to its own state.

The message on the wire is **just the operation**, not the state. Tiny and constant-size, regardless of how big the data has grown.

### 4.2 What the operations must be

For convergence, the **concurrent** operations must **commute**: if two replicas apply the same set of operations, possibly in different orders, they must reach the same state. "Add milk" and "Add eggs" commute — order doesn't matter, you end up with both. That's why this family is called **Commutative** Replicated Data Types.

But there's a sharper requirement, and it's the whole point of this file:

> Operation-based CRDTs assume the messaging layer delivers **every operation exactly once**, and (for many of them) **in causal order**.

Let's pull those two assumptions apart.

### 4.3 Exactly once — or idempotent ops

If the network **delivers an operation twice** and the operation is **not** idempotent, the replica applies it twice and gets the **wrong answer**.

- `("add", "milk")` to a set is **naturally idempotent** — adding milk twice still yields one milk. Duplicate delivery is harmless. 
- `("increment", 1)` on a counter is **NOT** idempotent — applying +1 twice gives +2. **Duplicate delivery corrupts the count.** This is the canonical operation-based bug, and we'll *watch it happen* in the code in §7.

So operation-based CRDTs require **one** of:

- the **delivery layer** guarantees exactly-once (deduplication via message IDs), **or**
- every operation is designed to be **idempotent** so duplicates don't matter.

### 4.4 Causal order — why "no loss / no reorder" isn't enough

Some operations only make sense **after** another. Classic example, an OR-Set (observed-remove set):

1. Replica A does `add(x)` → broadcasts op₁.
2. Replica A later does `remove(x)` → broadcasts op₂.

If replica B receives `remove(x)` **before** `add(x)`, what should it do? Remove an `x` it has never seen? The `remove` **causally depends on** the `add`. To converge correctly, the delivery layer must respect **causal order**: deliver op₁ before op₂ on every replica, because op₂ "happened after" op₁ on the same replica. (Independent ops from *different* replicas can still arrive in any order — only the causally-linked chain must be ordered.)

This is **causal delivery**, and it's a real cost: you need extra machinery (version vectors, sequence numbers, a reliable causal broadcast layer) to provide it. State-based needs none of this.

### 4.5 The upside: tiny messages

In exchange for those delivery guarantees, you ship **only the delta of intent** — one operation — never the whole state. For large data structures that change a little at a time, this is dramatically cheaper than re-shipping megabytes of state.

> **Summary of the swap:** operation-based makes messages cheap by making the **network** do more work (reliable, dedup'd, causal delivery). State-based makes the **network** trivial by making each **message** fat.

---

## 5. Side-by-side worked example: one Set, both ways

Let's track the **same** scenario through **both** designs and literally write down the bytes on the wire. Three replicas: **R1, R2, R3**. Each starts empty. The edits performed locally:

- R1: `add("a")`
- R2: `add("b")`
- R3: `add("c")`

The convergence target is the set `{a, b, c}` on **all three** replicas.

### 5.1 State-based version

Each replica holds the **whole set** and syncs by sending its whole set; the receiver takes the **union**.

| Step | Action | Message on wire | R1 state | R2 state | R3 state |
|---|---|---|---|---|---|
| 0 | start | — | `{}` | `{}` | `{}` |
| 1 | R1 add a | — | `{a}` | `{}` | `{}` |
| 2 | R2 add b | — | `{a}` | `{b}` | `{}` |
| 3 | R3 add c | — | `{a}` | `{b}` | `{c}` |
| 4 | R1 → R2 sends `{a}` | `{a}` | `{a}` | `{a,b}` | `{c}` |
| 5 | R2 → R3 sends `{a,b}` | `{a,b}` | `{a}` | `{a,b}` | `{a,b,c}` |
| 6 | R3 → R1 sends `{a,b,c}` | `{a,b,c}` | `{a,b,c}` | `{a,b}` | `{a,b,c}` |
| 7 | R3 → R2 sends `{a,b,c}` | `{a,b,c}` | `{a,b,c}` | `{a,b,c}` | `{a,b,c}` |

All three converge to `{a,b,c}`. **Now duplicate step 6** — say R3 → R1 fires twice. R1 computes `{a,b,c} ∪ {a,b,c} = {a,b,c}`. **No change.** Idempotence absorbed the duplicate. Now **drop** step 4 entirely. R2 simply never learns `a` from *that* message — but step 7 (or any later full sync) carries `a` anyway, so R2 still converges. **Self-healing.**

Notice the message at step 6 is `{a,b,c}` — the **whole set**. As the set grows to thousands of items, every sync message grows with it. That's the fat-message cost in action.

### 5.2 Operation-based version

Each replica broadcasts a **postcard per add**, and peers **apply** it. The broadcast must reach the other two replicas exactly once.

| Step | Action | Message broadcast | R1 state | R2 state | R3 state |
|---|---|---|---|---|---|
| 0 | start | — | `{}` | `{}` | `{}` |
| 1 | R1 add a | `("add","a")` → R2,R3 | `{a}` | `{}` | `{}` |
| 2 | R2 add b | `("add","b")` → R1,R3 | `{a}` | `{b}` | `{}` |
| 3 | R3 add c | `("add","c")` → R1,R2 | `{a}` | `{b}` | `{c}` |
| 4 | R2,R3 apply `("add","a")` | — | `{a}` | `{a,b}` | `{a,c}` |
| 5 | R1,R3 apply `("add","b")` | — | `{a,b}` | `{a,b}` | `{a,b,c}` |
| 6 | R1,R2 apply `("add","c")` | — | `{a,b,c}` | `{a,b,c}` | `{a,b,c}` |

Same final answer `{a,b,c}`. **Message sizes:** each postcard is ONE element — `("add","a")` — no matter how big the set gets. That's the win.

But now break the network. **Drop** the `("add","a")` broadcast to R2. R2 **never** learns about `a` — there's no later message that re-includes it. R2 ends at `{b,c}`, **permanently diverged**. Operation-based *needs* reliable delivery; the data structure has no way to self-heal a lost op.

For a **set**, *duplicating* `("add","a")` is harmless (idempotent add). But swap the set for a **counter** with `("increment", 1)` and a duplicate becomes a silent off-by-one. We prove exactly that next.

---

## 6. The delivery-guarantee trade-off

This is the table to memorize. It is the heart of the topic.

| Network misbehavior | State-based (CvRDT) | Operation-based (CmRDT) |
|---|---|---|
| **Message lost** | Safe — next full state re-carries the info (self-healing) | **Broken** — that update is lost forever unless the layer retransmits |
| **Message duplicated** | Safe — merge is idempotent (`a ⊔ a = a`) | Safe **only if** the op is idempotent (e.g. set-add); **broken** for non-idempotent ops (e.g. counter +1) |
| **Messages reordered** | Safe — merge is commutative & associative | Safe for independent ops; **broken** if causally-dependent ops arrive out of order |
| **Required from the network** | Almost nothing — "eventually deliver *some* recent state" | **Reliable, exactly-once, causal** delivery (or idempotent ops + dedup) |
| **Required from the data type** | A merge that is commutative + associative + idempotent | Operations whose concurrent effects commute |
| **Message size** | Big — the whole state (mitigated by delta-CRDTs) | Small — one operation |
| **Where the hard work lives** | In the **merge function** | In the **messaging layer** |

Read the table top to bottom and you'll see the symmetry: **state-based pays in bandwidth so the network can be dumb; operation-based pays in network guarantees so the messages can be tiny.** Neither is "better" — they're two settings on the same dial.

---

## 7. Runnable code: prove it

Let's make the trade-off concrete. We'll build the **same grow-set** both ways and show that:

1. **State-based survives duplicate delivery** unscathed.
2. A **naive operation-based counter double-counts** a redelivered increment.

### 7.1 Python (primary)

```python
"""
state_vs_op.py
Demonstrates the core difference between state-based (CvRDT) and
operation-based (CmRDT) CRDTs, and why a non-idempotent op breaks
under duplicate delivery.
"""

# ----------------------------------------------------------------------
# 1) STATE-BASED grow-only Set (CvRDT)
#    merge = set union  (commutative + associative + idempotent)
# ----------------------------------------------------------------------
class StateGSet:
    def __init__(self):
        self.state = set()          # the FULL value

    def add(self, element):
        self.state.add(element)     # purely local

    def value(self):
        return set(self.state)

    def merge(self, other_state):
        # Receive a peer's WHOLE state and join via union.
        # Union is idempotent: merging the same state twice = no change.
        self.state |= other_state


# ----------------------------------------------------------------------
# 2) OPERATION-BASED grow-only Set (CmRDT)
#    op = ("add", element);  applying twice is harmless (idempotent op)
# ----------------------------------------------------------------------
class OpGSet:
    def __init__(self):
        self.state = set()

    def prepare_add(self, element):
        # Returns the operation to broadcast; applies locally too.
        self.state.add(element)
        return ("add", element)

    def apply(self, op):
        kind, element = op
        if kind == "add":
            self.state.add(element)   # add is idempotent -> dup is safe

    def value(self):
        return set(self.state)


# ----------------------------------------------------------------------
# 3) NAIVE OPERATION-BASED Counter (CmRDT) -- THE BUG
#    op = ("inc", 1);  applying twice = +2.  NOT idempotent.
# ----------------------------------------------------------------------
class NaiveOpCounter:
    def __init__(self):
        self.total = 0

    def prepare_inc(self, amount=1):
        self.total += amount
        return ("inc", amount)

    def apply(self, op):
        kind, amount = op
        if kind == "inc":
            self.total += amount      # NO dedup -> duplicate => double count!

    def value(self):
        return self.total


def line(title):
    print("\n" + title)
    print("-" * len(title))


if __name__ == "__main__":
    # ---- DEMO A: state-based survives a DUPLICATED full-state message ----
    line("A) State-based G-Set under DUPLICATE delivery")
    r1, r2 = StateGSet(), StateGSet()
    r1.add("a")
    r2.add("b")

    snapshot_from_r1 = r1.value()      # {a}
    r2.merge(snapshot_from_r1)         # deliver once  -> {a, b}
    r2.merge(snapshot_from_r1)         # deliver AGAIN -> still {a, b}
    r2.merge(snapshot_from_r1)         # and AGAIN     -> still {a, b}

    print("r2 after 3x duplicate delivery:", sorted(r2.value()))
    assert r2.value() == {"a", "b"}, "state-based must be duplicate-proof"
    print("OK: idempotent merge absorbed every duplicate.")

    # ---- DEMO B: op-based SET is also fine (add is idempotent) ----
    line("B) Operation-based G-Set under DUPLICATE delivery")
    s1, s2 = OpGSet(), OpGSet()
    op = s1.prepare_add("x")           # s1 = {x}, broadcast ("add","x")
    s2.apply(op)                       # deliver once  -> {x}
    s2.apply(op)                       # deliver AGAIN -> still {x}
    print("s2 after duplicate add:", sorted(s2.value()))
    assert s2.value() == {"x"}
    print("OK: add() is idempotent, so the duplicate did no harm.")

    # ---- DEMO C: NAIVE op-based COUNTER double-counts the duplicate ----
    line("C) Naive operation-based Counter under DUPLICATE delivery")
    c1, c2 = NaiveOpCounter(), NaiveOpCounter()
    inc = c1.prepare_inc(1)            # c1 = 1, broadcast ("inc", 1)
    c2.apply(inc)                      # deliver once  -> 1   (correct)
    c2.apply(inc)                      # deliver AGAIN -> 2   (WRONG!)
    print("c2 after duplicate increment:", c2.value(), "(expected 1)")
    assert c2.value() == 2, "demonstrating the BUG: it really is 2"
    print("BUG REPRODUCED: +1 applied twice => total is 2, not 1.")

    print("\nLesson: state-based tolerates a flaky network for free;")
    print("naive op-based needs exactly-once (or idempotent ops) or it lies.")
```

**Expected output:**

```
A) State-based G-Set under DUPLICATE delivery
---------------------------------------------
r2 after 3x duplicate delivery: ['a', 'b']
OK: idempotent merge absorbed every duplicate.

B) Operation-based G-Set under DUPLICATE delivery
-------------------------------------------------
s2 after duplicate add: ['x']
OK: add() is idempotent, so the duplicate did no harm.

C) Naive operation-based Counter under DUPLICATE delivery
---------------------------------------------------------
c2 after duplicate increment: 2 (expected 1)
BUG REPRODUCED: +1 applied twice => total is 2, not 1.

Lesson: state-based tolerates a flaky network for free;
naive op-based needs exactly-once (or idempotent ops) or it lies.
```

The lesson lands hard: the **set** survives duplicates in both designs, but the **counter** — a non-idempotent operation — gets corrupted the instant the network duplicates a message. The fix (a state-based counter, the **G-Counter**, which merges by per-replica max and is immune to all of this) is exactly the subject of [G-Counter / PN-Counter](../03-counters-g-pn/junior.md).

### 7.2 Go (short)

```go
package main

import (
	"fmt"
	"sort"
)

// --- State-based G-Set: merge = union, idempotent ---
type StateGSet struct{ state map[string]bool }

func NewStateGSet() *StateGSet { return &StateGSet{state: map[string]bool{}} }
func (s *StateGSet) Add(e string) { s.state[e] = true }
func (s *StateGSet) Merge(other map[string]bool) {
	for e := range other { // union; re-merging the same set changes nothing
		s.state[e] = true
	}
}
func (s *StateGSet) Snapshot() map[string]bool {
	cp := map[string]bool{}
	for e := range s.state {
		cp[e] = true
	}
	return cp
}
func (s *StateGSet) Value() []string {
	out := []string{}
	for e := range s.state {
		out = append(out, e)
	}
	sort.Strings(out)
	return out
}

// --- Naive op-based counter: ("inc",1) is NOT idempotent ---
type NaiveOpCounter struct{ total int }

func (c *NaiveOpCounter) PrepareInc(n int) int { c.total += n; return n }
func (c *NaiveOpCounter) Apply(n int)          { c.total += n } // no dedup -> bug

func main() {
	// State-based survives duplicate delivery.
	r1, r2 := NewStateGSet(), NewStateGSet()
	r1.Add("a")
	r2.Add("b")
	snap := r1.Snapshot()
	r2.Merge(snap)
	r2.Merge(snap) // duplicate
	r2.Merge(snap) // duplicate
	fmt.Println("state-based r2:", r2.Value()) // [a b]

	// Naive op-based counter double-counts a duplicate.
	var c1, c2 NaiveOpCounter
	inc := c1.PrepareInc(1)
	c2.Apply(inc) // 1 (correct)
	c2.Apply(inc) // 2 (WRONG)
	fmt.Println("naive op counter c2:", c2.total, "(expected 1) <- BUG")
}
```

**Output:**

```
state-based r2: [a b]
naive op counter c2: 2 (expected 1) <- BUG
```

### 7.3 Java (short)

```java
import java.util.*;

public class StateVsOp {

    // State-based G-Set: merge = union (idempotent)
    static class StateGSet {
        final Set<String> state = new HashSet<>();
        void add(String e) { state.add(e); }
        Set<String> snapshot() { return new HashSet<>(state); }
        void merge(Set<String> other) { state.addAll(other); } // union
    }

    // Naive op-based counter: ("inc",1) is NOT idempotent
    static class NaiveOpCounter {
        int total = 0;
        int prepareInc(int n) { total += n; return n; }
        void apply(int n) { total += n; } // no dedup -> bug
    }

    public static void main(String[] args) {
        StateGSet r1 = new StateGSet(), r2 = new StateGSet();
        r1.add("a");
        r2.add("b");
        Set<String> snap = r1.snapshot();
        r2.merge(snap);
        r2.merge(snap); // duplicate
        r2.merge(snap); // duplicate
        System.out.println("state-based r2: " + new TreeSet<>(r2.state)); // [a, b]

        NaiveOpCounter c1 = new NaiveOpCounter(), c2 = new NaiveOpCounter();
        int inc = c1.prepareInc(1);
        c2.apply(inc); // 1 correct
        c2.apply(inc); // 2 WRONG
        System.out.println("naive op counter c2: " + c2.total + " (expected 1) <- BUG");
    }
}
```

**Output:**

```
state-based r2: [a, b]
naive op counter c2: 2 (expected 1) <- BUG
```

All three languages tell the identical story: **the merge of full states is duplicate-proof; a non-idempotent operation is not, unless the network guarantees exactly-once delivery.**

---

## 8. When to choose which

Use this as a decision aid, not a law. Most real systems blend both ideas.

### Pick **state-based (CvRDT)** when...

- The **network is unreliable** and you don't want to build a reliable causal-broadcast layer. State-based "just works" over UDP, gossip, anti-entropy, intermittent connectivity, and partition-and-reconnect.
- Replicas **sync occasionally** rather than streaming every keystroke (e.g. mobile devices that come online, sync, go offline).
- The **state is small** or you can afford a **delta-state** optimization (so the fat-message problem disappears).
- You want the **simplest possible mental model**: "send what I have, merge what I get."
- Examples: gossip-based databases (Riak, Cassandra-style hinted handoff ideas), config replication, presence/heartbeat sets.

### Pick **operation-based (CmRDT)** when...

- You **already have** a reliable, ordered messaging layer — a broker like Kafka, an event log, a TCP-backed reliable causal broadcast — so the delivery guarantees come "for free."
- Updates are **frequent and small** relative to total state, so re-shipping the whole state would be wasteful (think: a collaborative text editor where each keystroke is one tiny op, but the document is huge).
- You need to capture **rich intent** in an operation (e.g. "insert character at position p between elements x and y") that a pure state merge can't express as cleanly.
- Examples: collaborative editors (the operations *are* the edits), event-sourced systems, anything fronted by an append-only log.

### The honest middle ground

In practice many systems use **delta-state CRDTs** — a hybrid that ships small "delta" states (like operations) but keeps the merge math of state-based (so duplicates and reorders are still safe). It's the best of both worlds and is the natural next step in [middle](middle.md). If you remember one rule of thumb:

> **No reliable-ordered transport? Use state-based (or delta-state).** **Have a reliable-ordered log already? Operation-based is cheaper.**

---

## 9. Misconceptions

**"Operation-based is always more efficient, so it's always better."**
Smaller *messages*, yes — but you pay for a reliable, exactly-once, causally-ordered delivery layer. That infrastructure has real cost and real failure modes. State-based trades bandwidth for *needing none of that*. "Efficient" depends on what's scarce: bandwidth or delivery guarantees.

**"State-based wastes bandwidth, so nobody uses it in production."**
Plenty of production systems are state-based precisely *because* the network is hostile. And **delta-state CRDTs** keep the state-based robustness while shrinking messages to operation-like size. The naive "ship the whole state every time" version is a teaching model, not the only option.

**"If I switch from a set to a counter, the operation-based version still 'just works.'"**
No — and §7 proves it. Set-add is idempotent, so duplicates are harmless. Counter-increment is **not** idempotent, so a single duplicated message corrupts the total. The data type's operations determine whether duplicate delivery is safe.

**"State-based needs to ship state and op-based ships ops, but otherwise they're the same data structure."**
They often *aren't* even the same internal representation. A state-based set might store the raw set; an operation-based register might store extra metadata (timestamps, version vectors) needed to make ops commute. The design choice ripples into the structure, not just the wire format.

**"Causal order means total order — every replica sees every op in the exact same sequence."**
No. Causal order only constrains operations that *depend* on each other (a `remove` after its `add`). Independent operations from different replicas may still arrive in any order; that's fine because they commute.

**"Idempotent operation = I never need delivery guarantees."**
Idempotence saves you from **duplicates**, not from **loss** or **causal reordering**. A lost op is gone forever in operation-based regardless of idempotence; a `remove` arriving before its `add` is still a problem. Idempotence covers one of three hazards.

---

## 10. Mistakes

**Applying a non-idempotent op without deduplication.** The §7 counter bug. If your transport can ever redeliver, either dedup by operation ID or make the op idempotent (or go state-based).

**Forgetting that operation-based has no self-healing.** With state-based, a dropped message is fixed by the next full sync. With operation-based, a dropped op is **permanently** missing unless your transport retransmits it. Don't assume "it'll catch up later" — it won't, on its own.

**Shipping the whole state on every keystroke.** That's state-based applied to a high-frequency workload — it works but burns bandwidth. For chatty workloads, reach for delta-state or operation-based.

**Writing a "merge" that isn't idempotent.** If `merge(a, a) != a`, your state-based CRDT is broken the first time a message is duplicated. Always test `merge(x, x) == x`. (Easy mistake: a "merge" that *sums* counts instead of taking the *max* — summing double-counts on re-merge.)

**Assuming reorder-safety implies loss-safety for operation-based.** Commuting ops handle *reorder*, not *loss* or *duplicate*. Three separate hazards; check each one for your data type.

**Mixing the two designs on the wire without a plan.** If replica A sends full states and replica B sends operations and they expect to merge directly, you'll get chaos. Pick one protocol per system (or a deliberate, documented hybrid like delta-state).

---

## 11. Cheat sheet

```
                 STATE-BASED (CvRDT)            OPERATION-BASED (CmRDT)
                 "mail a photocopy"             "mail a postcard per edit"
--------------------------------------------------------------------------
What you send    the WHOLE state                ONE operation
Receiver does    merge(local, received)         apply(op)
Merge/op must be commutative + associative      concurrent ops commute
                 + IDEMPOTENT                    (apply order of independent
                                                  ops doesn't matter)
Message size     BIG (grows with state)         TINY (constant per op)
Lost message     SELF-HEALS (later state        LOST FOREVER (no later
                  re-carries it)                  message re-includes it)
Duplicate msg    SAFE (idempotent merge)        SAFE only if op is idempotent
Reordered msg    SAFE (commutative join)        SAFE if no causal dependency
Network must     deliver SOME recent state      deliver EVERY op, EXACTLY
                  (very weak guarantee)          ONCE, in CAUSAL order
Hard work lives  in the MERGE function          in the MESSAGING layer
Good when        network is flaky / sync rarely you already have a reliable
                                                  ordered log; edits frequent
Optimization     delta-state CRDTs (δ)          batching / causal broadcast
```

**One-line rule of thumb:**
> No reliable-ordered transport? Go **state-based** (or delta-state). Already have a reliable, ordered log? **Operation-based** ships less.

---

## 12. Summary

- Every CRDT is kept in sync by **one of two strategies**: ship the **full state** and **merge** (state-based, **CvRDT**), or broadcast each **operation** and **apply** it (operation-based, **CmRDT**).
- **State-based** asks **almost nothing of the network**. Because `merge` is commutative, associative, and **idempotent**, it tolerates **loss** (self-heals via the next full state), **duplicates** (`a ⊔ a = a`), and **reordering**. The price is **big messages** — it ships the whole state every time. Delta-state CRDTs fix that.
- **Operation-based** ships **tiny messages** (one op each) but pushes the burden onto the **network**: it needs **exactly-once** delivery (or **idempotent** ops) and often **causal order**. A **lost** op is gone for good; a **duplicated** non-idempotent op (like counter +1) silently **corrupts** the value.
- The §7 demo proves it: a state-based set shrugs off triple-duplicate delivery, an op-based set survives because `add` is idempotent, but a **naive op-based counter double-counts** the very first duplicate.
- **Choose by what's scarce.** Hostile/unreliable network → state-based (or delta-state). Already have a reliable ordered log + frequent small edits → operation-based.
- Keep the analogy: **photocopy of the whole notebook** vs **a postcard per edit**. The whole file is that one picture.

Next: go to [middle](middle.md) for delta-state CRDTs and the formal semilattice/commutativity treatment, then [senior](senior.md) for real-world transport design. To see a counter built the *right* (state-based, duplicate-proof) way, read [G-Counter / PN-Counter](../03-counters-g-pn/junior.md).

---

## 13. Further reading

- **Shapiro, Preguiça, Baquero, Zawirski — "A Comprehensive Study of Convergent and Commutative Replicated Data Types" (INRIA RR-7506, 2011).** The foundational paper that defines CvRDTs and CmRDTs and proves their equivalence. Dense, but the §2–3 definitions are exactly this file's two families.
- **Shapiro et al. — "Conflict-free Replicated Data Types" (SSS 2011).** The shorter conference version; a gentler entry point.
- **Almeida, Shoker, Baquero — "Delta State Replicated Data Types" (2018).** The "best of both worlds" hybrid mentioned throughout — small messages with state-based robustness.
- **Marc Shapiro's CRDT talks / "CRDTs Illustrated" community write-ups.** Good visual intuition for merge vs apply.
- **Local cross-links:** [CRDT Fundamentals](../01-crdt-fundamentals/junior.md) · [middle](middle.md) · [senior](senior.md) · [G-Counter / PN-Counter](../03-counters-g-pn/junior.md)
