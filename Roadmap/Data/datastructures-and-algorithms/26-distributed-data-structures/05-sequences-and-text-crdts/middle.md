# Sequence & Text CRDTs — Middle Level

> **You are here:** you already understand from the [junior](junior.md) tier *why* a shared text document cannot be modelled as a list indexed by integers — indices shift under concurrent edits, and "insert at position 5" means different things on different replicas. The fix was to give every character a **stable identifier** that never changes once assigned. This tier is about the *families* of algorithms that turn that idea into a working, convergent sequence: **RGA, Logoot, LSEQ, Treedoc, and WOOT**. By the end you will know how each one assigns identifiers, how it orders concurrent inserts deterministically, and why some of them produce garbled text (interleaving) while others do not.

---

## Table of Contents

1. [Recap: what a stable position identifier must guarantee](#1-recap-what-a-stable-position-identifier-must-guarantee)
2. [Two families of sequence CRDTs](#2-two-families-of-sequence-crdts)
3. [RGA in depth](#3-rga-in-depth)
4. [Logoot and LSEQ: dense identifier allocation](#4-logoot-and-lseq-dense-identifier-allocation)
5. [WOOT and Treedoc (the historical roots)](#5-woot-and-treedoc-the-historical-roots)
6. [The interleaving anomaly](#6-the-interleaving-anomaly)
7. [Identifier growth and rebalancing tradeoffs](#7-identifier-growth-and-rebalancing-tradeoffs)
8. [Code: RGA and a Logoot-style sequence](#8-code-rga-and-a-logoot-style-sequence)
9. [Misconceptions](#9-misconceptions)
10. [Mistakes](#10-mistakes)
11. [Cheat sheet](#11-cheat-sheet)
12. [Summary](#12-summary)
13. [Further reading](#13-further-reading)

---

## 1. Recap: what a stable position identifier must guarantee

A **sequence CRDT** stores an ordered list of elements (usually characters or text spans) and lets many replicas insert and delete concurrently, with **no coordination**, such that every replica that has seen the same set of operations converges to the **same ordering**. The central trick — established in the junior tier and shared by *every* algorithm in this topic — is that we never store elements by integer index. Instead, each element carries an immutable **position identifier** (often shortened to *position*, *pos id*, or *PID*).

For these identifiers to behave like positions in a document, they must satisfy three properties.

### 1.1 Total order

Any two distinct identifiers must be comparable: for identifiers `a` and `b`, exactly one of `a < b`, `a > b` holds (they are never "equal but distinct"). The visible document is simply *all live identifiers sorted ascending*. Because the comparison function is the same code on every replica, sorting the same set of identifiers always yields the same string. Convergence of the *ordering* reduces to: do all replicas hold the same set of `(identifier, value)` pairs, and is the comparator total and deterministic?

> Total order is what lets us forget about "indices" entirely. The reader's cursor position is a UI concern; the *truth* is the sorted set of identifiers.

### 1.2 Dense / "always room between"

Given any two adjacent identifiers `p` and `q` with `p < q`, it must always be possible to mint a **new identifier `r` strictly between them**: `p < r < q`. This is the property that integers famously *lack* — there is no integer strictly between `4` and `5`. A sequence CRDT therefore needs an identifier space that is **dense**: rationals, variable-length digit strings, tree paths, or fractional indices all work. Whenever a user types a character between two existing ones, the algorithm allocates a fresh identifier in that open interval.

### 1.3 Global uniqueness (tie-break by replica)

Two replicas editing offline may both try to allocate an identifier in the *same* gap. If they independently produced the *same* identifier, we would have a collision: two different characters claiming one position, with no way to order them. To prevent this, every identifier embeds the **replica ID** (and usually a per-replica counter or logical clock) of whoever created it. Two replicas in the same gap produce identifiers that *differ in the replica component*, so the comparator can always break the tie:

```
compare(a, b):
    compare position digits first
    if positions tie at some level, compare embedded replicaId
    if still tied, compare the per-replica counter / clock
```

The replica ID is the final, guaranteed tie-breaker. Because replica IDs are globally unique (assigned at session start, e.g. a UUID), no two distinct elements can ever share a full identifier.

These three properties — **total, dense, unique** — are the contract. The families below are simply *different concrete encodings* of an identifier space that satisfies the contract.

---

## 2. Two families of sequence CRDTs

There are two broad strategies for encoding "where does this element sit". They differ in **what an element stores** to fix its position.

### 2.1 Identifier / dense-order schemes

> **Members:** Logoot, LSEQ, Treedoc, "fractional indexing" (the lightweight web-app variant).

Each element carries a **self-contained position identifier** drawn from a dense, totally-ordered space. The identifier *is* the position — comparing two elements never requires looking at any other element. Insert means "compute a fresh identifier that sorts between my left and right neighbours' identifiers, then store `(id, value)`." Delete means "remove the entry" (sometimes with a tombstone, sometimes garbage-collected when causally safe, because the identifier of a deleted element is not needed by future inserts — they reference *positions in the dense space*, not *other elements*).

The defining trait: **positions are absolute coordinates**. Like latitude/longitude, you can compare two characters' positions without knowing anything else in the document.

- **Pro:** O(log n) insert with a sorted structure (tree/skip-list keyed by identifier); deletes can often be fully garbage-collected; no need to keep deleted elements around to anchor others.
- **Con:** identifiers **grow in length** as you keep inserting in the same region (every insert in a tight gap needs *more digits* to fit between neighbours). This is the **identifier bloat** problem that LSEQ specifically attacks.

### 2.2 Linked / reference schemes

> **Members:** WOOT, RGA (and conceptually the "Causal Trees" / Yjs family).

Each element does **not** carry an absolute coordinate. Instead it stores a **reference to the neighbour(s) it was inserted relative to** — typically "I was inserted *after* element X" (RGA) or "I sit *between* X and Y" (WOOT). The final order is produced by **traversing** these references and applying a deterministic **tie-break rule** whenever several elements claim the same anchor.

The defining trait: **positions are relative**. An element's place is meaningful only in the context of the elements it points at, so those anchor elements **cannot simply be deleted** — they become **tombstones** (kept as invisible markers) so later traversal still works.

- **Pro:** identifiers are **fixed, small, and never grow** — typically just `(replicaId, counter)`, a Lamport-style timestamp. No bloat, ever.
- **Con:** deleted elements must be retained as tombstones (memory grows with edit history unless you garbage-collect carefully); order is computed by traversal rather than by sorting absolute keys.

A compact way to hold the contrast:

| | Identifier schemes (Logoot/LSEQ/Treedoc) | Linked schemes (RGA/WOOT) |
|---|---|---|
| What an element stores | absolute dense position id | small id + reference to anchor neighbour(s) |
| Order computed by | sorting positions | traversal + tie-break |
| Identifier size | **grows** with edits in a region | **constant** |
| Delete | remove entry (often GC-able) | **tombstone required** |
| Comparison cost | compare two ids in isolation | needs document structure |

Keep this two-family split in mind; everything below is a specific point in one of these two design spaces. (For the broader CRDT contract — commutativity, idempotence, associativity of merge — see [CRDT Fundamentals](../01-crdt-fundamentals/middle.md), and for how delete-then-readd and tombstones behave in the simpler unordered case, see [Set CRDTs](../04-sets-or-set-lww/middle.md).)

---

## 3. RGA in depth

**RGA** (Replicated Growable Array, Roh et al. 2011) is the most widely deployed linked-scheme sequence CRDT — it underlies several production collaborative editors. It is worth studying in depth because it is small, fast, and *provably* convergent, and its tie-break rule is the clearest illustration of "deterministic ordering of concurrent inserts".

### 3.1 The data model

RGA models the document as a **linked list of nodes**, conceptually anchored at a virtual **head** (the start-of-document sentinel). Each node holds:

- `id` — a **timestamp**: a pair `(counter, replicaId)`. The counter is a Lamport-style logical clock; `replicaId` breaks ties. Timestamps are **totally ordered**: compare `counter` first, then `replicaId`.
- `value` — the character (or span), or `None`/`⊥` if the node has been deleted (it then becomes a **tombstone**).
- `afterId` — the `id` of the node this element was inserted **immediately after** (the *anchor*). The head has a sentinel id, e.g. `(0, "")`.

### 3.2 The three operations

Every edit is expressed as one of three operations, broadcast to all replicas:

1. **`insertAfter(afterId, newId, value)`** — create a node with `newId`, anchored after the node `afterId`, carrying `value`. `newId` is freshly minted: the replica bumps its local counter past every counter it has seen, then pairs it with its own `replicaId`.
2. **`delete(targetId)`** — find the node with `targetId` and clear its value, turning it into a tombstone. The node stays in the list so that anything anchored after it still has a valid anchor.
3. **(merge)** — apply a remote operation. Insert and delete are designed to be **commutative and idempotent**: applying the same op twice does nothing the second time; applying ops in different orders yields the same list.

### 3.3 The tie-break rule (the heart of RGA)

The interesting case is **concurrent inserts after the same anchor**. Suppose replicas A and B both, independently, do `insertAfter(X, …)` — both want to place a new character right after `X`. After merging, both new nodes are anchored to `X`. In what order do they appear?

RGA's rule:

> Among all nodes sharing the same `afterId` anchor, place them in **descending order of their `id`** (timestamp). The node with the **larger** `(counter, replicaId)` comes **first** (closest to the anchor).

So if A's node has id `(7, "A")` and B's has `(7, "B")`, then `(7,"B") > (7,"A")` (same counter, `"B" > "A"`), so **B's character is placed first**, then A's. *Both replicas compute this identically* because both have both ids and both run the same comparison.

The full ordering algorithm to *materialise* the visible string is a single left-to-right walk:

```
to_sequence(rga):
    result = []
    walk the list starting from head
    at each anchor, among children sharing that anchor,
        emit them in DESCENDING id order;
        recurse into each child's own children before moving on
    skip tombstoned (value == None) nodes from the visible output
    return result
```

In practice RGA is implemented either as an actual linked structure or as a flat array kept in the canonical order, with a hash map `id -> node` for O(1) lookup of anchors.

### 3.4 Why the order is deterministic on every replica

Let us argue convergence precisely — this is the kind of reasoning a middle-tier engineer should be able to reproduce.

**Claim.** Any two replicas that have applied the *same set* of insert/delete operations produce the *same visible string*.

**Argument.**

1. **The set of nodes is identical.** Insert ops are uniquely identified by their `newId` (globally unique via replica id), and applying an insert is idempotent (re-applying the same `newId` is a no-op). So after both replicas process the same op set, they hold exactly the same set of `(id, afterId, value)` nodes. Delete only flips a value to tombstone and is likewise idempotent, so the tombstone status of each node is also identical.

2. **The order is a pure function of that set.** The visible order is produced by `to_sequence`, which depends only on (a) each node's `afterId` and (b) the total order on ids. Both are fixed data carried by the nodes — no replica-local state, no wall-clock, no arrival order is consulted. Specifically, "descending id among siblings sharing an anchor" is a deterministic sort with a total comparator (ids are totally ordered), so there are no ambiguous ties.

3. **Therefore both replicas sort the identical node set with the identical comparator and skip the identical tombstones**, yielding the identical string. ∎

The subtle and important point in step 2: RGA never relies on *the order operations arrived in*. Two replicas can receive A's and B's inserts in opposite orders; both still place them by descending id. This is exactly why RGA is a CRDT and not just "last writer wins by arrival time."

### 3.5 A worked concurrent example

Start: both replicas hold `head`. Replica A inserts `"X"` after head, giving it id `(1,"A")`. This is broadcast and both converge to `X`.

Now A and B both insert after `(1,"A")` concurrently:

- A inserts `"a"` with id `(2,"A")`, anchor `(1,"A")`.
- B inserts `"b"` with id `(2,"B")`, anchor `(1,"A")`.

Both nodes share anchor `(1,"A")`. Descending id order: `(2,"B") > (2,"A")`, so `"b"` comes first. **Every replica** materialises `X b a` → `"Xba"`. There is no scenario where one replica shows `"Xab"` and another `"Xba"`; the comparator is total and identical.

If A then deletes `"a"`, the node `(2,"A")` becomes a tombstone. The visible string is `"Xb"`, but the tombstone remains so that if some replica had inserted `"z"` after `(2,"A")`, that `"z"` still has a valid anchor.

---

## 4. Logoot and LSEQ: dense identifier allocation

Now the other family. **Logoot** (Weiss, Urso, Molli 2009) and **LSEQ** (Nédelec et al. 2013) are identifier schemes: each element carries a self-contained, variable-length **position identifier** in a dense, totally-ordered space. They differ chiefly in *how* they choose new identifiers to keep them from growing too fast.

### 4.1 The identifier as a path of digits

Picture identifiers as numbers in a positional system, but written as a **list of "digits"** rather than a single number. A position id is a sequence of components, each component being `(digit, replicaId, clock)`; comparison is lexicographic over components, with `digit` compared first and `replicaId`/`clock` as tie-breakers.

A natural mental model: identifiers are like **paths in an infinitely branching tree**, or like **decimal fractions written digit by digit**. The id `[2]` sits before `[5]`. Need something between them? Use `[3]` or `[4]`. Need something between `[2]` and `[3]` where no whole digit fits? *Extend the path*: `[2, 5]` means "child 5 of 2", and `[2] < [2,5] < [3]`. This is exactly the density property: you can always go one level deeper to find room.

```
between([2], [5])  -> [3]            # room at the same level
between([2], [3])  -> [2, 5]         # no room -> descend a level
between([2,5],[2,6]) -> [2,5,5]      # descend again
```

Because each component also carries the creating replica's id, two replicas allocating in the same gap pick digit-equal but replica-distinct ids, and the tie-break keeps them ordered and unique.

### 4.2 Boundary strategy and the bloat problem

The danger is **identifier bloat**: if you always pick the digit *exactly in the middle*, then under heavy sequential typing in one region the identifiers get one level deeper roughly every few characters, so ids grow without bound — and id length is the dominant cost in these schemes (every keystroke stores and ships a longer id).

Logoot mitigates this with a **boundary strategy**: when allocating between two ids, it does *not* pick the exact midpoint. It picks a **random** digit in the open interval, biased to stay within a window of size `boundary` from one end. Randomisation spreads concurrent allocations apart (lowering the chance of needing yet another level) and avoids worst-case clustering, but on its own it still degrades when the user types in a consistent direction.

### 4.3 LSEQ: fighting right-skew and left-skew

Here is the key insight that **LSEQ** adds. Real editing is *not* random — people overwhelmingly type **left to right**, repeatedly inserting at the *end* of what they just typed. With a fixed allocation strategy this produces a pathological skew:

- A **"boundary+"** strategy (allocate near the *low* end of the gap) handles left-to-right appends well but blows up under right-to-left insertion.
- A **"boundary−"** strategy (allocate near the *high* end) is the mirror image: good for prepending, terrible for appending.

LSEQ's answer has two parts:

1. **Exponential base growth.** Each new tree *level* has a **larger** branching factor than the one above — the base doubles per depth (e.g. level 0 has base `2^a`, level 1 has `2^(a+1)`, …). Deeper levels therefore offer *exponentially more* slots, so even sustained insertion in one region needs far fewer additional levels. This keeps the *average* identifier length close to logarithmic in the number of inserts rather than linear.

2. **Per-level random strategy choice (boundary+ / boundary−).** For each tree level, LSEQ *randomly but deterministically* picks whether that level uses boundary+ or boundary− (the choice is fixed once per level and shared via the structure). Because a document is unlikely to be edited with the same directional skew at *every* level, mixing the two strategies means no single editing pattern can hit the worst case at every level. This is precisely the **"right-skew vs left-skew problem"** LSEQ solves: instead of betting on one direction, it hedges across levels.

The net effect: LSEQ keeps identifiers short under realistic, directional human editing, where plain Logoot would bloat. Both still belong to the identifier family — the difference is *allocation policy*, not data model.

### 4.4 Delete in identifier schemes

Because positions are absolute, a deleted element's identifier is not needed to anchor future inserts (future inserts reference *positions*, not *elements*). So Logoot/LSEQ can often **remove** the entry outright, or keep a lightweight tombstone only long enough to ensure that a concurrent insert "between X and Y" still sees the boundary it needs. This is a real advantage over RGA/WOOT, whose tombstones must live as long as anything might still anchor to them. (Production systems still keep some tombstone/causal metadata to handle delete-vs-concurrent-insert races safely — the same delete-wins / add-wins tension you saw with [Set CRDTs](../04-sets-or-set-lww/middle.md).)

---

## 5. WOOT and Treedoc (the historical roots)

Two earlier designs are worth knowing because they shaped the field and you will meet them in papers and interviews.

### 5.1 WOOT (Oster et al. 2006)

**WOOT** (WithOut Operational Transformation) was one of the first true sequence CRDTs and is the conceptual ancestor of RGA. It is a **linked scheme**: each character `c` stores **two** references, `prev(c)` and `next(c)` — the ids of the characters it was inserted **between**. Beginning and end of the document are sentinels `cb` (begin) and `ce` (end).

To place a newly inserted character among others that were concurrently inserted in the same `(prev, next)` window, WOOT runs a recursive ordering procedure: it looks at all characters whose own `prev`/`next` fall *within* the current window, and orders the new character against them by comparing **ids** (which include a site identifier), descending the window recursively. The result is deterministic and convergent — the same idea RGA later streamlined into "anchor only on `prev`, sort siblings by descending id."

WOOT **never physically deletes**: deletion sets a `visible = false` flag, so every character (visible or not) remains forever as a tombstone to keep `prev`/`next` references valid. This unbounded tombstone growth, plus the relatively heavy recursive integration, is why WOOT is mostly of historical and pedagogical interest now — RGA does the same job with a lighter rule.

### 5.2 Treedoc (Préguiça et al. 2009)

**Treedoc** is an **identifier scheme** built on an explicit **binary tree**. Each element sits at a node of an (infinite) binary tree; its identifier is the **path** from the root (a string of left/right bits). The in-order traversal of the tree yields the document order, so the path *is* a dense, totally-ordered position — `left` of a node sorts before it, `right` after. Inserting between two elements means creating a child node on the appropriate side; concurrent inserts at the same spot are disambiguated by attaching a **disambiguator** (replica id) to the node.

Treedoc's distinctive feature — and its distinctive headache — is **rebalancing**: like any binary tree, it can become deep and unbalanced under skewed editing, so the authors proposed a *flatten/rebalance* operation that rewrites all identifiers into a balanced shape. But rebalancing **changes identifiers**, which must be coordinated across replicas (it is not a pure CRDT merge) — typically via a consensus round or a designated "core" set of replicas. That coordination requirement is exactly what later designs (LSEQ's exponential base, RGA's non-growing ids) tried to avoid. Treedoc is the cautionary tale that motivates "make identifiers that don't need rebalancing."

> **One-line map:** WOOT → simplified into RGA (linked family). Treedoc → its rebalancing pain motivated Logoot/LSEQ's allocation strategies (identifier family).

---

## 6. The interleaving anomaly

Now the most surprising failure mode in this whole topic — and the one that separates a naïve implementation from a correct one.

### 6.1 What interleaving is

Suppose the document is empty (just `head`). Two users, offline, type whole words at the *same starting position*:

- User A types `"HELLO"` (five inserts, each after the previous A-character).
- User B types `"WORLD"` (five inserts, each after the previous B-character).

Both words begin anchored at the same place. After merging, a *good* algorithm yields either `"HELLOWORLD"` or `"WORLDHELLO"` — one whole word, then the other. That is what a human intends. A *bad* algorithm produces something like:

```
H W E O L R L L O D    ->  "HWEOLRLLOD"
```

The two words are **shuffled character by character**. This is the **interleaving anomaly**: concurrent runs of insertions at the same location get braided together into nonsense.

### 6.2 Why it happens

Interleaving arises when the algorithm orders concurrent characters by a rule that **does not respect the contiguity of a run**. The classic trigger: ordering purely by a per-character timestamp or random digit, without considering that each character is part of a *sequence* anchored to its predecessor.

In the identifier family, plain **Logoot/LSEQ are susceptible**: each character independently picks an id in the gap. If A's and B's per-character ids interleave numerically (which random allocation makes likely), the sorted order braids the words. Treedoc and other position-only schemes share this exposure.

In the linked family, the picture is subtler. **RGA** anchors each character to its *predecessor in the same run*, and orders siblings sharing an anchor by descending id. Because each character of `"HELLO"` after the first is anchored to the previous `"HELLO"` character (not to `head`), the only point of competition is the *first* character of each word at the shared anchor — once `H` vs `W` is decided, the rest of each word follows its own chain. This **reduces** interleaving dramatically. RGA can still interleave in some multi-character concurrent scenarios, but it is far more resistant than position-only schemes for the common "two people type a word at the same spot" case.

### 6.3 Kleppmann's analysis

Martin Kleppmann and colleagues (*"Interleaving anomalies in collaborative text editors"*, 2019) formalised this. Their key contributions for a middle-tier reader:

- They gave a precise definition of interleaving and showed that **many published sequence CRDTs interleave** under some concurrent-editing pattern — including Logoot, LSEQ, and even RGA in certain cases (RGA can interleave when *both* directions of insertion are involved).
- They distinguished **forward interleaving** (left-to-right runs braiding) from **backward interleaving** and showed algorithms can be immune to one but not the other.
- They argued that interleaving is a genuine *correctness/UX* concern, not just aesthetics: braided text is confusing and can change meaning, and "it still converges" is not a sufficient bar — *all replicas agreeing on a garbled string is still a garbled string*.
- This motivated later designs (e.g. the **Fugue** algorithm, 2023, and aspects of Yjs's positioning) that provably avoid interleaving by ensuring a concurrent run stays contiguous.

> **Takeaway:** "convergent" ≠ "correct-looking." Interleaving is the canonical example of a CRDT that converges to a result no human wanted. When evaluating a sequence CRDT, always ask: *what happens when two people type a word at the same spot?*

---

## 7. Identifier growth and rebalancing tradeoffs

A consolidated comparison of the five algorithms along the axes a middle engineer actually cares about:

| Algorithm | Family | Identifier size over time | Tombstones | Concurrent-insert order rule | Interleaving resistance | Rebalancing |
|---|---|---|---|---|---|---|
| **RGA** | linked | **constant** `(counter, replica)` | required for deletes | siblings sharing anchor: **descending id** | good (run-aware), not perfect | none needed |
| **WOOT** | linked | constant `(site, clock)` | **all chars forever** | recursive between `prev`/`next`, by id | moderate | none, but heavy integration |
| **Logoot** | identifier | **grows** (mid-point bloat) | minimal (GC-able) | sort absolute position ids | **poor** (braids easily) | none, but ids bloat |
| **LSEQ** | identifier | grows **slowly** (exp. base + bound± hedge) | minimal | sort absolute position ids | poor (same as Logoot) | none (avoided by design) |
| **Treedoc** | identifier | grows with tree depth/skew | minimal | tree path + disambiguator | poor | **needs coordinated rebalance** |

How to read the tradeoff:

- **Constant ids (RGA/WOOT)** buy you predictable per-element cost and good interleaving behaviour, at the price of **tombstones** you must store and eventually garbage-collect.
- **Dense ids (Logoot/LSEQ/Treedoc)** buy you GC-friendly deletes and absolute comparison, at the price of **growing identifiers** and **worse interleaving**. LSEQ's exponential base is the best in-family answer to id growth; Treedoc's rebalance is the worst (it breaks the pure-CRDT property).
- If you are choosing today: **RGA-family** designs (RGA, Causal Trees, Yjs/YATA) dominate production editors precisely because constant ids + good interleaving + GC-able tombstones is the most practical mix.

---

## 8. Code: RGA and a Logoot-style sequence

Two self-contained, runnable implementations follow, each with a multi-replica concurrent-edit simulation that **asserts** identical convergence, and each demonstrating a **tombstone** and an **interleaving** case. All code converges; run it to see.

### 8.1 Python — RGA with insert-after / delete / merge

```python
"""RGA (Replicated Growable Array) — a linked-scheme sequence CRDT.

Each node has:
  id      = (counter, replica_id)   -- totally ordered Lamport timestamp
  after   = id of the anchor it was inserted after (head = (0, ""))
  value   = the character, or None for a tombstone (deleted)

Convergence rule: among nodes sharing the same `after` anchor,
emit them in DESCENDING id order. Same node set + same comparator
on every replica => identical visible string.
"""
from dataclasses import dataclass, field
from typing import Optional

HEAD = (0, "")  # sentinel anchor for "start of document"


@dataclass
class Node:
    id: tuple        # (counter, replica_id)
    after: tuple     # anchor id
    value: Optional[str]  # None => tombstone


@dataclass
class RGA:
    replica_id: str
    counter: int = 0
    # id -> Node ; we keep every node (live and tombstoned)
    nodes: dict = field(default_factory=dict)

    def _next_id(self, observed_counter: int = 0) -> tuple:
        # Lamport: advance past everything we've seen, then tag with replica.
        self.counter = max(self.counter, observed_counter) + 1
        return (self.counter, self.replica_id)

    # ---- local operations: return the op to broadcast ----
    def insert_after(self, after: tuple, value: str) -> dict:
        new_id = self._next_id(after[0])
        op = {"type": "insert", "id": new_id, "after": after, "value": value}
        self.apply(op)
        return op

    def delete(self, target: tuple) -> dict:
        op = {"type": "delete", "id": target}
        self.apply(op)
        return op

    # ---- merge: applying a remote op is idempotent & commutative ----
    def apply(self, op: dict) -> None:
        if op["type"] == "insert":
            nid = op["id"]
            if nid not in self.nodes:                 # idempotent
                self.counter = max(self.counter, nid[0])
                self.nodes[nid] = Node(nid, op["after"], op["value"])
        elif op["type"] == "delete":
            n = self.nodes.get(op["id"])
            if n is not None:
                n.value = None                        # tombstone (idempotent)

    # ---- materialise the visible string ----
    def to_string(self) -> str:
        # children[anchor] = list of node ids anchored after `anchor`
        children: dict = {}
        for node in self.nodes.values():
            children.setdefault(node.after, []).append(node.id)
        out = []

        def walk(anchor):
            # DESCENDING id order among siblings sharing this anchor
            for nid in sorted(children.get(anchor, []), reverse=True):
                node = self.nodes[nid]
                if node.value is not None:            # skip tombstones
                    out.append(node.value)
                walk(nid)                             # then this node's children

        walk(HEAD)
        return "".join(out)


def merge_all(*replicas: RGA, ops: list):
    """Deliver every op to every replica, in arbitrary order, idempotently."""
    for r in replicas:
        for op in ops:
            r.apply(op)


# ---------- Demo 1: concurrent insert after the same anchor ----------
A = RGA("A")
B = RGA("B")

op_x = A.insert_after(HEAD, "X")     # A types "X"
B.apply(op_x)                        # both now have "X"
x_id = op_x["id"]

# A and B BOTH insert after X, concurrently (no sync between them)
op_a = A.insert_after(x_id, "a")     # id (2, "A")
op_b = B.insert_after(x_id, "b")     # id (2, "B")

# now exchange and merge in DIFFERENT orders on each replica
A.apply(op_b)
B.apply(op_a)

assert A.to_string() == B.to_string(), "RGA must converge"
print("Demo1 A:", A.to_string())     # -> "Xba"   ((2,"B") > (2,"A"))
print("Demo1 B:", B.to_string())     # -> "Xba"


# ---------- Demo 2: tombstone via delete ----------
op_del = A.delete(op_a["id"])        # delete "a"
B.apply(op_del)
assert A.to_string() == B.to_string() == "Xb"
# node still present as tombstone so anchors after it stay valid:
assert A.nodes[op_a["id"]].value is None
print("Demo2 (after delete):", A.to_string())   # -> "Xb"


# ---------- Demo 3: interleaving stress test (two words, same spot) ----------
def type_word(rga: RGA, word: str, anchor: tuple):
    """Type a word left-to-right; each char anchored to the previous one."""
    ops = []
    cur = anchor
    for ch in word:
        op = rga.insert_after(cur, ch)
        ops.append(op)
        cur = op["id"]          # next char anchors to this one (a RUN)
    return ops

P = RGA("P")
Q = RGA("Q")
ops_p = type_word(P, "HELLO", HEAD)   # P types HELLO at start
ops_q = type_word(Q, "WORLD", HEAD)   # Q types WORLD at start, concurrently

all_ops = ops_p + ops_q
merge_all(P, Q, ops=all_ops)
assert P.to_string() == Q.to_string()
# Because each word is a RUN anchored to its own predecessor, RGA keeps the
# words contiguous: the only competition is H vs W at HEAD. Result is one
# whole word then the other (NOT braided "HWEOLRLLOD").
print("Demo3 (RGA, run-aware):", P.to_string())   # -> "WORLDHELLO" or "HELLOWORLD"
assert P.to_string() in ("WORLDHELLO", "HELLOWORLD")
print("All RGA assertions passed.")
```

Running this prints converged strings and passes every assertion. Demo 3 is the crucial one: because each character anchors to its *run predecessor*, RGA keeps `HELLO` and `WORLD` intact — it does **not** braid them.

### 8.2 Python — a Logoot/fractional-style sequence (and its interleaving)

```python
"""Logoot-style identifier scheme: each element carries an absolute,
dense, totally-ordered position id. A position is a list of "components".
Each component is (digit, replica_id) so concurrent allocations in the
same gap stay unique and ordered.

Comparison is lexicographic over components: digit first, then replica_id.
Between two positions we descend a level when no whole digit fits.

This deliberately shows the INTERLEAVING weakness of position-only schemes.
"""
from dataclasses import dataclass, field

BASE = 16  # digits 0..15 per level

def cmp_pos(p, q):
    for (da, ra), (db, rb) in zip(p, q):
        if da != db: return -1 if da < db else 1
        if ra != rb: return -1 if ra < rb else 1
    # shorter prefix sorts first
    if len(p) != len(q): return -1 if len(p) < len(q) else 1
    return 0

def pos_between(p, q, replica_id):
    """Return a NEW position strictly between p and q (p < q)."""
    out = []
    i = 0
    while True:
        da = p[i][0] if i < len(p) else 0
        db = q[i][0] if i < len(q) else BASE
        if db - da > 1:
            mid = (da + db) // 2          # room at this level
            out.append((mid, replica_id))
            return out
        # no room: take p's digit (or 0) and descend a level
        out.append((da, p[i][1] if i < len(p) else replica_id))
        i += 1


@dataclass
class Logoot:
    replica_id: str
    # list of (position, value); position is a list of (digit, replica) comps
    items: list = field(default_factory=list)

    def _sorted(self):
        import functools
        return sorted(self.items, key=functools.cmp_to_key(
            lambda a, b: cmp_pos(a[0], b[0])))

    def insert_between(self, left, right, value):
        pos = pos_between(left, right, self.replica_id)
        op = {"pos": pos, "value": value}
        self.apply(op)
        return op

    def apply(self, op):
        # idempotent: positions are globally unique, dedupe on position
        if not any(cmp_pos(p, op["pos"]) == 0 for p, _ in self.items):
            self.items.append((op["pos"], op["value"]))

    def to_string(self):
        return "".join(v for _, v in self._sorted())


LO = [(0, "")]      # virtual low boundary
HI = [(BASE, "")]   # virtual high boundary


def type_word_logoot(doc, word, left, right):
    """Each char independently picks a position in (left, right)."""
    ops = []
    for ch in word:
        op = doc.insert_between(left, right, ch)
        ops.append(op)
        left = op["pos"]   # keep moving right within the same window
    return ops


# concurrent: two replicas type words in the SAME (LO, HI) window
R = Logoot("R")
S = Logoot("S")
ops_r = type_word_logoot(R, "HELLO", LO, HI)
ops_s = type_word_logoot(S, "WORLD", LO, HI)

for d in (R, S):
    for op in ops_r + ops_s:
        d.apply(op)

assert R.to_string() == S.to_string(), "Logoot must still CONVERGE"
print("Logoot converged string:", R.to_string())
# It converges, but position-only ordering can BRAID the two words:
# the result may look like "HWEOLRLLOD"-style interleaving rather than a
# clean "HELLOWORLD". Convergence != correct-looking text.
print("(Note: identical on both replicas, but may be interleaved.)")
```

Notice the contrast: the Logoot version *converges* (both replicas print the same string) but can **interleave**, because each character picks an absolute position independently of its run. The RGA version stays contiguous. This is the interleaving anomaly made concrete in 30 lines.

### 8.3 JavaScript — compact RGA convergence check

```javascript
// RGA in JS: nodes keyed by "counter:replica"; siblings sorted DESC by id.
const HEAD = "0:";
const cmpId = (a, b) => {            // descending: larger id first
  const [ca, ra] = a.split(":"); const [cb, rb] = b.split(":");
  if (+ca !== +cb) return +cb - +ca;
  return rb < ra ? -1 : rb > ra ? 1 : 0;
};

class RGA {
  constructor(rid) { this.rid = rid; this.ctr = 0; this.nodes = new Map(); }
  nextId(seen = 0) { this.ctr = Math.max(this.ctr, seen) + 1; return `${this.ctr}:${this.rid}`; }
  insertAfter(after, value) {
    const id = this.nextId(+after.split(":")[0]);
    const op = { type: "ins", id, after, value }; this.apply(op); return op;
  }
  delete(id) { const op = { type: "del", id }; this.apply(op); return op; }
  apply(op) {
    if (op.type === "ins") {
      if (!this.nodes.has(op.id)) {
        this.ctr = Math.max(this.ctr, +op.id.split(":")[0]);
        this.nodes.set(op.id, { id: op.id, after: op.after, value: op.value });
      }
    } else { const n = this.nodes.get(op.id); if (n) n.value = null; } // tombstone
  }
  toString() {
    const children = new Map();
    for (const n of this.nodes.values())
      (children.get(n.after) ?? children.set(n.after, []).get(n.after)).push(n.id);
    let out = "";
    const walk = (anchor) => {
      for (const id of (children.get(anchor) ?? []).sort(cmpId)) {
        const n = this.nodes.get(id);
        if (n.value !== null) out += n.value;
        walk(id);
      }
    };
    walk(HEAD); return out;
  }
}

const A = new RGA("A"), B = new RGA("B");
const ox = A.insertAfter(HEAD, "X"); B.apply(ox);
const oa = A.insertAfter(ox.id, "a");   // (2,A)
const ob = B.insertAfter(ox.id, "b");   // (2,B)
A.apply(ob); B.apply(oa);               // exchange, opposite orders
console.assert(A.toString() === B.toString(), "must converge");
console.log("JS RGA:", A.toString());   // -> "Xba"

const od = A.delete(oa.id); B.apply(od); // tombstone "a"
console.assert(A.toString() === B.toString() && A.toString() === "Xb");
console.log("JS RGA after delete:", A.toString()); // -> "Xb"
```

### 8.4 Go — RGA convergence check

```go
package main

import (
	"fmt"
	"sort"
)

type ID struct {
	Ctr int
	Rep string
}

// descending: larger id comes first among siblings
func less(a, b ID) bool {
	if a.Ctr != b.Ctr {
		return a.Ctr > b.Ctr
	}
	return a.Rep > b.Rep
}

type Node struct {
	ID    ID
	After ID
	Value *string // nil => tombstone
}

type RGA struct {
	rep   string
	ctr   int
	nodes map[ID]*Node
}

var HEAD = ID{0, ""}

func NewRGA(rep string) *RGA { return &RGA{rep: rep, nodes: map[ID]*Node{}} }

func (r *RGA) nextID(seen int) ID {
	if seen > r.ctr {
		r.ctr = seen
	}
	r.ctr++
	return ID{r.ctr, r.rep}
}

type Op struct {
	Kind  string // "ins" | "del"
	ID    ID
	After ID
	Value string
}

func (r *RGA) InsertAfter(after ID, v string) Op {
	id := r.nextID(after.Ctr)
	op := Op{"ins", id, after, v}
	r.Apply(op)
	return op
}

func (r *RGA) Delete(id ID) Op {
	op := Op{Kind: "del", ID: id}
	r.Apply(op)
	return op
}

func (r *RGA) Apply(op Op) {
	switch op.Kind {
	case "ins":
		if _, ok := r.nodes[op.ID]; !ok {
			if op.ID.Ctr > r.ctr {
				r.ctr = op.ID.Ctr
			}
			v := op.Value
			r.nodes[op.ID] = &Node{op.ID, op.After, &v}
		}
	case "del":
		if n, ok := r.nodes[op.ID]; ok {
			n.Value = nil // tombstone
		}
	}
}

func (r *RGA) String() string {
	children := map[ID][]ID{}
	for _, n := range r.nodes {
		children[n.After] = append(children[n.After], n.ID)
	}
	var out []byte
	var walk func(anchor ID)
	walk = func(anchor ID) {
		kids := children[anchor]
		sort.Slice(kids, func(i, j int) bool { return less(kids[i], kids[j]) })
		for _, id := range kids {
			n := r.nodes[id]
			if n.Value != nil {
				out = append(out, *n.Value...)
			}
			walk(id)
		}
	}
	walk(HEAD)
	return string(out)
}

func main() {
	A, B := NewRGA("A"), NewRGA("B")
	ox := A.InsertAfter(HEAD, "X")
	B.Apply(ox)

	oa := A.InsertAfter(ox.ID, "a") // (2,A)
	ob := B.InsertAfter(ox.ID, "b") // (2,B)
	A.Apply(ob)
	B.Apply(oa) // opposite delivery orders

	if A.String() != B.String() {
		panic("must converge")
	}
	fmt.Println("Go RGA:", A.String()) // -> Xba

	od := A.Delete(oa.ID)
	B.Apply(od)
	fmt.Println("Go RGA after delete:", A.String()) // -> Xb (tombstone kept)
}
```

All four implementations share the same backbone: **constant ids**, **descending-id sibling order**, **tombstones on delete**, and a **traversal** that converges regardless of operation arrival order.

---

## 9. Misconceptions

**"All sequence CRDTs use the same kind of identifier."** No. There are two families: **linked schemes** (RGA, WOOT) store a small fixed id plus a *reference* to a neighbour; **identifier schemes** (Logoot, LSEQ, Treedoc) store a *self-contained, variable-length* absolute position. They compare positions in completely different ways.

**"If it converges, the text is correct."** False, and this is the single most important correction at this tier. Interleaving produces a string that *all replicas agree on* yet that no human wanted (`"HWEOLRLLOD"`). Convergence is necessary but not sufficient; interleaving resistance is a separate, real property.

**"Tombstones are a bug / wasteful mistake."** In linked schemes (RGA, WOOT) tombstones are *load-bearing*: deleting a node physically would orphan anything anchored after it. They are the price of constant-size ids. The engineering task is to **garbage-collect** them safely once no concurrent insert can still reference them, not to avoid them.

**"Logoot identifiers are just numbers that always have room."** They have room *mathematically*, but **practically they grow** every time you must descend a level, and id length is the dominant storage/bandwidth cost. "Always room" and "cheap" are different claims; LSEQ exists precisely because plain midpoint allocation is not cheap.

**"RGA can never interleave."** RGA strongly *resists* interleaving for same-direction runs (each char anchors to its predecessor), but Kleppmann showed it can still interleave under mixed-direction concurrent insertion. "Better than Logoot" is not "immune."

**"Treedoc is just a binary-tree Logoot, so pick whichever."** Treedoc needs a **coordinated rebalance** to keep paths short — that step is *not* a pure CRDT merge and requires consensus, which is exactly the coordination CRDTs are supposed to avoid. That difference is decisive.

---

## 10. Mistakes

**Sorting siblings ascending instead of descending in RGA.** The convergence rule is *descending* id among nodes sharing an anchor. Flip it and you still converge — but to a *different* order than RGA's spec, and you may break interoperability with other RGA implementations and worsen interleaving. Pick the spec's direction and keep it everywhere.

**Physically deleting a node in a linked scheme.** If you `delete(id)` by removing the node from the map, any node whose `after == id` loses its anchor and either disappears or floats to the wrong place. Always **tombstone** (clear the value, keep the node).

**Forgetting to advance the Lamport counter on remote inserts.** If you only bump the counter for *local* inserts, two replicas can mint colliding `(counter, replica)`… actually the replica id saves uniqueness, but you can still produce out-of-order causality and surprising sibling ordering. On every applied insert, do `ctr = max(ctr, incoming.counter)`.

**Using the exact midpoint in Logoot.** Always allocating the mathematical midpoint maximises identifier growth under sequential typing. Use a **boundary strategy** (Logoot) or **LSEQ's per-level boundary± + exponential base**, otherwise ids bloat and every keystroke gets more expensive.

**Anchoring an entire pasted/typed run at the same anchor.** If every character of a word anchors to the *same* spot (instead of each to its predecessor), you reintroduce the worst interleaving even in RGA. Anchor each character to the *previous character of the run*; that contiguity is what keeps words intact.

**Assuming non-unique ids "rarely collide, so it's fine."** Two offline replicas in the same gap will, eventually, collide if ids omit the replica component. There is no "rarely" in a CRDT — uniqueness must be guaranteed, not probable. Always embed the replica id.

**Comparing positions of different lengths incorrectly.** In identifier schemes, a shorter prefix and a longer one need a defined order (shorter prefix sorts first, then tie-break by trailing components). Getting this wrong makes the comparator non-total and breaks convergence subtly.

---

## 11. Cheat sheet

```
THE CONTRACT (every sequence CRDT id must be):
  total     - any two ids comparable, exactly one ordering
  dense     - always an id strictly between any two
  unique    - embed replicaId (+ clock) as final tie-break

TWO FAMILIES
  linked      RGA, WOOT      element stores small id + neighbour reference
                             order = traversal + tie-break
                             ids CONSTANT ; deletes need TOMBSTONES
  identifier  Logoot, LSEQ,  element stores absolute dense position
              Treedoc        order = sort positions
                             ids GROW ; deletes often GC-able

RGA RULES
  node = (id=(counter,replica), after=anchorId, value | None)
  insert: insertAfter(anchor, newId, value)
  delete: clear value -> TOMBSTONE (keep node!)
  ORDER : siblings sharing an anchor -> DESCENDING id
  converges because: same node set + total comparator + skip tombstones

LOGOOT / LSEQ
  position = list of (digit, replica[, clock]) components, lexicographic
  between(p,q): pick digit in gap; if none, DESCEND a level
  Logoot: boundary strategy (random within window) -> still bloats
  LSEQ : exponential base per level + per-level boundary+/boundary-
         -> hedges left-skew vs right-skew, keeps ids short

INTERLEAVING
  symptom : "HELLO" + "WORLD" -> "HWEOLRLLOD"
  causes  : ordering ignores run contiguity
  worst   : Logoot/LSEQ/Treedoc (position-only)
  better  : RGA (anchor to run predecessor) — resistant, not immune
  rule    : convergent != correct-looking  (Kleppmann 2019)

PICK
  production default -> RGA-family (constant ids, good interleaving, GC tombstones)
  avoid Treedoc unless you can afford coordinated rebalancing
```

---

## 12. Summary

A sequence CRDT replaces integer indices with **stable position identifiers** that must be **total, dense, and globally unique** (tie-broken by replica id). Two families implement that contract differently. **Identifier schemes** — Logoot, LSEQ, Treedoc, fractional indexing — give each element a self-contained absolute position in a dense ordered space; insert means minting an id between neighbours, and deletes are often garbage-collectible, but identifiers **grow** with editing pressure. **Linked schemes** — RGA and its ancestor WOOT — give each element a small constant id plus a **reference to the neighbour it was inserted after/between**; order is computed by traversal with a deterministic tie-break, ids never grow, but deletes must leave **tombstones**.

**RGA** is the practical centre of gravity: each op is `(newId, afterId, value)`; concurrent inserts sharing an anchor are placed in **descending id order**; deletes tombstone; and convergence follows rigorously because the visible order is a *pure function* of the (identical) node set under a *total* comparator, independent of operation arrival order. **Logoot/LSEQ** trade a growing variable-length id for absolute comparison, with **LSEQ** specifically defeating identifier bloat via exponential base growth and a per-level boundary± hedge against left/right editing skew. **WOOT** and **Treedoc** are the historical roots — WOOT simplified into RGA; Treedoc's coordinated rebalancing motivated the search for ids that never need rebalancing.

The deepest lesson is the **interleaving anomaly** (Kleppmann 2019): a sequence CRDT can *converge* and still braid two concurrently-typed words into nonsense. Position-only schemes suffer it badly; RGA's run-anchoring resists it but is not immune. **Convergence is necessary but not sufficient** — a correct sequence CRDT must also keep concurrent runs contiguous.

Continue to the [senior](senior.md) tier for non-interleaving algorithms (Fugue, YATA/Yjs), tombstone garbage collection, block-wise RGA for large documents, and the formal interleaving definitions. Revisit [CRDT Fundamentals](../01-crdt-fundamentals/middle.md) for the merge laws every operation here quietly relies on, and [Set CRDTs](../04-sets-or-set-lww/middle.md) for the simpler add/remove-with-tombstones intuition that sequences generalise.

---

## 13. Further reading

- **Roh, Jeon, Kim, Lee — "Replicated abstract data types: Building blocks for collaborative applications"** (*Journal of Parallel and Distributed Computing*, 2011). The RGA paper; defines the timestamped insertion / tombstone delete model and proves convergence.
- **Weiss, Urso, Molli — "Logoot: A Scalable Optimistic Replication Algorithm for Collaborative Editing on P2P Networks"** (ICDCS 2009). Introduces variable-length position identifiers and the boundary allocation strategy.
- **Nédelec, Molli, Mostefaoui, Desmontils — "LSEQ: an Adaptive Structure for Sequences in Distributed Collaborative Editing"** (DocEng 2013). Exponential base growth + boundary± to defeat identifier bloat and editing skew.
- **Oster, Urso, Molli, Imine — "Data Consistency for P2P Collaborative Editing"** (CSCW 2006). The WOOT algorithm; the conceptual ancestor of RGA.
- **Préguiça, Marquès, Shapiro, Letia — "A Commutative Replicated Data Type for Cooperative Editing"** (ICDCS 2009). Treedoc, the binary-tree identifier scheme and its rebalancing challenge.
- **Kleppmann, Gomes, Mulligan, Beresford — "Interleaving anomalies in collaborative text editors"** (PaPoC 2019). Formalises interleaving, shows which CRDTs suffer it, and motivates non-interleaving designs.
- **Shapiro, Preguiça, Baquero, Zawirski — "A comprehensive study of Convergent and Commutative Replicated Data Types"** (INRIA RR-7506, 2011). The foundational CRDT taxonomy underpinning all of the above.
- **Weidner, Gentle, Kleppmann — "The Art of the Fugue: Minimizing Interleaving in Collaborative Text Editing"** (2023). A modern, provably non-interleaving sequence CRDT — good bridge to the senior tier.
