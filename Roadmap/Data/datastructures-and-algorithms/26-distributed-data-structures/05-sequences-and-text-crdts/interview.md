# Sequence & Text CRDTs — Interview Questions

Sequence CRDTs are the data structures that make collaborative text editors (Google Docs, Notion, Figma's text layers, VS Code Live Share) and ordered lists (shared todo lists, kanban columns) converge without a central arbiter. They are also a favorite interview topic because they sit at the intersection of distributed systems, data-structure design, and subtle ordering theory. This Q&A bank walks from "why does a plain array break?" through RGA, Logoot/LSEQ, YATA/Yjs, fractional indexing, the interleaving anomaly, tombstones, and the CRDT-vs-OT debate, then finishes with system-design prompts, gotchas, rapid-fire drills, and common mistakes.

Companion files: [junior](junior.md) · [senior](senior.md) · [professional](professional.md). Related sections: [CRDT Fundamentals interview](../01-crdt-fundamentals/interview.md) and [Set CRDTs interview](../04-sets-or-set-lww/interview.md).

---

## Table of Contents

1. [Conceptual](#conceptual)
2. [Why Indices Fail](#why-indices-fail)
3. [Stable Identifiers & Fractional Indexing](#stable-identifiers--fractional-indexing)
4. [RGA & Causal Trees](#rga--causal-trees)
5. [Logoot/LSEQ & Identifier Growth](#logootlseq--identifier-growth)
6. [Interleaving Anomalies](#interleaving-anomalies)
7. [Tombstones & GC](#tombstones--gc)
8. [CRDT vs OT](#crdt-vs-ot)
9. [System Design](#system-design)
10. [Gotcha / Trick](#gotcha--trick)
11. [Rapid-Fire](#rapid-fire)
12. [Common Mistakes](#common-mistakes)
13. [Tips & Summary](#tips--summary)

---

## Conceptual

### Q1: What is a sequence CRDT, and what problem does it solve? *(Easy)*

**Answer**: A sequence CRDT (also called a list CRDT or ordered-collection CRDT) is a replicated data structure representing an ordered list of elements — characters, list items, rows — that supports concurrent `insert` and `delete` from multiple replicas and guarantees that, once all replicas have seen the same set of operations, they converge to the *same* sequence, in the *same* order, without a coordinating server.

The problem it solves is collaborative editing of ordered data under unreliable, asynchronous communication. Two users typing into the same paragraph at the same time, possibly offline, must end up seeing identical text once they sync. A naive approach (send "insert 'x' at position 5") fails because position 5 means different things on different replicas after concurrent edits. Sequence CRDTs replace fragile integer positions with stable, position-independent identifiers so that operations commute and converge.

---

### Q2: What three properties must a sequence CRDT guarantee? *(Easy)*

**Answer**: The classic strong-eventual-consistency guarantees, specialized to sequences:

1. **Commutativity** — applying concurrent operations in any order yields the same state. `insert(A)` then `insert(B)` produces the same sequence as `insert(B)` then `insert(A)`.
2. **Idempotence** — applying the same operation twice has no extra effect. Re-delivering an insert must not duplicate the element. This makes at-least-once message delivery safe.
3. **Associativity** — grouping of operation application doesn't matter.

Together these give **Strong Eventual Consistency (SEC)**: any two replicas that have received the same set of operations are in the same state, regardless of order, timing, or duplicates. On top of SEC, a sequence CRDT must also produce a *total order* over surviving elements so that "the document" is a single well-defined string, not just a set.

---

### Q3: Why is ordering specifically hard for a sequence CRDT, compared to, say, a counter or a set? *(Medium)*

**Answer**: A counter only needs to merge numbers (sum of per-replica increments); a set only needs membership decisions (add-wins, remove-wins, etc.) — neither cares *where* elements sit relative to each other. A sequence carries an extra burden: every element has a **position relative to every other element**, and that relative order must itself be a CRDT-mergeable property.

Concretely, the challenge is: when two replicas concurrently insert elements that should both land "between X and Y", the structure must deterministically order those two new elements relative to each other, using only information each replica can compute locally and identically. There is no global "row number" to assign, because numbering is exactly what concurrency destroys. So the whole intellectual content of sequence CRDTs is *how to encode position* in a way that survives concurrency — which is why this topic has spawned a dozen distinct algorithms (RGA, WOOT, Logoot, LSEQ, Treedoc, YATA, Fugue), where counters and sets have essentially one each.

---

## Why Indices Fail

### Q4: Walk through a concrete example where two concurrent inserts using integer indices diverge. *(Easy)*

**Answer**: Start with both replicas holding `"HAT"` (indices: H=0, A=1, T=2).

- **Replica 1** inserts `"C"` at index 0 to make `"CHAT"`. It sends `insert("C", pos=0)`.
- **Replica 2** concurrently inserts `"S"` at index 3 to make `"HATS"`. It sends `insert("S", pos=3)`.

Now they exchange operations:

- Replica 1 applies `insert("S", pos=3)` to its current `"CHAT"`. Position 3 in `"CHAT"` is *between A and T*, giving `"CHSAT"` — wrong.
- Replica 2 applies `insert("C", pos=0)` to its `"HATS"`, giving `"CHATS"` — correct by luck on this one, wrong on the other.

Result: Replica 1 = `"CHSAT"`, Replica 2 = `"CHATS"`. **Divergence.** The integer `pos` was valid only against the document state the originating replica saw; it became meaningless once another concurrent edit shifted everything.

---

### Q5: Could you fix index-based inserts by just transforming the index against concurrent operations? *(Medium)*

**Answer**: Yes — and that is exactly what **Operational Transformation (OT)** does. When Replica 1 receives `insert("S", pos=3)` but knows a concurrent `insert("C", pos=0)` was applied first, it *transforms* the incoming position: an insert before pos=3 shifts it to pos=4, yielding `"CHATS"` correctly.

So indices *can* be made to work, but the price is a transformation function that must correctly handle every pair of operation types (insert/insert, insert/delete, delete/delete) against every relative position, and — crucially — apply transforms in a causally consistent order. Getting these transformation functions provably correct is notoriously hard (the field has a history of published-then-retracted correctness proofs). OT also typically assumes a central server to impose a canonical order on operations. CRDTs take the opposite route: instead of transforming positions, make positions immutable and globally meaningful so no transformation is ever needed.

---

### Q6: Why doesn't appending a replica ID to the index solve the problem? *(Medium)*

**Answer**: Tagging position 3 with "from replica 2" disambiguates *which* operation it is, but it does not make 3 mean the same thing everywhere. The integer 3 is an index *into a particular document state*. After a concurrent insert at the front, every existing element's index changed; the tag tells you who inserted but not where the insertion point now lives. You'd still have to recompute the index against concurrent operations — which is OT again, not a fix. The lesson: the identity of an insertion position must be **independent of how many other elements exist or where they are**. That is precisely the requirement the next section formalizes.

---

## Stable Identifiers & Fractional Indexing

### Q7: State the formal requirement on the identifiers a sequence CRDT assigns to elements. *(Medium)*

**Answer**: Each element gets a position identifier that must be:

1. **Stable / immutable** — once assigned, it never changes for the life of the element, no matter what is inserted or deleted around it. (Stability is what eliminates OT-style transforms.)
2. **Globally unique** — no two distinct elements, on any replica, ever share an identifier. Usually achieved by including the originating replica ID and a per-replica sequence number/clock.
3. **Totally orderable** — given any two identifiers, all replicas independently compute the same `<` relation. The document is then "all non-deleted elements sorted by identifier."
4. **Densely allocatable** — between any two existing identifiers you can always mint a new one. This is essential: a user can always insert a character between two adjacent characters, so the identifier space must be infinitely subdivisible.

Any scheme satisfying stable + unique + totally-ordered + dense gives you a correct sequence CRDT; the algorithms differ only in *how* they realize these four properties and what they cost.

---

### Q8: What is fractional indexing, and how does it satisfy the dense + ordered requirements? *(Easy)*

**Answer**: Fractional indexing assigns each element a fraction (or arbitrary-precision decimal) as its position. To insert between elements with keys `0.2` and `0.3`, you pick the midpoint `0.25`. Between `0.25` and `0.3` you pick `0.275`, and so on. Ordering is just numeric comparison; density is guaranteed because the rationals are dense — there is always a value strictly between any two distinct values.

It's the simplest mental model for "position as a sortable key." Figma popularized it for ordering layers, and many shared-list features use it because it's trivial to implement on top of an ordinary database row: store a `position` string/decimal column and `ORDER BY` it. Each insert is a local computation of a between-key; no index recomputation, no server coordination for the ordering itself.

---

### Q9: What is the key-growth problem of fractional indexing, and when does it bite? *(Medium)*

**Answer**: Repeatedly inserting in the *same spot* makes keys grow without bound. Insert between `0.1` and `0.2` → `0.15`; insert again at that same left edge → `0.125`; again → `0.1125`; again → `0.10625`… Each "insert at the same boundary" adds digits. The pathological case is holding down a key at the start of a line, or a script appending items always before the same anchor: keys grow linearly in the number of inserts, so storage and comparison cost per element degrade over time.

It bites hardest under **monotone insertion patterns** (always inserting just before/after the same neighbor) and under **adversarial interleaving** between two replicas both subdividing the same gap. It is mostly a non-issue for random or spread-out edits. Mitigations include base-62/64 digit encoding to pack more order into fewer characters, periodic *rebalancing* (reassigning compact keys — but that breaks immutability and requires coordination), and jittering the chosen midpoint to avoid always biasing toward one edge.

---

### Q10: Is plain fractional indexing a full CRDT? What's missing? *(Hard)*

**Answer**: Not by itself. Fractional indexing gives you dense, totally-ordered keys, but two replicas can independently generate the **same** key for two **different** concurrent inserts into the same gap (both compute "midpoint of 0.2 and 0.3" = 0.25). That violates uniqueness and leaves the relative order of the two new elements undefined → potential divergence or, worse, a lost element if keyed in a map.

To make it a CRDT you must **break ties deterministically**, by appending a globally unique, totally-ordered suffix to every key — typically `(fraction, replicaId, counter)` or `(fraction, opId)`. Now `0.25@A < 0.25@B` is well-defined on every replica. With that tiebreaker, fractional indexing becomes a legitimate (and quite practical) sequence CRDT; it is essentially a simplified, single-level Logoot. The fraction provides density and rough order; the replica ID provides uniqueness and deterministic tiebreak. Skipping the tiebreaker is the single most common bug in homegrown "fractional index" implementations.

---

## RGA & Causal Trees

### Q11: Explain how RGA (Replicated Growable Array) represents an insert. *(Medium)*

**Answer**: RGA models the document as a **causal tree / linked structure of "insert-after" relationships**. Every insert names the element it should appear immediately after — its **anchor** (the left neighbor at insertion time) — plus a unique timestamp `(lamportClock, replicaId)` for the new element. So an operation is essentially `insertAfter(anchorId, newId, value)`.

The anchor is *not* an integer index; it is the **immutable ID** of an existing element (or a sentinel "beginning of document"). Because the anchor is an ID, it keeps pointing to the same logical neighbor regardless of what else is inserted or deleted. The document order is obtained by a traversal: start at the head, and at each node, descend into its children (the elements inserted after it), recursively. The whole structure is append-only — elements are never moved, only added and tombstoned.

---

### Q12: When two replicas insert different elements after the *same* anchor, how does RGA decide their order, and why does that converge? *(Hard)*

**Answer**: Both new elements become **children of the same anchor**. RGA orders siblings of a common anchor by their timestamps, in **descending** order — the element with the higher `(lamportClock, replicaId)` comes first (closer to the anchor). Because Lamport timestamps are totally ordered (clock first, replica ID as tiebreak) and every element's timestamp is globally unique, *every replica computes the exact same sibling order independently*. There is no ambiguity and no coordination.

It converges because the final order is a pure function of the set of `(anchorId, timestamp, value)` tuples received — and that set is the same on all replicas once they've synced. Order in, order out, deterministically. The "descending timestamp" convention is what gives the intuitive behavior that a *later* concurrent insert at the same point lands just *before* an earlier one (or after, depending on the convention chosen), but either convention converges as long as it's applied identically everywhere.

---

### Q13: In RGA, what happens to elements that were inserted *after* a character that then gets deleted? *(Medium)*

**Answer**: Nothing structurally — the deleted character is **tombstoned**, not removed. Its node stays in the tree as a placeholder, marked deleted (it contributes no visible content), and its children — the elements inserted after it — remain attached and continue to render. This is why RGA (and causal-tree CRDTs generally) keep tombstones: the deleted element is still needed as a **stable anchor** so that concurrent and future inserts that pointed "after" it still have a valid, totally-ordered home.

This directly answers the classic gotcha "what anchors a concurrent insert next to a deleted char?" — the tombstone does. If you physically removed the node, any in-flight insert referencing it as an anchor would be orphaned and you'd lose the ability to place it deterministically.

---

### Q14: How are RGA and a "causal tree" related? *(Medium)*

**Answer**: They are essentially the same idea under two names. A **causal tree** (Grishchenko) is the abstract model: a tree where each node points to its causal parent (the anchor it was inserted after), and document order is a depth-first, timestamp-ordered traversal. **RGA** (Roh et al.) is a concrete, efficient realization typically implemented as a hash map from ID to node plus a linearized linked list, so that lookups and applies are fast and you don't literally re-traverse a tree on every keystroke. Yjs's YATA and Automerge's RGA-derived list are production descendants. Interview-wise: if asked to "explain the tree model," draw the anchor-parent tree; if asked to "implement efficiently," describe the ID-map + linked-list with timestamp-ordered insertion.

---

## Logoot/LSEQ & Identifier Growth

### Q15: How does Logoot allocate a position identifier? *(Medium)*

**Answer**: Logoot gives each element a **position identifier that is a list of "digits,"** where each digit is a pair `(integer, replicaId)` (sometimes with a clock). Think of it as a number in a positional system, but each digit is decorated with the replica that created it so identifiers are globally unique and totally ordered (compare digit by digit; the decorated digits break ties).

To insert between two existing identifiers `p` and `q`, Logoot finds a new identifier strictly between them. If there's "room" at the current depth (an integer strictly between the leading digits), it picks one. If the two identifiers are adjacent integers, it **appends another digit** (descends a level), creating a new identifier deeper in the tree of positions — exactly like fractional indexing extending precision, but with replica-tagged digits for uniqueness and tiebreak. Order is lexicographic over the digit list; density comes from the unbounded ability to append digits.

---

### Q16: What is identifier bloat in Logoot, and how does LSEQ try to fix it? *(Hard)*

**Answer**: **Bloat** is the same key-growth pathology as fractional indexing: under repeated insertion at the same boundary, identifiers keep gaining digits, so each position string grows and grows. Since every element stores its full identifier and every comparison walks the digits, both memory and per-operation cost degrade with edit history, not document size. For a document edited by many people over a long time, IDs can become the dominant storage cost.

**LSEQ** attacks this by making the allocation strategy adaptive rather than fixed:

- It **doubles the base (bit-width) at each new depth** (so deeper levels have exponentially more room, slowing how fast you must descend).
- At each level it **randomly alternates between two allocation strategies** — "boundary+" (allocate near the start of the free interval) and "boundary−" (allocate near the end) — chosen per-level and remembered. This randomization avoids the worst case where a consistent insertion direction always forces a descent, keeping the *expected* identifier length sub-linear (roughly logarithmic) for many real editing patterns.

LSEQ doesn't eliminate growth in the absolute worst case, but it makes the common cases (typing left-to-right, editing in scattered places) behave far better than vanilla Logoot.

---

### Q17: Logoot/LSEQ are "tombstone-free for inserts" in a sense — contrast their position model with RGA's. *(Hard)*

**Answer**: The key contrast is **absolute vs relative positioning**:

- **Logoot/LSEQ are absolute**: each element carries a self-contained position identifier (the digit list). Order is determined purely by comparing identifiers; an element does not reference a neighbor. You can drop a Logoot element into a sorted structure and it knows where it goes with no context.
- **RGA is relative**: each element references an **anchor** (its left neighbor's ID). Order emerges from traversing the anchor relationships. An element only knows "I come after X."

Consequences: RGA *must* keep deleted anchors as tombstones so the "after X" relationships remain resolvable. Logoot can delete an element and simply forget its identifier — there's no anchor pointing at it that breaks (though in practice Logoot implementations may still retain tombstones to handle concurrent insert-vs-delete races and to suppress re-inserts). The trade is bloat (Logoot pays in identifier length) versus tombstone retention (RGA pays in retained deleted nodes). Different costs for the same underlying density requirement.

---

## Interleaving Anomalies

### Q18: What is the interleaving anomaly? Give a concrete example. *(Hard)*

**Answer**: Interleaving is when two replicas concurrently insert *contiguous runs* of characters at the same position, and after merge the runs end up **shuffled into each other** instead of staying as two intact blocks — producing garbled, meaningless text that *neither user typed*.

Example: the document is empty. Concurrently, at the same insertion point:

- **Alice** types `"Hello"`.
- **Bob** types `"World"`.

A user would expect either `"HelloWorld"` or `"WorldHello"` — one block then the other. An interleaving CRDT might instead converge to something like `"HWeolrllod"` — Alice's and Bob's characters alternating — because each character was independently inserted "at the same anchor" and the sibling-ordering rule interleaved them by timestamp rather than keeping each author's run together. The result is correct in the CRDT sense (all replicas agree) but a disaster for usability: collaborative text that scrambles concurrent words.

---

### Q19: Which sequence CRDT algorithms suffer interleaving, and which are designed to avoid it? *(Hard)*

**Answer**: 

- **Logoot and LSEQ** are notably **prone to interleaving**, because positions are absolute and independently allocated; two replicas subdividing the same gap can produce identifiers that interleave run-by-run with no notion of "keep this author's contiguous run together."
- **Plain RGA** can also interleave in certain concurrent-insertion scenarios, though its anchor model makes simple "insert after the same character" cases group reasonably.
- **YATA (Yjs)** adds origin/right-origin (left and right neighbor) references and conflict rules specifically aimed at reducing interleaving, keeping concurrent runs largely intact in common cases.
- **Fugue** (Weidner et al., 2022) was designed to provably **avoid interleaving** (it achieves "maximal non-interleaving"), and it's essentially RGA-like with a refined conflict rule. It's the current reference answer for "an algorithm that doesn't interleave."

So the honest interview answer to "do all sequence CRDTs interleave?" is **no** — interleaving is an *anomaly of specific algorithms*, not an inherent property of sequence CRDTs. Choosing or designing the conflict rule determines whether your editor scrambles concurrent words.

---

### Q20: Why is interleaving a *correctness-adjacent* concern even though the CRDT still converges? *(Medium)*

**Answer**: Because CRDT convergence only promises that all replicas agree on *some* total order — it says nothing about that order being *meaningful to humans*. Interleaving documents converge perfectly; every replica shows the same scrambled string. The defect is in the **specification of intent**: users editing text have an implicit expectation that a contiguous run they typed stays contiguous. Interleaving violates that semantic invariant while satisfying the formal one.

This is why modern work (Fugue, and the formal "non-interleaving" criterion) treats non-interleaving as a *property to prove*, alongside SEC. In an interview, demonstrating that you distinguish "mathematically convergent" from "semantically acceptable" is a strong signal — it shows you understand that a CRDT can be correct and still ship a broken editor.

---

## Tombstones & GC

### Q21: Why can't a sequence CRDT just delete an element outright? *(Medium)*

**Answer**: Because of **concurrent operations that reference the deleted element**. Two main reasons:

1. **Anchoring (RGA-style)**: other elements may have been inserted "after" the deleted one; their position depends on the deleted node still existing as an anchor. Remove it and they're orphaned.
2. **Insert-vs-delete races**: a concurrent insert adjacent to the element, or a re-delivery of the original insert, may arrive *after* you processed the delete. If you've forgotten the element entirely, you can't tell "this is a stale re-insert of a deleted element" from "this is a brand-new element," and you might resurrect deleted content.

So deletion is recorded as a **tombstone**: the element is marked deleted (hidden from the rendered document) but kept in the structure with its ID and metadata. Tombstones preserve the information needed to keep concurrent operations resolvable and deterministic.

---

### Q22: Why is garbage-collecting tombstones hard in a sequence CRDT? *(Hard)*

**Answer**: A tombstone can be safely removed only once you are **certain no future operation will ever reference it** — meaning every replica has seen the delete *and* all concurrent operations around it, with no possibility of a delayed message resurrecting the question. Establishing that certainty in a decentralized, partition-tolerant system is exactly the coordination CRDTs were trying to avoid.

The hard parts:

- You need a **causal stability** notion: a tombstone is collectible when all operations concurrent to it have been delivered everywhere and no replica can still send something concurrent. Detecting this requires knowing the progress of *all* replicas (e.g., a vector-clock low-watermark across the membership).
- **Membership is dynamic and possibly unbounded** (open peer-to-peer systems, offline clients that reappear weeks later). An offline replica that comes back could still legitimately reference an old tombstone, so you can't GC while it might return.
- GC is effectively a **distributed agreement** problem layered on a coordination-free structure — many systems therefore either never GC (accept growth), GC only with a coordinating server / snapshot checkpoint, or use schemes that compress runs of tombstones rather than truly removing them.

The deep irony: tombstone GC reintroduces the very coordination that made CRDTs attractive, which is why production systems (Yjs, Automerge) lean on **periodic snapshots/compaction** and document-level garbage collection rather than per-tombstone online GC.

---

### Q23: How do Yjs and Automerge practically manage tombstone/metadata growth? *(Medium)*

**Answer**: They avoid the impossible "online distributed GC" problem and instead **compact**:

- **Yjs** keeps deleted items but represents deletions compactly via a **delete set** (run-length-encoded ranges of deleted IDs) rather than a heavyweight tombstone object per character, and it merges adjacent items/structs aggressively. It also supports a `gc` flag that drops the *content* of deleted items (keeping only the structural placeholder) so memory shrinks even though the structure remains.
- **Automerge** stores operations in a compressed, columnar binary format and produces **snapshots/saves** that fold history into a compact representation; loading a saved document doesn't replay every keystroke.

The shared strategy: never try to prove global safety for each tombstone in real time. Instead, encode tombstone metadata cheaply, and periodically checkpoint/compact (often with light coordination or at natural sync points) so the asymptotic cost is tolerable in practice even if not theoretically GC-free.

---

## CRDT vs OT

### Q24: At a high level, how do CRDT and OT differ in approach to collaborative text? *(Medium)*

**Answer**: 

- **OT (Operational Transformation)** keeps **integer positions** and, on receiving a remote operation, **transforms** it against concurrent operations so its position is corrected for the current state. Convergence relies on transformation functions plus, usually, a **central server** that sequences operations into a canonical total order. The data is "just text"; the cleverness is in the transform.
- **CRDT** replaces positions with **stable unique identifiers** so operations **commute as-is** — no transformation, no required central sequencer. The cleverness is in the *data structure / identifier scheme*; the apply logic is simple and order-independent. The cost is metadata (per-element IDs, tombstones).

Slogan: OT moves the complexity into the algorithm that adjusts operations; CRDT moves it into the data structure that makes operations inherently mergeable.

---

### Q25: Why does Google Docs use OT rather than a CRDT? *(Hard)*

**Answer**: Google Docs predates the maturation of efficient sequence CRDTs and was built around a **central server architecture**, which plays to OT's strengths:

- With a guaranteed central authority sequencing edits, OT only needs to handle transformation against a linear server-ordered history — much simpler than the full concurrent OT problem and well-trodden by the time Docs shipped.
- OT keeps the **on-the-wire and on-disk representation as plain positions/text**, with **no per-character ID or tombstone overhead**. For a server-mediated product at Google's scale, that lean representation is attractive.
- The server can store the document compactly (the actual text) and doesn't carry CRDT metadata that grows with edit history.

In short: when you *have* a reliable central server (which Docs always assumed), OT's overhead is lower and its model fits. CRDTs shine precisely when you *can't* assume that server — which is the next question.

---

### Q26: Why do local-first and peer-to-peer applications favor CRDTs? *(Medium)*

**Answer**: Local-first apps are built on the premise that **each device owns a full, usable copy of the data** and can read, write, and edit **fully offline**, syncing peer-to-peer or through dumb relays whenever connectivity allows — with **no authoritative central server** required for correctness. That is exactly the regime where OT struggles (no canonical sequencer) and CRDTs excel:

- CRDT operations **commute without a coordinator**, so any device can apply local and remote edits in any order and still converge — perfect for ad-hoc, intermittent, multi-peer sync.
- **Idempotence** makes unreliable, at-least-once gossip/sync safe.
- Merging is a **pure function of the operation set**, so a device that's been offline for a week can rejoin and merge deterministically without replaying against a server timeline.

The trade-off local-first accepts is the CRDT metadata/tombstone overhead — judged worthwhile because the alternative (a central server) defeats the entire local-first premise. This is why Yjs, Automerge, and similar libraries are the backbone of the local-first movement.

---

### Q27: What is Peritext, and what problem in rich-text CRDTs does it address? *(Hard)*

**Answer**: **Peritext** (Ink & Switch) is a CRDT for **rich text** — text with *formatting spans* (bold, italic, links, headings) — not just plain characters. The hard problem it tackles is **concurrent formatting over overlapping ranges that are themselves being edited**.

Plain sequence CRDTs handle character order, but formatting introduces *intervals* ("bold from position X to Y"). Under concurrency you get nasty cases: two users bold overlapping but different ranges; one user types inside a range another user is un-bolding; a range's endpoints must "stick" to the right characters even as text is inserted/deleted at the boundaries. Peritext represents formatting as **marks anchored to character positions** (with boundary semantics — does inserting at the edge of a bold span inherit bold?) and defines deterministic, convergent merge rules for overlapping and conflicting marks that match user expectations. It's the reference design for "how do I do Google-Docs-like styling in a CRDT," and citing it signals you know rich text is meaningfully harder than plain text.

---

## System Design

### Q28: Design a collaborative plain-text editor backed by a sequence CRDT. What are the core components? *(Hard)*

**Answer**: Core components:

1. **CRDT document model** — a sequence CRDT (RGA/YATA via Yjs, or Automerge) storing characters with stable IDs and tombstones. Each local edit (insert/delete) becomes an operation with a unique ID `(replicaId, counter)` and the appropriate anchor/position metadata.
2. **Local editing binding** — translate editor (CodeMirror/ProseMirror/textarea) cursor operations into CRDT operations and apply remote operations back into the editor view, mapping CRDT positions ↔ visible offsets.
3. **Sync/transport layer** — exchange operations or state vectors between peers. Options: a relay/WebSocket server (still "dumb" — just fan-out and persistence), WebRTC for P2P, or store-and-forward for offline. Use **state vectors / version vectors** to compute deltas (send only what the peer is missing) instead of full state.
4. **Persistence** — append operations to a log and/or periodically snapshot the compacted document (for fast load and tombstone compaction).
5. **Presence/awareness** — ephemeral, non-persisted data: cursors, selections, who's online. Handled outside the CRDT (it doesn't need to converge/persist; last-write or per-client state is fine).

Key decisions to call out: which conflict rule (interleaving behavior), how/when to compact tombstones, and how cursors track positions (next question).

---

### Q29: How do you implement remote/multiplayer cursors so they don't jump to the wrong place after concurrent edits? *(Hard)*

**Answer**: The mistake is to broadcast cursors as **integer offsets** ("cursor at position 42") — exactly the index problem that broke inserts. After a concurrent insert before offset 42, that offset now points to a different character; the remote cursor visibly jumps.

The fix: anchor cursors to **stable element IDs**, not offsets. Store a cursor as "**before/after element with ID X**" (and a bias for whether it sticks left or right when text is inserted at that exact point). When a concurrent insert happens nearby, element X keeps its identity, so the cursor stays attached to the same logical spot. To render, look up X's current visible offset in the CRDT and place the caret there. This is sometimes called a **relative position** (Yjs has `Y.RelativePosition`/`createRelativePositionFromTypeIndex` for exactly this). If the anchored element gets deleted, fall back to the nearest surviving neighbor (the tombstone still lets you find it deterministically). Cursors are ephemeral presence, so they don't need to persist or be tombstoned — but they *do* need stable anchoring to behave correctly under concurrency.

---

### Q30: Design a shared todo list (reorderable items, offline edits). Do you need a full text CRDT? *(Medium)*

**Answer**: You need an **ordered-list CRDT**, but the elements are whole items, not characters — and the simplest sufficient tool is usually **fractional indexing with a unique tiebreaker**, not a heavyweight RGA. Design:

- Each todo item is a record with its own unique ID and a **fractional position key** `(fraction, replicaId)`. List order = items sorted by that key.
- **Insert / reorder**: compute a between-key for the new neighbors locally; no coordination. Reordering an item is just assigning it a new position key between its new neighbors.
- **Item fields** (text, done-flag): can be their own small CRDTs — e.g., the `done` boolean as an LWW-register or enable-wins flag (see [Set CRDTs interview](../04-sets-or-set-lww/interview.md)), the title as either LWW or a tiny text CRDT if you want concurrent title edits.
- **Delete**: tombstone the item (mark removed) so a concurrent edit doesn't resurrect it; compact tombstones at sync/snapshot time.

A full per-character text CRDT for each title is overkill unless users genuinely co-edit individual titles character-by-character. Match the structure to the granularity of concurrency: list-level for ordering, register/flag-level for fields. Watch the fractional-index key-growth if items are frequently reordered into the same slot.

---

### Q31: How do you sync efficiently — full state or deltas? *(Medium)*

**Answer**: Send **deltas**, computed from **version/state vectors**. Each replica maintains a vector summarizing how many operations it has from each origin replica. To sync, peer A sends its state vector; peer B replies with exactly the operations A is missing (a delta) and its own vector; A reciprocates. This is O(difference), not O(document) — critical for large documents and frequent small edits.

Yjs implements this directly (`encodeStateVector` → `encodeStateAsUpdate(doc, remoteVector)`), and **delta-state CRDTs** generalize the idea: ship small "delta states" that join into the full state, getting the convergence of state-based CRDTs with the bandwidth of operation-based ones. For brand-new peers (empty vector) you do send a full (compacted) snapshot once, then deltas thereafter. Always pair this with idempotent apply so a re-sent delta is harmless.

---

## Gotcha / Trick

### Q32: "Can't you just reuse integer positions if you renumber after every edit?" *(Medium)*

**Answer**: Renumbering means every replica must agree on the new numbering, which requires them to agree on the order of *all* concurrent edits first — i.e., you've assumed the very total order you were trying to construct, and you'd need coordination (a server or consensus) to do the renumbering consistently. Renumbering also breaks **identifier stability**: cursors, in-flight operations, and anchors that referenced old positions are all invalidated, so you'd have to transform them (OT, again). Integer positions are reusable *only* under a central sequencer that imposes order before assigning numbers — which is OT/server architecture, not a coordination-free CRDT. The whole point of stable IDs is to never renumber.

---

### Q33: "Why not just sort everything by wall-clock timestamp?" *(Medium)*

**Answer**: Two problems, one fatal:

1. **Clocks aren't synchronized or monotonic across machines** — clock skew, NTP corrections, and clock drift mean a "later" edit can carry an *earlier* timestamp. Sorting by wall-clock would order edits inconsistently with causality and could even reorder a single user's own keystrokes.
2. **Wall-clock ordering loses the *position* relationship entirely.** Sequence order isn't "who typed most recently" — it's "where in the text does this character sit." Two characters typed seconds apart can be adjacent or paragraphs apart. Time says nothing about spatial position in the document.

What you actually want is a **logical clock** (Lamport/vector) for *tiebreaking* between concurrent inserts at the *same position*, combined with a **position identifier** (anchor or fractional key) for the spatial relationship. Lamport timestamps respect causality (a → b ⇒ ts(a) < ts(b)) and are totally ordered with a replica-ID tiebreak — which is exactly why RGA uses them for sibling ordering, not wall-clock time.

---

### Q34: "What anchors a concurrent insert that lands right next to a character someone else just deleted?" *(Hard)*

**Answer**: The **tombstone** of the deleted character. In an anchor-based CRDT (RGA/YATA), the concurrent insert was created with `insertAfter(X, …)` where X is the now-deleted character's ID. Because deletion only tombstones X (marks it invisible) rather than removing it, X still exists as a valid, totally-ordered anchor, so the new element slots in deterministically right where it belongs. Both replicas — the one that did the delete and the one that did the insert — resolve the insert against the same tombstone and converge.

If the implementation had *physically removed* X, the insert referencing X as its anchor would be **orphaned**: there's no stable point to attach it to, and different replicas might attach it differently (or drop it), causing divergence. This is the single clearest justification for tombstones: they are the durable anchors that keep concurrent insert/delete races resolvable.

---

### Q35: "Do all sequence CRDTs interleave concurrent words?" *(Medium)*

**Answer**: No. Interleaving is an anomaly of *particular* algorithms and conflict rules, not a law of sequence CRDTs. Logoot/LSEQ are prone to it; plain RGA can interleave in some cases; **YATA (Yjs)** mitigates it with left/right-origin rules; and **Fugue** is specifically designed to provably *avoid* interleaving (maximal non-interleaving). So the correct, precise answer is: "It depends on the conflict-resolution rule. Several modern algorithms keep concurrent runs intact; non-interleaving is a designable property, and Fugue is the canonical example that guarantees it." Asserting "all CRDTs interleave" is a common and wrong simplification.

---

### Q36: "If two replicas generate the same fractional key, who wins?" *(Medium)*

**Answer**: Nobody should "win" by overwriting — that would lose data. The correct design **prevents identical effective keys** by appending a unique, totally-ordered suffix (replica ID + counter, or the operation ID) to every fractional key, so `0.25@A` and `0.25@B` are distinct and deterministically ordered on all replicas. The replica-ID comparison is the tiebreak; both elements survive, in a globally agreed order. If your implementation keys a map purely by the bare fraction, two concurrent inserts collide and one is silently dropped — a real bug. The fix is always: *fraction for rough order + density, unique suffix for uniqueness + deterministic tiebreak.*

---

## Rapid-Fire

Short questions, short answers — drill these until they're reflexive.

**RF1. What breaks when you send "insert at index N"?** *(Easy)* — Index N means different positions on different replicas after concurrent edits → divergence.

**RF2. Four properties a position identifier must have?** *(Medium)* — Stable, globally unique, totally ordered, densely allocatable.

**RF3. What does RGA insert-after reference — an index or an ID?** *(Easy)* — An immutable element **ID** (the anchor).

**RF4. RGA tiebreaks concurrent same-anchor inserts by…?** *(Medium)* — Lamport timestamp `(clock, replicaId)`, deterministically ordered.

**RF5. Why does RGA keep deleted nodes?** *(Medium)* — As tombstone anchors so concurrent inserts stay resolvable.

**RF6. Logoot's identifier is a list of…?** *(Medium)* — Replica-tagged digits, compared lexicographically.

**RF7. What does LSEQ randomize to fight bloat?** *(Hard)* — Per-level allocation strategy (boundary+ / boundary−), with a doubling base.

**RF8. One-word name for the "scrambled concurrent words" defect?** *(Medium)* — Interleaving.

**RF9. Name a CRDT that provably avoids interleaving.** *(Hard)* — Fugue.

**RF10. Does Google Docs use OT or CRDT?** *(Easy)* — OT (central-server architecture).

**RF11. Why does local-first prefer CRDT?** *(Medium)* — Commute without a coordinator; offline-first; safe under unreliable sync.

**RF12. CRDT for rich text (formatting spans)?** *(Hard)* — Peritext.

**RF13. How do you anchor a multiplayer cursor correctly?** *(Medium)* — To a stable element ID (relative position), not an integer offset.

**RF14. Efficient sync: full state or deltas?** *(Medium)* — Deltas via state/version vectors.

**RF15. Cheapest correct ordered-list CRDT for a todo app?** *(Medium)* — Fractional indexing with a `(fraction, replicaId)` tiebreaker.

**RF16. Why not sort by wall-clock time?** *(Medium)* — Clock skew breaks causality, and time doesn't encode position.

**RF17. Why is tombstone GC hard?** *(Hard)* — Needs causal stability across all (possibly offline) replicas → distributed agreement.

**RF18. Yjs's compact deletion representation?** *(Hard)* — Run-length-encoded delete set (+ optional content GC).

---

## Common Mistakes

### Q37: What are the most common mistakes engineers make implementing or discussing sequence CRDTs? *(Medium)*

**Answer**: 

1. **Sending integer indices over the wire.** The original sin. Positions must be stable IDs/anchors/fractional keys, never offsets — and the same goes for cursors.
2. **Fractional indexing without a uniqueness tiebreaker.** Concurrent inserts into the same gap collide; one element silently vanishes. Always append `(replicaId, counter)`.
3. **Physically deleting elements instead of tombstoning.** Orphans concurrent anchors and resurrects deleted content under re-delivery. Tombstone, then compact.
4. **Assuming "converged" means "correct for users."** Ignoring interleaving ships a technically-correct editor that scrambles concurrent words.
5. **Sorting by wall-clock timestamp** for tiebreaks instead of a logical (Lamport/vector) clock — reintroduces causality violations.
6. **Trying to do online distributed tombstone GC** as if it were free; it's effectively distributed agreement. Use snapshots/compaction.
7. **Reaching for a full per-character text CRDT for coarse-grained data** (todo items, list rows) where fractional indexing + per-field registers suffice — paying huge metadata cost for concurrency that doesn't exist at that granularity.
8. **Forgetting idempotence** in the transport, so re-delivered operations duplicate or corrupt state.

---

### Q38: A candidate claims "CRDTs make collaborative editing trivially correct with no downsides." How do you respond? *(Medium)*

**Answer**: Push back precisely. CRDTs give *strong eventual consistency for free of coordination*, which is genuinely powerful — but they carry real costs and caveats: (a) **metadata overhead** — per-element IDs and tombstones that grow with edit history; (b) **GC is hard** — reclaiming tombstones reintroduces coordination; (c) **convergence ≠ usability** — interleaving and formatting anomalies are real and algorithm-dependent; (d) **identifier bloat** (Logoot/LSEQ) or **key growth** (fractional indexing) under adversarial insertion patterns; (e) **rich text is materially harder** (Peritext-level complexity). The mature take is: CRDTs are the right tool when you can't assume a central sequencer (local-first, P2P, offline), and OT is competitive — sometimes leaner — when you *can* (server-mediated, like Google Docs). "No downsides" is a red flag; the engineering is all in managing those downsides.

---

## Tips & Summary

### Q39: Give a 60-second whiteboard summary of sequence CRDTs. *(Medium)*

**Answer**: "Plain integer indices break under concurrency because the same index means different positions on different replicas. The fix is to give every element a **stable, unique, totally-ordered, densely-allocatable** position identifier, so insert/delete operations commute and replicas converge with no coordination. Three families realize this: **fractional indexing** (a sortable between-key plus a replica-ID tiebreak — simple, but keys grow under repeated same-spot inserts); **RGA / causal trees** (insert *after* an immutable anchor, tiebreak concurrent siblings by Lamport timestamp, keep deleted nodes as tombstone anchors); and **Logoot/LSEQ** (self-contained replica-tagged digit identifiers — absolute positions, but prone to identifier bloat and interleaving). A key anomaly is **interleaving** — concurrent words scrambling together — which Logoot/LSEQ suffer and **Fugue** provably avoids. **Tombstones** are required so concurrent insert/delete races stay resolvable, and **GC'ing them is hard** because it needs causal stability across all replicas. Finally, **CRDT vs OT**: OT transforms integer positions and wants a central server (Google Docs); CRDTs make operations inherently commutative and shine in **local-first / offline / P2P** settings (Yjs, Automerge)."

---

### Q40: What signals separate a strong answer from a weak one on this topic? *(Easy)*

**Answer**: 

- **Weak**: "Use a CRDT, it handles conflicts." No mechanism, no trade-offs.
- **Solid**: explains *why indices fail*, names the stable-ID requirement, describes one algorithm (usually RGA) end to end, and knows tombstones exist.
- **Strong**: distinguishes RGA (relative/anchored) from Logoot (absolute), explains the **interleaving anomaly** and that it's algorithm-dependent (cites Fugue/YATA), articulates **why tombstone GC is hard**, and gives a crisp **CRDT-vs-OT** decision rule grounded in "do you have a central sequencer?" Bonus: mentions **Peritext** for rich text, **relative positions** for cursors, and **delta/state-vector sync** for efficiency.

The throughline interviewers reward: you understand that the entire field exists to **encode position in a concurrency-proof way**, and that every algorithm is a different point on the trade-off curve between metadata cost, identifier growth, and interleaving behavior.

---

**Next steps**: drill the fundamentals in [CRDT Fundamentals interview](../01-crdt-fundamentals/interview.md), contrast with merge semantics in [Set CRDTs interview](../04-sets-or-set-lww/interview.md), and go deeper via [junior](junior.md), [senior](senior.md), and [professional](professional.md).
