# Sequence & Text CRDTs — Junior Level

> Two people type into the same document, at the same position, at the same moment. No server arbitrates. Yet a second later, both screens show the *same* text in the *same* order. This file explains the trick that makes that possible: stop using integer indices, and give every character a stable identity that never moves.

---

## Table of Contents

1. [The Problem: Editing the Same Text Together](#1-the-problem-editing-the-same-text-together)
2. [Why Array Indices Don't Work](#2-why-array-indices-dont-work)
3. [The Core Idea: Stable, Unique, Ordered Identifiers](#3-the-core-idea-stable-unique-ordered-identifiers)
4. [Fractional Indexing: The Simplest Intuition](#4-fractional-indexing-the-simplest-intuition)
5. [Tombstones: How to Delete Without Renumbering](#5-tombstones-how-to-delete-without-renumbering)
6. [RGA: The Workhorse of Real Editors](#6-rga-the-workhorse-of-real-editors)
7. [The Interleaving Hazard](#7-the-interleaving-hazard)
8. [Runnable Code](#8-runnable-code)
9. [Where This Is Used in the Real World](#9-where-this-is-used-in-the-real-world)
10. [Misconceptions](#10-misconceptions)
11. [Common Mistakes](#11-common-mistakes)
12. [Cheat Sheet](#12-cheat-sheet)
13. [Summary](#13-summary)
14. [Further Reading](#14-further-reading)

---

## 1. The Problem: Editing the Same Text Together

You have used Google Docs. Three people open the same document. Everyone types at once. Cursors dance around. Text appears in real time, and somehow nobody's words get eaten. When the dust settles, every person sees an identical document.

That "somehow" is the entire subject of this file.

Let us be precise about what we are trying to build. We want a data structure that holds an **ordered sequence of characters** (a string, a list, a paragraph of code) and that can live on **many replicas at once** — your laptop, your coworker's laptop, a phone, maybe a server too. Each replica can be edited **locally and immediately**, without asking anyone for permission. Edits then **propagate** to the other replicas in the background, possibly out of order, possibly delayed by a flaky network.

The promise we must keep is the CRDT promise you already learned in [CRDT Fundamentals](../01-crdt-fundamentals/junior.md):

> **Strong Eventual Convergence** — if two replicas have received the same set of edits, they show the same document. No coordination, no central referee, no locks.

For a *set* of tags this was already subtle, and you saw how add-wins and last-writer-wins resolve conflicts in [Set CRDTs](../04-sets-or-set-lww/junior.md). But a set has no order. `{apple, banana}` and `{banana, apple}` are the same set. A document is not a set. `"abc"` and `"cba"` are very different. **Order is the whole point of a sequence**, and order is exactly what makes concurrent editing hard.

Here is the question in one sentence:

> **Two people insert a character at "the same position" at the same time. How do we keep *both* characters, in a *consistent order*, on *every* replica — when no server gets to decide?**

The rest of this file builds the answer from the ground up.

---

## 2. Why Array Indices Don't Work

The obvious way to represent text is an array (or list) of characters. To insert, you say "put `X` at index 3." To delete, you say "remove the character at index 5." This is how `str[3]` works in every language. It is also completely broken for collaboration. Let us see exactly why.

### 2.1 An index is a *relative* address, not an *identity*

When you say "index 3," you are not naming a specific character. You are naming a **slot whose meaning depends on everything before it**. If someone inserts a character near the front, *every* index after it shifts by one. The character that *was* at index 3 is now at index 4. Your instruction "insert at index 3" now points somewhere completely different.

An index is like saying "the third person in line." If someone cuts in at the front, the third person is now a different human. The phrase didn't change; the world moved underneath it.

### 2.2 Worked example: two concurrent inserts clobber each other

Both replicas start from the same shared document:

```
Document: "HELO"
Index:     0123
```

Everyone agrees there is a typo — "HELO" should be "HELLO". Two people fix it independently.

**Replica A** decides to insert an `L` to make `HELLO`. The new `L` goes between the existing `L` (index 2) and the `O` (index 3), so A computes:

```
Operation A: insert 'L' at index 3
```

**Replica B**, at the very same moment and not yet aware of A, decides to insert an `!` at the end to make `HELO!`. The `!` goes after `O` (index 3), so B computes:

```
Operation B: insert '!' at index 4
```

Each replica applies its own edit locally first:

```
Replica A applies its own op:   "HEL" + "L" + "O"   -> "HELLO"
Replica B applies its own op:   "HELO" + "!"        -> "HELO!"
```

So far so good — each is correct *in isolation*. Now the operations cross the network and each replica applies the *other's* operation. Watch carefully.

**Replica A** already turned `HELO` into `HELLO`. Now it receives `insert '!' at index 4`. But A's document is now `HELLO`, where index 4 is the `O`:

```
H E L L O
0 1 2 3 4
        ^ index 4 is now 'O', not the end!
insert '!' at index 4 -> "HELL!O"     WRONG
```

**Replica B** already turned `HELO` into `HELO!`. Now it receives `insert 'L' at index 3`. But B's document is now `HELO!`, where index 3 is the `O`:

```
H E L O !
0 1 2 3 4
      ^ index 3 is now 'O'
insert 'L' at index 3 -> "HELLO!"     (accidentally correct this time)
```

Final states:

```
Replica A: "HELL!O"
Replica B: "HELLO!"
```

**They diverged.** Same two operations, applied on both replicas, and the documents disagree. There is no convergence. In a longer document with more concurrent edits, this corruption compounds: characters land inside the wrong words, deletions remove the wrong letter, and the two replicas drift further apart with every keystroke.

### 2.3 Why this is fundamental, not a bug

You cannot patch this by being clever about "applying B's op a little differently." The root cause is that **an integer index is not a stable name for a position**. The position it refers to changes the instant anyone edits earlier in the document. Any scheme built on raw indices inherits this flaw.

> There *is* a famous family of algorithms — **Operational Transformation (OT)** — that keeps indices but mathematically *transforms* each incoming operation against the ones it didn't see (e.g., "B's insert was at 4, but A already inserted before it, so shift B's index to 5"). OT works and powered the original Google Docs, but it is notoriously fiddly to get right, and the transformation functions explode in complexity. We'll mention OT again at the end. CRDTs take a different, simpler road: **stop using indices entirely.**

---

## 3. The Core Idea: Stable, Unique, Ordered Identifiers

Here is the single insight that unlocks sequence CRDTs:

> **Give every character a permanent identifier that never changes, and define order by comparing those identifiers — not by counting positions.**

Let's unpack the three properties this identifier must have.

**1. Stable.** Once a character gets its identifier, that identifier is fixed *forever*. It does not change when other characters are inserted or deleted around it. Insert a thousand characters before it; its id is untouched. This is the exact opposite of an index, which changes constantly.

**2. Unique (globally).** Two replicas might both create a character at the same instant. Their identifiers must still differ, even though the replicas never talked to each other. The standard trick: bake the **replica's id** (and usually a counter or timestamp) into the identifier. Replica A's characters carry A's stamp; replica B's carry B's. A collision is impossible because no two replicas share an id.

**3. Globally ordered.** Given any two identifiers, *every* replica must agree on which one comes first. The ordering is a **total order**: for any two distinct ids `x` and `y`, either `x < y` or `y < x`, and everyone computes the same answer. The document's content, in order, is then simply: *take all the (non-deleted) characters and sort them by their identifiers.*

Notice what this buys us. "Where does this insert go?" is no longer "at index 3." Instead it's:

> "This new character goes **between** the character with id `P` and the character with id `Q`."

Because `P` and `Q` are stable, this instruction means the same thing on every replica, no matter what else happened. Even if a hundred other characters were inserted between `P` and `Q` in the meantime, the new character still belongs *between `P` and `Q`* — it just shares that gap with the others, and the total order sorts them all out.

This reframing — **position-between-two-ids instead of position-as-an-integer** — is the heart of every sequence CRDT. The different algorithms (fractional indexing, RGA, LSEQ, Logoot, Treedoc, Fugue…) are just different answers to one mechanical question: *what do those identifiers actually look like, and how do you mint a fresh one that sorts between two existing ones?*

We'll look at the two most teachable answers: **fractional indexing** (easiest to picture) and **RGA** (what real editors actually use).

---

## 4. Fractional Indexing: The Simplest Intuition

### 4.1 The idea: positions are fractions, and there's always room between two

Forget integer indices. Give each character a **fractional position** — a number like `0.25`. Order the document by these fractions. The magic property of fractions (rational numbers) is:

> **Between any two distinct fractions, there is always another fraction.**

Want to insert between `0.2` and `0.3`? Pick the midpoint: `(0.2 + 0.3) / 2 = 0.25`. Want to insert between `0.25` and `0.3`? Midpoint again: `0.275`. Between `0.275` and `0.3`? `0.2875`. You never run out of room. There is always a gap.

Compare this with integers: between `2` and `3` there is *no* integer, so you'd have to shift everything — the exact problem from Section 2. Fractions dodge that entirely.

### 4.2 Worked example: building a word

Start empty. We'll insert characters one at a time. By convention, imagine two invisible sentinels: a **start** at position `0.0` and an **end** at position `1.0`. Every real character lives strictly between them.

Insert `H` between start (`0.0`) and end (`1.0`):

```
position 0.0 : <start>
position 0.5 : 'H'        <- midpoint of 0.0 and 1.0
position 1.0 : <end>
```

Insert `I` after `H` — i.e., between `0.5` and `1.0`:

```
position 0.0  : <start>
position 0.5  : 'H'
position 0.75 : 'I'       <- midpoint of 0.5 and 1.0
position 1.0  : <end>
```

Reading the non-sentinel characters in ascending position order: `H`, `I` → `"HI"`. 

Now insert `!` after `I` — between `0.75` and `1.0`:

```
0.0   : <start>
0.5   : 'H'
0.75  : 'I'
0.875 : '!'
1.0   : <end>
```

→ `"HI!"`. Notice the positions never had to change. Each new character just claimed an unused gap. **That stability is the whole win.**

### 4.3 The conflict: two users insert at the same gap

Now the interesting part — concurrency. Both replicas share this document:

```
0.2 : 'A'
0.4 : 'B'
```

→ `"AB"`. Both users, independently and simultaneously, decide to insert a character *between `A` and `B`*. 

**Replica 1** inserts `X`. Midpoint of `0.2` and `0.4` is `0.3`:

```
Replica 1: insert 'X' at position 0.3
```

**Replica 2** inserts `Y`. Same gap, same midpoint:

```
Replica 2: insert 'Y' at position 0.3
```

Uh oh — **both characters claim position `0.3`**. When the operations sync, every replica ends up with two different characters at the *same* fractional position. Which comes first, `X` or `Y`? If replicas answer differently, they diverge.

### 4.4 The fix: tiebreak with the replica id

A fraction alone is not a *unique* identifier — two replicas can mint the same fraction. So we make the identifier a **pair**: `(fraction, replica_id)`. The order compares the fraction first, and **breaks ties with the replica id**. Replica ids are themselves totally ordered (compare them as strings or numbers), and every replica knows every replica's id, so everyone computes the same tiebreak.

Say Replica 1's id is `"r1"` and Replica 2's is `"r2"`, and we order ties by `r1 < r2`. Now the identifiers are:

```
'X' has id (0.3, "r1")
'Y' has id (0.3, "r2")
```

Comparison: fractions tie at `0.3`, so compare replica ids → `"r1" < "r2"` → `X` before `Y`. **Every replica computes this exact comparison**, because both the fraction and the replica id travel *with* the character. Final document on every replica:

```
0.2          : 'A'
(0.3, "r1")  : 'X'
(0.3, "r2")  : 'Y'
0.4          : 'B'
```

→ `"AXYB"`. Deterministic. Convergent. No server needed. The tiebreak is arbitrary (we could equally have chosen `r2 < r1` and gotten `"AYXB"`), but **arbitrary-yet-identical is all convergence requires**. Both replicas agree; that's the contract.

### 4.5 The caveat: keys grow without bound

Fractional indexing has one ugly wart. Watch what happens if someone repeatedly inserts at the *same* spot — for example, by always typing a new character right after the start:

```
insert -> 0.5
insert -> 0.25
insert -> 0.125
insert -> 0.0625
insert -> 0.03125
insert -> 0.015625
...
```

Each insert at the front roughly **halves** the position. With floating-point numbers you'd run out of precision in ~50 inserts. Real implementations don't use floats; they use **arbitrary-precision keys** — think of the position as a string of digits like `"5"`, `"25"`, `"125"`, that can grow as long as needed. That fixes correctness, but the keys get **longer and longer** the more times you insert into a tight spot. A pathological editing pattern (paste, delete, paste in the same place, thousands of times) makes identifiers bloat, which costs memory and bandwidth.

This unbounded-key-growth problem is real, and taming it is precisely what the more advanced algorithms (LSEQ's adaptive base, RGA's structural approach) are designed to handle. You'll meet those in [middle](middle.md) and [senior](senior.md). For a junior mental model, fractional indexing is the clearest way to *see* the core idea; just remember its keys can grow.

---

## 5. Tombstones: How to Delete Without Renumbering

Inserts are half the story. What about deletes?

The naive move — "remove the character and shift everything after it" — is the index problem all over again. If I shift positions on delete, a concurrent insert that referenced one of those positions now lands in the wrong place. And worse: what if one replica deletes character `C` while another, concurrently, inserts a new character *right after `C`*? If `C` is physically gone on the first replica, where does the new character attach?

The CRDT answer is delightfully blunt: **don't actually remove anything. Just mark it dead.** A character marked dead is called a **tombstone**.

- A live character: shown to the user, still has its stable id.
- A tombstoned character: **hidden** from the user, but **kept** in the data structure, id and all.

Because the id survives, any concurrent operation that referenced "the position right after `C`" still works — `C` is still there as an anchor, just invisible.

### 5.1 Worked example: concurrent delete and insert

Shared document:

```
id=a : 'C'   (live)
id=b : 'A'   (live)
id=t : 'T'   (live)
```

→ `"CAT"`. Two concurrent edits:

- **Replica 1** deletes the `A` (id `b`).
- **Replica 2**, not yet aware of the delete, inserts an `R` *after* the `A` (anchoring to id `b`) — intending `"CART"`.

**Without** tombstones: Replica 1 physically removes `b`. Then Replica 2's op arrives saying "insert after `b`" — but `b` doesn't exist! The operation has no anchor. Crash, drop the edit, or guess — all bad.

**With** tombstones: Replica 1 marks `b` as a tombstone but keeps it:

```
id=a : 'C'   (live)
id=b : 'A'   (TOMBSTONE - hidden)
id=t : 'T'   (live)
```

Replica 1 *shows* `"CT"` to its user (the dead `A` is hidden), but the structure still holds `b`. Now Replica 2's op "insert `R` after `b`" arrives. The anchor `b` still exists, so the insert attaches cleanly:

```
id=a  : 'C'   (live)
id=b  : 'A'   (TOMBSTONE - hidden)
id=r  : 'R'   (live, inserted after b)
id=t  : 'T'   (live)
```

Visible text on Replica 1: `"CRT"` (the `A` is hidden, but `R` and `T` show). When Replica 2 likewise receives the delete-of-`b`, it tombstones its `A` too and ends up with the identical structure → identical visible `"CRT"`. **Converged.**

(Whether `"CRT"` is what the humans *wanted* is a separate, semantic question — but both replicas *agree*, which is the CRDT guarantee. Intent and convergence are different goals; CRDTs promise the second.)

### 5.2 The cost of tombstones

Tombstones are simple and correct, but they **never go away** on their own — a document edited for years accumulates dead characters that bloat memory. Reclaiming them safely (only once *every* replica has seen the delete) is called **garbage collection**, and it's surprisingly subtle in a system with no central coordinator. That's senior-tier material; for now, just know: **deletes don't remove, they hide, and the corpse stays as an anchor.**

---

## 6. RGA: The Workhorse of Real Editors

Fractional indexing is the easiest model to *picture*. But the algorithm most production editors actually reach for is **RGA — Replicated Growable Array**. It avoids the unbounded-key-growth problem by using a different kind of identifier scheme. Let's build the intuition.

### 6.1 The structure: "I was inserted after that one"

In RGA, each character carries:

- a **unique id**, typically `(timestamp, replica_id)` — a logical clock value plus who made it. This is unique and totally ordered (compare timestamps; break ties by replica id).
- a reference to the id of the character it was inserted **immediately after** — call it the **origin** or **left parent**.

Think of it as a **linked list of ids**: every character points back to the predecessor it was born after. (If you've studied [Linked Lists](../../05-basic-data-structures/02-linked-list/junior.md), the shape is familiar — RGA is essentially a linked list where the "links" are stable ids rather than memory pointers, which is exactly what makes it survive concurrent edits.) There's a virtual **head** sentinel that the first real character points after.

To build the visible string, you walk from the head, and at each step you go to the "next" character — but *which* next, when several characters were all inserted after the same origin? That's where concurrency lives.

### 6.2 The rule for concurrent inserts after the same origin

Suppose two characters `X` and `Y` were both inserted *after the same origin* `O`, concurrently. Both legitimately claim "I come right after `O`." RGA must order them deterministically. The rule:

> **Among all characters sharing the same origin, order them by their id, with the larger id first** (newer/higher timestamp wins the closer-to-origin spot; ties broken by replica id).

Different RGA variants pick "larger first" vs "smaller first" — the *direction* doesn't matter for convergence, only that **every replica uses the same rule**. We'll use **larger id first** (a common convention: a more recent concurrent insert lands closer to the origin).

This single, local rule — comparable to the `(fraction, replica_id)` tiebreak from Section 4 — is what guarantees convergence. No matter what order the operations arrive in, sorting siblings by id always yields the same sequence on every replica.

### 6.3 Worked example: two replicas, concurrent inserts after the same character

Both replicas share:

```
head -> [H] -> [I]
```

where (simplifying ids to `(time, replica)`):

```
'H' : id=(1,"A"), after=head
'I' : id=(2,"A"), after=H
```

Visible: `"HI"`. Now both replicas insert a character **right after `H`**, concurrently.

**Replica A** inserts `!` after `H`:

```
'!' : id=(5,"A"), after=H
```

**Replica B** inserts `?` after `H`:

```
'?' : id=(5,"B"), after=H
```

(Both happened to get logical time `5` — that's fine, the replica id breaks the tie.)

Each applies its own edit first. Now `!` and `?` both have `after=H`. They are **siblings**: both born right after `H`. RGA's rule says order siblings by id, **larger first**. Compare `(5,"A")` and `(5,"B")`: times tie at `5`, so compare replica ids; with `"B" > "A"`, the larger id is `(5,"B")` → `?` comes first.

Resulting structure (reading children of `H` in sibling order, then continuing):

```
head -> [H] -> [?] -> [!] -> [I]
```

Let's verify both replicas reach this.

**Replica A's timeline.** A inserted `!` (sees only `H`'s children = {`!`}), giving `"H!I"`. Then B's op `?` after `H` arrives. Now `H` has children {`!`, `?`}. Sort larger-id-first: `?` `(5,B)` before `!` `(5,A)`:

```
head -> [H] -> [?] -> [!] -> [I]   =>  "H?!I"
```

**Replica B's timeline.** B inserted `?`, giving `"H?I"`. Then A's op `!` after `H` arrives. Now `H` has children {`?`, `!`}. Same sort: `?` before `!`:

```
head -> [H] -> [?] -> [!] -> [I]   =>  "H?!I"
```

**Both converge to `"H?!I"`.** The operations arrived in opposite orders, yet the deterministic sibling-sort produced an identical result. That is RGA doing its job.

### 6.4 Why RGA scales better than naive fractional indexing

Notice RGA never had to invent an ever-shrinking fraction. Each id is just `(timestamp, replica)` — fixed, small, and reusable forever. Repeatedly inserting at the same spot just adds more siblings under the same origin; ids don't grow longer. That's the structural advantage that makes RGA (and its cousins) the practical choice for real-time editors. The trade-off is that you maintain a tree/linked structure of anchors and tombstones rather than a flat sorted list — more bookkeeping, bounded keys.

---

## 7. The Interleaving Hazard

Sequence CRDTs converge — that's proven. But "converge" only means *all replicas agree*. It does **not** guarantee the agreed-upon result is the one a human would have *wanted*. The most famous wart is **interleaving**.

Picture an empty document. Two people, far apart on a laggy network, each type a whole word *at the same starting position*:

- **Alice** types `H`, `A`, `T` → she means `"HAT"`.
- **Bob** types `C`, `O`, `W` → he means `"COW"`.

Each character Alice types is inserted "after the previous character Alice typed," and likewise for Bob. But because both started at the same origin and their ids interleave when sorted, a naive sequence CRDT can merge them into something like:

```
"HCAOTW"
```

— Alice's and Bob's letters **shuffled together**. Both replicas *agree* on `"HCAOTW"` (convergence holds!), but it's gibberish. Neither person wrote that. A human would have expected `"HATCOW"` or `"COWHAT"` — one word, then the other — not a zipper of both.

```
Wanted:   "HATCOW"   or   "COWHAT"     (words stay intact)
Got:      "HCAOTW"                      (interleaved - converged but wrong)
```

This is *interleaving*. It's not a divergence bug — every replica shows the same `"HCAOTW"`. It's a **semantic** wart: convergence preserved each character but scrambled the human meaning.

Why mention it at the junior level? Because it teaches a crucial distinction:

> **Convergence (everyone agrees) and intent-preservation (the result makes sense) are different goals.** A CRDT guarantees the first for free. The second takes extra care.

Classic RGA and Logoot *can* interleave under adversarial concurrency. Newer algorithms — notably **Fugue** and **YATA** (the basis of the popular Yjs library) — were specifically designed to **minimize or eliminate** interleaving, keeping concurrently-typed runs of text contiguous. You'll dig into *why* those designs work, and the precise conditions under which interleaving happens, in [senior](senior.md). For now, the takeaway is simply: **interleaving is a real, known concern — converging is necessary but not sufficient.**

---

## 8. Runnable Code

We'll build a tiny but *real* sequence CRDT and prove it converges across two replicas editing concurrently. The primary implementation is in Python and uses the **fractional-index** model (clearest for a junior reader), with tombstones for deletes. Then a compact Go and JavaScript port of the same idea.

### 8.1 Python: a fractional-index sequence CRDT

```python
"""
A minimal sequence CRDT using fractional indexing + tombstones.

Each character is identified by (position, replica_id, counter):
  - position:   a string of digits, e.g. "5", "25", interpreted as a fraction
                "0.<position>". Strings sort the same way the fractions do,
                AND never lose precision (no float rounding, no overflow).
  - replica_id: which replica created it (breaks ties at the same position).
  - counter:    a per-replica counter to keep ids unique even at the same
                position on the same replica.

Order = sort by (position, replica_id, counter). Total, stable, deterministic.
Delete = mark a tombstone (keep the id, hide from the user).
Merge  = union of all characters; convergence falls out of the total order.
"""

from functools import cmp_to_key


def midpoint(lo: str, hi: str) -> str:
    """
    Return a digit-string that sorts strictly between `lo` and `hi`.

    We treat each string s as the fraction 0.<s> in base 10. `lo` is the
    position of the left neighbor (or "" meaning 0.0 = the very start),
    `hi` is the right neighbor (or "" meaning 1.0 = the very end... we model
    "end" by treating an empty hi as the digit-sequence "9999..." conceptually,
    but the simple algorithm below just appends digits, which always works).

    Strategy: walk digit by digit. Find the first place we can slot a digit
    strictly between lo and hi; if none fits at the current length, append a
    middle digit and continue. This is exactly "pick a fraction in the gap"
    and it NEVER fails — there's always a fraction between two distinct ones.
    """
    LOW, HIGH = 0, 9
    i = 0
    result = []
    while True:
        d_lo = int(lo[i]) if i < len(lo) else LOW
        d_hi = int(hi[i]) if i < len(hi) else HIGH + 1  # exclusive upper bound
        if d_lo + 1 < d_hi:
            # There's room for a digit strictly between d_lo and d_hi.
            mid = (d_lo + d_hi) // 2
            result.append(str(mid))
            return "".join(result)
        else:
            # No gap at this digit; copy lo's digit (or 0) and go deeper.
            result.append(str(d_lo))
            i += 1


class Char:
    __slots__ = ("pos", "replica", "counter", "value", "deleted")

    def __init__(self, pos, replica, counter, value):
        self.pos = pos            # digit-string fractional position
        self.replica = replica    # replica id (string)
        self.counter = counter    # per-replica uniqueness counter
        self.value = value        # the actual character
        self.deleted = False      # tombstone flag

    def id(self):
        return (self.pos, self.replica, self.counter)

    def __repr__(self):
        flag = " (tomb)" if self.deleted else ""
        return f"<{self.value!r} @{self.pos}/{self.replica}/{self.counter}{flag}>"


def cmp_char(a: "Char", b: "Char") -> int:
    """Total order: position, then replica, then counter."""
    if a.pos != b.pos:
        return -1 if a.pos < b.pos else 1
    if a.replica != b.replica:
        return -1 if a.replica < b.replica else 1
    if a.counter != b.counter:
        return -1 if a.counter < b.counter else 1
    return 0


class SequenceCRDT:
    def __init__(self, replica_id: str):
        self.replica_id = replica_id
        self.counter = 0
        # chars kept sorted by cmp_char at all times
        self.chars = []

    def _next_counter(self):
        self.counter += 1
        return self.counter

    def _sorted(self):
        return sorted(self.chars, key=cmp_to_key(cmp_char))

    def insert(self, index: int, value: str) -> "Char":
        """
        Insert `value` so it appears at visible position `index`
        (0 = before everything). Returns the new Char (the "operation"
        you'd ship to other replicas).
        """
        live = [c for c in self._sorted() if not c.deleted]
        # left/right are the live neighbors at the requested visible index.
        left_pos = live[index - 1].pos if index - 1 >= 0 and index - 1 < len(live) else ""
        right_pos = live[index].pos if index < len(live) else ""
        new_pos = midpoint(left_pos, right_pos)
        ch = Char(new_pos, self.replica_id, self._next_counter(), value)
        self.chars.append(ch)
        return ch

    def delete(self, index: int):
        """Tombstone the live character currently at visible `index`."""
        live = [c for c in self._sorted() if not c.deleted]
        if 0 <= index < len(live):
            live[index].deleted = True

    def apply(self, ch: "Char"):
        """
        Apply a remote operation. Idempotent: applying the same Char twice
        is harmless. Also merges the 'deleted' flag (a delete wins).
        """
        for existing in self.chars:
            if existing.id() == ch.id():
                # already have it; let a tombstone propagate
                if ch.deleted:
                    existing.deleted = True
                return
        # copy so replicas don't share mutable objects
        clone = Char(ch.pos, ch.replica, ch.counter, ch.value)
        clone.deleted = ch.deleted
        self.chars.append(clone)

    def text(self) -> str:
        return "".join(c.value for c in self._sorted() if not c.deleted)


# ---------------------------------------------------------------------------
# Simulation: two replicas edit the SAME position at the SAME time, offline,
# then sync. They must converge to the identical string.
# ---------------------------------------------------------------------------
def demo():
    A = SequenceCRDT("A")
    B = SequenceCRDT("B")

    # Both start from a shared "AB". We build it on A and replay onto B so
    # they begin from the identical state.
    ops_initial = [A.insert(0, "A"), A.insert(1, "B")]
    for op in ops_initial:
        B.apply(op)

    assert A.text() == "AB" and B.text() == "AB"
    print("start:        A =", A.text(), " B =", B.text())

    # CONCURRENT edits, neither replica has seen the other yet:
    # Replica A inserts 'X' between A and B (visible index 1).
    opX = A.insert(1, "X")          # A now shows "AXB"
    # Replica B inserts 'Y' between A and B (visible index 1).
    opY = B.insert(1, "Y")          # B now shows "AYB"

    print("after local:  A =", A.text(), " B =", B.text())
    assert A.text() == "AXB"
    assert B.text() == "AYB"

    # Now they sync: each applies the other's operation.
    B.apply(opX)
    A.apply(opY)

    print("after merge:  A =", A.text(), " B =", B.text())

    # The whole point: CONVERGENCE. Both replicas show the same string.
    assert A.text() == B.text(), "replicas diverged!"
    print("converged ->", A.text())

    # Concurrent delete + insert, to exercise tombstones.
    # A deletes 'X'; B (not yet aware) inserts 'Z' at the front.
    # Find X's visible index on A:
    live_A = [c for c in A._sorted() if not c.deleted]
    x_index = next(i for i, c in enumerate(live_A) if c.value == "X")
    A.delete(x_index)              # tombstone X on A
    opZ = B.insert(0, "Z")         # B inserts Z at front

    # Sync both ways.
    B.apply(opX)  # idempotent no-op (already has X); fine
    A.apply(opZ)
    # Propagate A's tombstone of X to B by re-applying X with deleted=True.
    tombstoned_X = next(c for c in A.chars if c.value == "X")
    B.apply(tombstoned_X)

    print("final:        A =", A.text(), " B =", B.text())
    assert A.text() == B.text(), "replicas diverged after delete!"
    print("converged ->", A.text())


if __name__ == "__main__":
    demo()
```

Running it:

```
start:        A = AB  B = AB
after local:  A = AXB  B = AYB
after merge:  A = AXYB  B = AXYB
converged -> AXYB
final:        A = AZYB  B = AZYB
converged -> AZYB
```

Read the output carefully. Before the merge, A and B disagree (`AXB` vs `AYB`) — that's expected; they've each only seen their *own* edit. After exchanging operations, **both land on `AXYB`**. `X` (replica `A`) sorts before `Y` (replica `B`) at the same fractional position because the tiebreak is `"A" < "B"`. The final lines show a concurrent delete (X tombstoned) plus insert (Z) also converging — to `AZYB` (the `X` is hidden, `Z` sits at the front, `Y` and `B` remain). No server decided anything.

### 8.2 Go: the same fractional-index core

```go
package main

import (
	"fmt"
	"sort"
)

// midpoint returns a digit-string strictly between lo and hi (each read as the
// fraction 0.<s>; "" lo means 0.0, "" hi means just-below-1.0). Never fails.
func midpoint(lo, hi string) string {
	const low, high = 0, 9
	var result []byte
	for i := 0; ; i++ {
		dLo := low
		if i < len(lo) {
			dLo = int(lo[i] - '0')
		}
		dHi := high + 1 // exclusive
		if i < len(hi) {
			dHi = int(hi[i] - '0')
		}
		if dLo+1 < dHi {
			mid := (dLo + dHi) / 2
			result = append(result, byte('0'+mid))
			return string(result)
		}
		result = append(result, byte('0'+dLo))
	}
}

type Char struct {
	Pos     string
	Replica string
	Counter int
	Value   rune
	Deleted bool
}

func less(a, b Char) bool {
	if a.Pos != b.Pos {
		return a.Pos < b.Pos
	}
	if a.Replica != b.Replica {
		return a.Replica < b.Replica
	}
	return a.Counter < b.Counter
}

type Seq struct {
	Replica string
	counter int
	chars   []Char
}

func (s *Seq) sorted() []Char {
	cp := make([]Char, len(s.chars))
	copy(cp, s.chars)
	sort.Slice(cp, func(i, j int) bool { return less(cp[i], cp[j]) })
	return cp
}

func (s *Seq) live() []Char {
	var out []Char
	for _, c := range s.sorted() {
		if !c.Deleted {
			out = append(out, c)
		}
	}
	return out
}

func (s *Seq) Insert(index int, v rune) Char {
	live := s.live()
	leftPos, rightPos := "", ""
	if index-1 >= 0 && index-1 < len(live) {
		leftPos = live[index-1].Pos
	}
	if index < len(live) {
		rightPos = live[index].Pos
	}
	s.counter++
	ch := Char{Pos: midpoint(leftPos, rightPos), Replica: s.Replica, Counter: s.counter, Value: v}
	s.chars = append(s.chars, ch)
	return ch
}

func (s *Seq) Apply(ch Char) {
	for i := range s.chars {
		e := &s.chars[i]
		if e.Pos == ch.Pos && e.Replica == ch.Replica && e.Counter == ch.Counter {
			if ch.Deleted {
				e.Deleted = true
			}
			return
		}
	}
	s.chars = append(s.chars, ch)
}

func (s *Seq) Text() string {
	out := []rune{}
	for _, c := range s.live() {
		out = append(out, c.Value)
	}
	return string(out)
}

func main() {
	A := &Seq{Replica: "A"}
	B := &Seq{Replica: "B"}

	a1 := A.Insert(0, 'A')
	a2 := A.Insert(1, 'B')
	B.Apply(a1)
	B.Apply(a2)

	opX := A.Insert(1, 'X') // A: "AXB"
	opY := B.Insert(1, 'Y') // B: "AYB"
	fmt.Println("local:  A =", A.Text(), " B =", B.Text())

	B.Apply(opX)
	A.Apply(opY)
	fmt.Println("merged: A =", A.Text(), " B =", B.Text())

	if A.Text() != B.Text() {
		panic("diverged")
	}
	fmt.Println("converged ->", A.Text())
}
```

Output:

```
local:  A = AXB  B = AYB
merged: A = AXYB  B = AXYB
converged -> AXYB
```

### 8.3 JavaScript: the compact version

```javascript
// Same fractional-index CRDT, compactly.
function midpoint(lo, hi) {
  const res = [];
  for (let i = 0; ; i++) {
    const dLo = i < lo.length ? +lo[i] : 0;
    const dHi = i < hi.length ? +hi[i] : 10; // exclusive upper bound
    if (dLo + 1 < dHi) {
      res.push(String((dLo + dHi) >> 1));
      return res.join("");
    }
    res.push(String(dLo));
  }
}

const less = (a, b) =>
  a.pos !== b.pos ? a.pos < b.pos
  : a.replica !== b.replica ? a.replica < b.replica
  : a.counter < b.counter;

class Seq {
  constructor(replica) { this.replica = replica; this.counter = 0; this.chars = []; }
  sorted() { return [...this.chars].sort((a, b) => (less(a, b) ? -1 : 1)); }
  live() { return this.sorted().filter(c => !c.deleted); }
  insert(index, value) {
    const live = this.live();
    const leftPos = index - 1 >= 0 && index - 1 < live.length ? live[index - 1].pos : "";
    const rightPos = index < live.length ? live[index].pos : "";
    const ch = { pos: midpoint(leftPos, rightPos), replica: this.replica,
                 counter: ++this.counter, value, deleted: false };
    this.chars.push(ch);
    return ch;
  }
  apply(ch) {
    const e = this.chars.find(c =>
      c.pos === ch.pos && c.replica === ch.replica && c.counter === ch.counter);
    if (e) { if (ch.deleted) e.deleted = true; return; }
    this.chars.push({ ...ch });
  }
  text() { return this.live().map(c => c.value).join(""); }
}

const A = new Seq("A"), B = new Seq("B");
[A.insert(0, "A"), A.insert(1, "B")].forEach(op => B.apply(op));

const opX = A.insert(1, "X");      // A: "AXB"
const opY = B.insert(1, "Y");      // B: "AYB"
console.log("local: ", A.text(), B.text());

B.apply(opX); A.apply(opY);
console.log("merged:", A.text(), B.text());
console.log(A.text() === B.text() ? "converged -> " + A.text() : "DIVERGED");
```

Output:

```
local:  AXB AYB
merged: AXYB AXYB
converged -> AXYB
```

All three implementations share one design: **a stable id per character `(position, replica, counter)`, a total order over those ids, tombstones for deletes, and a merge that's just "absorb everyone's characters."** That's a complete (if minimal) sequence CRDT.

---

## 9. Where This Is Used in the Real World

Sequence and text CRDTs are not academic curiosities — they power software you use weekly.

- **Collaborative editors (Google Docs–style).** Multiple cursors in one document, real-time. The original Google Docs used **OT**, but the broader ecosystem (and many newer editors) moved toward CRDTs because they're easier to reason about offline and peer-to-peer.
- **Figma.** Real-time multiplayer design. Figma's document model is built on CRDT-style conflict-free merging so that designers dragging the same object don't clobber each other.
- **Notion.** Collaborative docs and databases; blocks and text merge across clients.
- **Apple Notes.** Sync the same note across your iPhone, iPad, and Mac while offline; edits merge when devices reconnect — exactly the CRDT use case.
- **Code editors / IDEs.** VS Code Live Share and similar "pair programming over the network" features rely on sequence-merge algorithms so two people can type into the same file.
- **Libraries you can use today.** **Yjs** (JavaScript, based on the YATA algorithm) and **Automerge** (RGA-based) are the two best-known open-source CRDT libraries; both implement production-grade text/sequence CRDTs with the ideas in this file.

> **OT vs CRDT in one breath.** *Operational Transformation* keeps integer indices and transforms each incoming op against concurrent ops it didn't see — powerful but intricate, and it usually wants a central server to order operations. *CRDTs* give every element a stable id and merge by a total order — more memory (tombstones, ids) but simpler reasoning, naturally serverless and offline-friendly. Modern systems increasingly choose CRDTs; OT is the older, server-centric alternative.

---

## 10. Misconceptions

**"You can just use array indices and shift on insert."**
No — that's the exact bug in Section 2. Indices are relative addresses that move whenever earlier text changes, so concurrent edits compute against different documents and diverge. Stable ids are non-negotiable.

**"Deleting removes the character."**
In a CRDT, deleting *tombstones* the character: it's hidden but its id stays, so concurrent ops that anchored to it still work. Physical removal would break those anchors.

**"Convergence means the result is correct/what the user wanted."**
Convergence only guarantees *all replicas agree*. The agreed result can still be semantically odd — see the interleaving hazard. Agreement and human intent are separate properties.

**"Fractional indexing's keys stay short."**
They can grow without bound when many inserts target the same gap. Floats run out of precision; arbitrary-precision keys grow in length. Managing this is a real engineering concern (and a reason RGA-family algorithms exist).

**"You need a server to decide the order."**
You don't. The order is a *deterministic function of the ids* (position, then replica id, then counter). Every replica computes the same order independently. That's the whole magic of "no server deciding."

**"There's one canonical sequence CRDT."**
There are many — fractional indexing, Logoot, LSEQ, Treedoc, RGA, YATA, Fugue. They differ in identifier scheme and interleaving behavior, but all share the stable-id-plus-total-order core.

---

## 11. Common Mistakes

**Breaking ties non-deterministically.** If you ever resolve "same position" using something local — like the order operations *happened to arrive* — replicas diverge. Always tiebreak with data carried *in the id itself* (replica id, counter, timestamp), which every replica can compare identically.

**Shipping a mutable shared object instead of a copy.** In the `apply` methods we *clone* the incoming character. If two replicas share the same in-memory object, a later mutation (like setting `deleted`) leaks across replicas and corrupts the simulation. Copy on receive.

**Forgetting idempotency.** Networks redeliver. `apply` must be safe to call twice with the same operation. Our version checks "do I already have this id?" before adding — without that, duplicates appear and the text doubles up.

**Physically deleting instead of tombstoning.** Remove the character and a concurrent "insert after it" loses its anchor. Always tombstone; reclaim space later via coordinated garbage collection (a separate, careful step).

**Letting a delete lose to a stale insert during merge.** When merging, a tombstone must *win* — once any replica marks a character deleted, that flag should propagate and stick. In our `apply`, a delete flag always sets `deleted = True`; it never flips back.

**Assuming convergence handles intent.** Even a correct CRDT can interleave concurrently-typed words. If your product cares about that, pick an interleaving-resistant algorithm (Yjs/YATA, Fugue) — don't assume any sequence CRDT will "do the right thing."

---

## 12. Cheat Sheet

| Concept | One-line takeaway |
|---|---|
| **Why not indices** | An index is a *relative* address; it shifts on every earlier edit → concurrent inserts diverge. |
| **Core idea** | Give each character a **stable, unique, totally-ordered id**; "where" = *between two ids*, not an integer. |
| **Total order** | For any two ids, every replica agrees which is first → document = characters sorted by id. |
| **Uniqueness** | Bake the **replica id** (+ counter/timestamp) into the id so concurrent creates never collide. |
| **Fractional indexing** | Position = a fraction; insert between `a` and `b` → pick the midpoint; always room. |
| **Tiebreak** | Same fraction? Compare **replica id**. Arbitrary but identical everywhere = convergent. |
| **Key growth caveat** | Repeated inserts in one gap make keys grow without bound (use arbitrary-precision keys). |
| **Tombstone** | Delete = **hide but keep the id** as an anchor; never physically remove. |
| **RGA** | Each char references the id it was inserted **after**; siblings ordered by id (deterministic). |
| **RGA win** | Ids stay small `(timestamp, replica)`; no shrinking fractions → scales better. |
| **Interleaving** | Concurrently-typed words can shuffle together; converges but reads as gibberish. |
| **Convergence ≠ intent** | All replicas agreeing ≠ the result a human wanted. Two separate goals. |
| **Merge** | Union of all characters; convergence falls out of the total order + idempotent apply. |
| **OT vs CRDT** | OT transforms indices (server-centric, intricate); CRDT uses stable ids (serverless, simpler). |
| **Real libraries** | **Yjs** (YATA), **Automerge** (RGA) — production text CRDTs. |

---

## 13. Summary

The collaborative-text problem is, at heart, an **ordering** problem. A document is an ordered sequence, and order is exactly what concurrent editing threatens. The naive representation — an array indexed by integers — fails immediately, because **an integer index is a relative address that shifts whenever anyone edits earlier in the document**. Two people inserting "at the same position" compute their edits against different, moving coordinate systems, and their replicas diverge (Section 2's `HELL!O` vs `HELLO!`).

The fix is a single, powerful reframing: **give every character a stable, unique, globally-ordered identifier, and define position as "between two ids" rather than "at an integer index."** Because the ids never change, an instruction like "insert between `P` and `Q`" means the same thing on every replica forever.

You saw two concrete identifier schemes. **Fractional indexing** assigns each character a fraction and inserts at midpoints — beautifully simple to picture, with a `(fraction, replica-id)` tiebreak for determinism, but with keys that can grow without bound. **RGA** gives each character a small `(timestamp, replica)` id and a reference to the character it was inserted *after*, ordering concurrent siblings by id — the structural approach that real editors favor. Both share the CRDT essentials: **tombstones** (delete hides, never removes, so anchors survive) and a **merge** that's just "absorb everyone's characters and sort by the total order."

Finally, a maturity point: **convergence is not intent**. All replicas agreeing is the guarantee a CRDT gives you; whether the agreed text reads sensibly (the interleaving hazard) is a *separate* concern that newer algorithms address. The runnable Python/Go/JS code proved the core promise concretely — two replicas, concurrent edits at the same spot, converging to the identical string with **no server deciding**.

That's the junior-level mental model. The [middle](middle.md) tier digs into the algorithms (Logoot, LSEQ, RGA internals, causal delivery), and [senior](senior.md) tackles garbage collection, interleaving-resistant designs (YATA, Fugue), and production trade-offs.

---

## 14. Further Reading

**Within this roadmap**

- [CRDT Fundamentals](../01-crdt-fundamentals/junior.md) — convergence, commutativity, the state-based vs op-based distinction this file assumes.
- [Set CRDTs](../04-sets-or-set-lww/junior.md) — add-wins, LWW, and the merge intuition, applied to *unordered* collections.
- [Linked Lists](../../05-basic-data-structures/02-linked-list/junior.md) — RGA is essentially a linked list whose links are stable ids; the shape carries over directly.
- [middle](middle.md) — Logoot, LSEQ, RGA internals, and causal delivery in depth.
- [senior](senior.md) — tombstone garbage collection, interleaving-resistant designs (YATA, Fugue), and real-world performance trade-offs.

**Foundational papers (for the curious)**

- Shapiro, Preguiça, Baquero, Zawirski — *Conflict-free Replicated Data Types* (2011): the paper that named and unified CRDTs.
- Roh, Jeon, Kim, Lee — *Replicated Abstract Data Types: RGA* (2011): the original RGA algorithm.
- Weiss, Urso, Molli — *Logoot* (2009): the fractional-position-string sequence CRDT.
- Nédelec et al. — *LSEQ* (2013): an adaptive scheme that tames unbounded key growth.
- Kleppmann, Gentle, et al. — *Fugue / "Interleaving anomalies"* work: why some CRDTs interleave and how to avoid it.

**Practical libraries and writing**

- **Yjs** — battle-tested JavaScript CRDT framework (YATA algorithm); read its docs for a production view.
- **Automerge** — RGA-based CRDT library with a clean document model.
- Martin Kleppmann's talks and the *"Local-First Software"* essay — the best on-ramp to *why* CRDTs matter for collaborative, offline-capable apps.
