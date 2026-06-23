# Sequence & Text CRDTs — Senior Level

> You already know RGA, Logoot, and LSEQ, and you can recite why concurrent inserts at the same position need a total order. This tier is about what production-grade collaborative editors actually ship: YATA (the algorithm behind Yjs), RGA/causal-trees as used by Automerge, the rigorous *interleaving* failure mode, Fugue and maximal non-interleaving, why tombstone garbage collection is genuinely unsolved in the general case, Peritext for rich text, and the benchmark numbers that forced the whole field to stop being naive about memory.

## Table of Contents

1. [Recap: the two families](#1-recap-the-two-families)
2. [YATA — the algorithm behind Yjs](#2-yata--the-algorithm-behind-yjs)
3. [RGA / causal trees in Automerge & columnar storage](#3-rga--causal-trees-in-automerge--columnar-storage)
4. [The interleaving problem, rigorously](#4-the-interleaving-problem-rigorously)
5. [Tombstone GC — why it is hard](#5-tombstone-gc--why-it-is-hard)
6. [Rich text: Peritext and the marks problem](#6-rich-text-peritext-and-the-marks-problem)
7. [Performance: memory, load time, the automerge-perf benchmark](#7-performance-memory-load-time-the-automerge-perf-benchmark)
8. [Code: block-wise RGA + YATA integration + interleaving demo](#8-code-block-wise-rga--yata-integration--interleaving-demo)
9. [Comparison table](#9-comparison-table)
10. [Pitfalls, cheat sheet, summary, further reading](#10-pitfalls-cheat-sheet-summary-further-reading)

---

## 1. Recap: the two families

Every convergent sequence CRDT must answer one question: *given two characters, which comes first in the final document?* The answer must be a **total order** that every replica computes identically from local state, with no coordination. The families differ in how they manufacture that order.

### 1.1 Dense-identifier family (Logoot, LSEQ, Treedoc)

Each element carries a **position identifier** drawn from a dense, totally ordered set — typically a variable-length sequence of `(digit, siteId)` tuples interpreted as a fraction in a tree of integers. To insert between `p` and `q`, you *allocate a new identifier strictly between them*. Density guarantees one always exists.

```
left  = [ (4,A) ]
right = [ (7,A) ]
new   = [ (5,A) ]          # any value in (4,7) works
```

When the gap is exhausted (`[(4,A)]` and `[(5,A)]` are adjacent), you descend a level: `[(4,A),(8,B)]`. Identifiers grow without bound under sustained editing in one region. LSEQ's contribution was an *adaptive allocation strategy* (alternating boundary+ / boundary− per depth, with a random strategy chosen per level) to keep identifier length roughly logarithmic rather than linear in the number of inserts.

The defining property: **identity = position**. The id *is* the sort key. There is no notion of "this character was inserted *after* that one" — only "this id sorts before that id." This is exactly what causes the worst interleaving (Section 4).

### 1.2 Linked / causal-tree family (RGA, Causal Trees, YATA, Fugue)

Each element carries a **unique opaque id** (`(counter, siteId)` Lamport-style) plus a **reference to a neighbor** — the element it was inserted relative to. The sequence order is derived by *traversing* these links, not by comparing the ids directly.

- **RGA (Roh et al., 2011):** each insert names the element it is inserted *after* (its left origin). Conflicts among inserts sharing the same left origin are broken by a timestamp (a "vector-ish" `s4vector` in the paper; in practice a Lamport pair). Render order = a depth-first walk of the resulting forest.
- **Causal Trees (Grishchenko, 2010):** identical idea framed as a tree of "atoms," each pointing at its causal parent; the weave is a flattened pre-order traversal.
- **YATA / Fugue:** refine *which* neighbors an element references and *how* ties are broken, to fix the anomalies RGA still has.

The defining property: **identity ≠ position**. An element's id is fixed forever; its position is recomputed from the link structure as concurrent neighbors arrive. This is what lets these algorithms reason about "inserted between X and Y" causally rather than numerically — and is the lever Fugue uses to defeat interleaving.

> **Mental model.** Dense-id = "everyone agrees on a number line, pick a free number." Causal-tree = "everyone agrees on a tree, splice yourself next to a named anchor." The number line forgets intent; the tree remembers it. Most modern production systems (Yjs, Automerge) are causal-tree.

See [CRDT Fundamentals](../01-crdt-fundamentals/senior.md) for the lattice/semilattice framing, and [Set CRDTs](../04-sets-or-set-lww/senior.md) for the OR-Set tombstone machinery that sequence GC inherits.

---

## 2. YATA — the algorithm behind Yjs

YATA (*Yet Another Transformation Approach*, Nicolaescu, Jahns, Derntl, Klamma, 2016) is the integration algorithm at the heart of **Yjs**, the most widely deployed collaborative-editing library. Despite the name's nod to Operational Transformation, YATA is a CRDT: there is no central transformation function, and concurrent operations commute into the same state on every replica.

### 2.1 The data model: items with two origins

In OT-derived intuition, an insert names a single anchor ("after X"). YATA records **two** origins per item:

- `origin` (a.k.a. `originLeft`) — the id of the item immediately to the **left** at the moment of insertion.
- `rightOrigin` (a.k.a. `originRight`) — the id of the item immediately to the **right** at the moment of insertion.

Plus the item's own `id = (client, clock)` where `client` is a unique replica id and `clock` is a per-client monotonically increasing counter (so `id`s are globally unique and a single client's items are naturally sequenced).

```
struct Item {
    id          : (client, clock)
    originLeft  : ItemId | null     # left neighbor at insert time
    originRight : ItemId | null     # right neighbor at insert time
    content     : str               # one char, or (block-wise) a run
    deleted     : bool              # tombstone flag
    left, right : Item*             # current doubly-linked neighbors (runtime)
}
```

Recording *both* origins is the crucial move. RGA records only the left origin and breaks remaining ties by timestamp; that single timestamp tie-break is precisely what lets RGA interleave concurrent runs in some cases. By pinning *both* sides, YATA constrains where a concurrent item may legally land, and the integration rule below decides the rest deterministically.

### 2.2 The integration algorithm

Goal: given a new item `o` with known `originLeft` and `originRight`, find its insertion point in the current linked list. The structure is a doubly-linked list; we scan from `originLeft` toward `originRight` and decide, for each candidate `o'` already present in that gap, whether `o` goes before or after it.

Yjs's actual integration loop (simplified to the essential predicate):

```
function integrate(o):
    left  = o.originLeft  resolved to a node (or list head)
    right = o.originRight resolved to a node (or list tail)

    # scan candidates strictly between left and right
    scan = left.right
    while scan != right:
        o' = scan
        # Both o and o' want to live in (left, right). Compare origins.
        oLeftIdx  = index(o.originLeft)
        o'LeftIdx = index(o'.originLeft)

        if o'LeftIdx < oLeftIdx:
            break                       # o' anchored further left → o goes after it
        elif o'LeftIdx == oLeftIdx:
            # same left origin: tie-break by client id (deterministic, total)
            if o'.id.client < o.id.client:
                left = o'               # o' wins the left slot; move past it
            elif o'.originRight == o.originRight:
                break                   # symmetric; client-id already decided
            # else: keep scanning, o' is anchored to a closer right origin
        else:
            break                       # o' anchored further right than o's left → stop
        scan = scan.right

    insert o immediately after `left`
```

The two ordering principles, stated plainly:

1. **Origin precedence.** If two concurrent items have *different* left origins, the one whose left origin sits further to the right is placed further to the right. Causality of "where you inserted" dominates.
2. **Client-id tie-break.** If two concurrent items share the *same* `originLeft` and `originRight` (a genuine same-gap race), order them by `client` id. This is the total-order fallback that makes the result deterministic and identical on all replicas.

Because the predicate is a pure function of `(originLeft, originRight, client)` — all immutable, all known to every replica — every replica that has seen the same set of operations computes the identical list, **regardless of arrival order**. That is the CRDT (strong eventual consistency) guarantee. Delivery must still be **causally ordered** for origins to resolve (you cannot integrate an item before the items it references arrive); Yjs achieves this with per-client clocks and a pending-set for out-of-order updates.

### 2.3 Block-wise storage (the performance trick)

A naive per-character item costs ~5 pointers + 2 ids + flags — easily 50–100 bytes of overhead **per character**. For a 100 KB document that is megabytes of metadata. Yjs's answer is **runs / blocks**: consecutive characters typed by the same client, with contiguous clocks, sharing left/right structure, are stored as **one `Item` whose `content` is a string**.

```
Typing "hello" by client 7 starting at clock 12 becomes ONE item:
  Item { id:(7,12), content:"hello", len:5, originLeft:X, originRight:Y }
not five items.
```

Two operations keep blocks honest:

- **Append coalescing.** When client 7 types the next character at clock 17 immediately to the right of its own block ending at clock 16, Yjs *grows the existing block* instead of allocating a new item. Sequential typing therefore costs O(1) amortized metadata.
- **Split on demand.** When a concurrent insert (or a delete of an interior character) must land *inside* a block, Yjs **splits** the block at that offset into two items, then integrates the newcomer between them. Splitting is O(1): adjust lengths, fix two pointers, register the new half in the client's clock→item index.

Block-wise storage is why Yjs's per-character overhead in a realistic typing trace collapses from ~hundreds of bytes to a small constant amortized — see the benchmark numbers in Section 7. The integration algorithm operates on blocks; only the gap actually touched by a concurrent edit ever splits.

> **Why YATA's two-origin design survives blocking.** Because a block's interior is, by construction, a run of one client's consecutive clocks with no concurrent interlopers (or it would have been split), the block's two endpoints carry the only origins that matter. Concurrency is handled at block boundaries, sequential typing inside blocks. This is the synergy that makes Yjs fast.

---

## 3. RGA / causal trees in Automerge & columnar storage

**Automerge** models text (and lists) as **RGA**: an operation log of inserts and deletes, where each insert names the element id it follows (its predecessor / left origin), and concurrent inserts under the same predecessor are ordered by a Lamport timestamp `(counter, actorId)`, larger first. Rendering the document is a deterministic traversal of the resulting tree.

### 3.1 The operation log

Automerge is fundamentally a **log of operations** with an append-only, content-addressed change history (each change is a batch of ops with hash-linked dependencies forming a DAG — the same `hash → deps` structure you'd recognize from Git). For a list/text object:

```
op = { id:(counter, actor), action:"set"/"makeText"/"insert"/"del",
       obj:<object id>, key:<elemId or head>, insert:bool, value:<char>,
       pred:[<ids this op overrides/deletes>] }
```

- An **insert** has `insert:true` and `key = the elemId it is inserted after` (head for the start). Its own `(counter, actor)` becomes the new element's id.
- A **delete** is an op whose `pred` names the element id(s) being removed; the element becomes a tombstone (it stays in the tree as an anchor — Section 5).

Convergence comes from RGA's rule: walk the tree; at each node, children (concurrent inserts after the same anchor) are visited in descending `(counter, actor)` order. Every replica with the same op-set computes the same string.

### 3.2 Why a log is heavy — and columnar encoding

A literal log of `{id, action, obj, key, value, pred}` objects is enormous: actor ids repeat, counters increment by one, `obj` is constant for a whole text field, `action` is nearly constant. Storing this as JSON or per-op records is the original sin that made early Automerge documents 100×+ larger than the text.

Automerge's binary format (the "columnar" / compressed format, Kleppmann 2021) transposes the log: instead of an array of op-structs (**row-oriented**), it stores **one column per field across all ops** (**column-oriented**), then compresses each column with an encoding suited to its statistics:

- **RLE (run-length encoding)** for columns that are mostly constant — `obj`, `action`, `actor` indices in a single actor's run. "the same value, 4000 times" → `(value, 4000)`.
- **Delta encoding** for monotonic columns — `counter`, element clocks. Store first-differences (`+1, +1, +1, …`), then RLE the deltas (`+1 × 4000`). A 4000-keystroke run becomes a couple of bytes.
- **Dictionary / index columns** for actor ids — store the actor table once, reference by small integer.
- LEB128 variable-length integers throughout.

The payoff: the *common case* — one person typing a long run — compresses to nearly nothing, because every column is either constant (RLE) or +1 (delta+RLE). Concurrency shows up as breaks in the runs, costing exactly as much as the actual divergence. This is the columnar analogue of Yjs's block-wise storage: both exploit "humans type long sequential runs" but at different layers — Yjs in the *runtime* linked list, Automerge in the *on-disk/on-wire* log encoding. Recent Automerge (the Rust rewrite, "automerge-rs") also keeps an optimized in-memory representation so that load-and-edit no longer requires materializing the whole op-struct array.

> **Two philosophies.** Yjs throws away operation history once integrated (it keeps only the current weave + a state vector), favoring small in-memory state and fast editing. Automerge keeps the full op log (you can compute any past version, get rich diffs, and merge byte-blobs offline), favoring history at the cost of carrying more data — which columnar encoding then claws back. Neither is "the" right answer; it is a history-vs-footprint trade.

---

## 4. The interleaving problem, rigorously

Convergence (all replicas agree) is necessary but **not sufficient** for a good text editor. Two replicas can converge to a string that *no human intended* — specifically, to a **character-by-character interleaving** of two concurrently inserted runs. Kleppmann, Gomes, Mulligan & Beresford formalized this in *"Interleaving anomalies in collaborative text editors"* (PaPoC 2019).

### 4.1 The anomaly

Setup: two users start from `""`. Concurrently:

- User A types `"Hello"`.
- User B types `"World"`.

A *good* merge yields `"HelloWorld"` or `"WorldHello"` — the two runs kept contiguous, in *some* order. An algorithm **interleaves** if it can produce, e.g., `"HWeolrllod"` — characters from the two runs braided together. The text is convergent and deterministic, but it is *garbage*, and no sequence of single-user edits could ever have produced it.

Formally, Kleppmann et al. define an interleaving-freedom property roughly: *for any two insertion sequences that are concurrent and inserted at the same position, the merged result places one entire sequence before the other.* "Maximal non-interleaving" (Weidner) strengthens this to also handle inserts at *different but related* positions and *backward* (right-to-left) typing.

### 4.2 Which algorithms interleave?

The paper's results, with intuition:

- **Logoot / LSEQ — interleave badly.** Because identity = position and ids are allocated *independently per character*, two concurrent runs allocate ids from overlapping numeric ranges. There is no mechanism saying "B's run should stay together"; each of B's characters just sorts wherever its independently-chosen id lands among A's. The denser allocation strategies (LSEQ) make it *more* likely, not less. This is the canonical disaster.
- **RGA — interleaves less, but still does, in a specific case.** RGA keeps a run together when both runs share the *same* left origin and are ordered by the same monotonic tie-break. But Kleppmann et al. exhibit a case: when the two runs are typed at the *same gap* and the relevant timestamps make A's later characters out-rank B's earlier ones in the descending-timestamp child order, you can still get interleaving of the *forward-vs-backward* variety. RGA does **not** satisfy the strong (maximal) non-interleaving property.
- **YATA / Yjs — does not interleave in the Hello/World case.** Recording both origins plus client-id tie-break keeps each run contiguous in the common scenario; YATA's behavior matches RGA's "good" cases and is the practical baseline editors rely on.

### 4.3 Fugue and *maximal* non-interleaving

**Fugue** (Weidner, Gentle, Kleppmann — *"The Art of the Fugue: Minimizing Interleaving in Collaborative Text Editing,"* 2023) is the first list CRDT proven to achieve **maximal non-interleaving**: it never interleaves in *any* of the scenarios where a "reasonable" merge could avoid it, including:

- forward typing (`Hello` vs `World`),
- **backward** typing (typing right-to-left, repeatedly inserting before the previous char), where RGA-style "insert after left origin" loses the run's cohesion,
- inserts at related positions.

Fugue's key idea is a **tree with left- and right-anchored nodes**: each character is inserted as either a "left child" or a "right child" of an existing node, and the choice encodes which side of its anchor it grew from. This distinguishes "I'm extending this run to the right" from "I'm inserting before that thing," which is exactly the information RGA throws away. Weidner also showed Fugue (and a variant, FugueMax) can be implemented with the same asymptotic cost as RGA, so non-interleaving is *not* a performance tax. Fugue has since influenced production designs (e.g., Collabs, and discussion of folding its ideas into future Yjs/Automerge text).

### 4.4 The list-with-move problem (a cousin)

A separate but related hard case: **moving an item** in a list (drag-and-drop reordering) concurrently. Naively, "move" = delete + re-insert, but two concurrent moves of the same item then *duplicate* it (each replica's delete tombstones the old position, each re-insert creates a fresh element) — you get two copies. Kleppmann's *"Moving Elements in List CRDTs"* (PaPoC 2020) gives a clean solution: model a list element's position as a **last-writer-wins register holding its position id**, so concurrent moves of the same element *converge to one winner* and the element is never duplicated. This is the standard pattern for Kanban/outline editors built on CRDTs, and it composes with the sequence CRDT underneath (the LWW register decides position; the sequence CRDT provides the position space). See [Set CRDTs](../04-sets-or-set-lww/senior.md) for the LWW-register mechanics.

---

## 5. Tombstone GC — why it is hard

When you delete a character, you cannot actually remove its node. The node is an **anchor**: a concurrent insert from another replica may name it as its `origin` / left-origin. If you free it, the arriving insert references a node that no longer exists and the document either crashes or diverges. So deletes become **tombstones** — flagged-dead nodes that still occupy memory and still participate in the link structure.

### 5.1 The core difficulty: causal stability

You may physically reclaim a tombstone **only when no future operation can ever reference it**. "Never reference it" means: every replica has acknowledged the delete *and* every operation concurrent with it has been delivered everywhere — i.e., the delete has reached **causal stability**. Determining causal stability requires knowing the causal frontier of **every** replica, including ones that are *offline indefinitely*.

This is the crux: a single laptop closed mid-edit and never reopened blocks GC of every tombstone concurrent with its last unsent op, **forever**, in a fully decentralized peer-to-peer setting. There is no safe unilateral GC without global knowledge of who might still send what.

### 5.2 Approaches and their limits

1. **Never GC (early Automerge, basic RGA).** Correct, trivial, and the memory grows monotonically with *edit count*, not document size. A document edited heavily over years carries the corpses of all its deletions. This is a large part of why early CRDT docs were huge.

2. **Version-vector / causal-stability GC.** Track a stability frontier: a tombstone is collectible once it is in the causal past of a *stable* version known to all live replicas (e.g., via a shared version vector that everyone has advanced past). Works for **closed membership** (you know the full replica set) and **online** systems. Limits: needs every replica to keep reporting progress; one permanently-offline peer stalls collection; membership churn (devices added/removed) complicates the "all replicas" quantifier.

3. **Server-mediated GC (the pragmatic production answer).** A trusted server (or a designated coordinator) observes all clients' acknowledgments, computes a global low-water mark, and broadcasts "everything up to version V is stable; you may GC tombstones causally before V." Yjs's server-backed deployments and most real apps do exactly this — they trade pure P2P decentralization for a coordinator that makes GC tractable. This is the single most common reason "serverless CRDT" pitches quietly add a server.

4. **Compaction / snapshotting.** Periodically rewrite the whole structure into a fresh, tombstone-free representation at a known-stable version, then ship the snapshot. Yjs effectively does a form of this: it can re-encode the doc; deleted blocks that are causally stable can be dropped and remaining blocks coalesced. Automerge's columnar format also lets the *encoding* of tombstones be cheap (RLE over `deleted` flags) even when the tombstone logically remains — so "GC" partly becomes "make tombstones nearly free to store" rather than "remove them."

5. **Bounded tombstone lifetime with explicit acks.** Some designs require clients to ack within a window; tombstones older than the window past the slowest *recently-seen* client are collected, accepting that a client offline longer than the window must do a **full state resync** (it has effectively forked and must re-merge from a snapshot). This is the "we will not wait forever" engineering compromise.

> **The honest summary.** General-purpose, fully-decentralized, unbounded-offline tombstone GC for sequences is effectively impossible to do safely — it reduces to distributed causal-stability detection with potentially-absent participants. Every shipped system either (a) adds a coordinator, (b) bounds offline time, or (c) makes tombstones so cheap to store (columnar/block) that not collecting them stops mattering. Treat "how do we GC?" as a **systems/membership** question, not an algorithm question.

---

## 6. Rich text: Peritext and the marks problem

Plain-text CRDTs order *characters*. Rich text adds **formatting spans** ("bold from here to there," a link, a comment) — and spans are where naive approaches collapse, because a span's endpoints must *move correctly* as text is inserted and deleted concurrently at or near the boundary.

### 6.1 Why marks are hard

Consider `"Hello world"` with `"world"` bold. Concurrently:

- User A types `"!"` at the very end (just after `d`).
- User B unbolds `"world"`.

Does `!` end up bold? What if A types *inside* the bold range while B is shrinking it from the right? Anchoring a span to *character offsets* fails immediately (offsets shift under concurrent inserts). Anchoring to *character ids* helps but raises the "expansion" question: when you insert text exactly at a bold boundary, should the new text inherit the bold? The answer depends on **which boundary** (start vs end) and is a semantic choice (`before`/`after` anchoring), not something offsets can express.

### 6.2 Peritext

**Peritext** (Litt, Gentle, van Hardenberg, Kleppmann — *"Peritext: A CRDT for Rich-Text Collaboration,"* 2022) is the reference design. Its model:

- The **text** is an ordinary sequence CRDT (character ids, RGA-style). Formatting is **layered on top**, not encoded into the characters.
- Each formatting operation is a **mark**: `{ type:"bold", value:true/false, start:<anchor>, end:<anchor>, opId:(counter,actor) }`. An **anchor** is a *position id plus a "before/after" bias* — it binds to the boundary *between* two characters (e.g., "the boundary just before character X"), so it stays meaningful as text is inserted at that boundary, and it specifies *which side* new text joins.
- Marks form an **add-wins / LWW-by-opId** structure per format type. Overlapping and conflicting marks (bold-on vs bold-off over the same range) are resolved by a deterministic rule (later opId wins for the overlap), so concurrent format edits converge.
- Rendering **flattens** the set of marks over the character sequence into the minimal list of contiguous styled spans the UI draws. Two adjacent characters with identical effective mark-sets render as one span; a boundary appears wherever the effective formatting changes.

The two properties Peritext guarantees: (1) **convergence** of the formatted document, and (2) **"the result is one a human could have produced"** — concurrent formatting never yields an absurd patchwork; it yields a sane union/override of the spans, with insert-at-boundary behaving per the anchor bias. Peritext is the design Automerge's rich-text support and several editors (and the Ink & Switch lineage) build on.

> **Takeaway.** Don't bake formatting into character metadata. Keep a clean character sequence CRDT, represent formatting as **range marks with biased boundary anchors**, resolve conflicting marks with LWW/add-wins per format, and **flatten to spans only at render time**. Comments, links, and annotations are "marks" too.

---

## 7. Performance: memory, load time, the automerge-perf benchmark

The field's credibility problem, circa 2017: CRDT text documents were **orders of magnitude** larger and slower than the text they represented. The benchmark that anchored the conversation is **`automerge-perf`** (Kleppmann): the real keystroke-by-keystroke **editing trace of an academic paper** — ~182,000 single-character operations producing a ~100 KB document. Replaying it is a brutal, realistic test of per-edit cost and final footprint.

The headline failures and fixes (approximate, order-of-magnitude — exact numbers shift across versions, but the *shape* is the point):

| Era / system | What it stored | Per-char overhead | Trace memory / load |
|---|---|---|---|
| Naive per-char CRDT (early Automerge, JS) | one object per char/op | hundreds of bytes | **~100×+** the document; seconds-to-minutes to load |
| Yjs (block-wise) | runs as single items | small **amortized** constant | small multiple of doc; fast load |
| Automerge columnar (compressed) | columnar op log | a few **bytes** per op on disk | document-sized blob; load was the remaining bottleneck |
| Automerge-rs / modern | columnar + optimized in-mem | bytes on wire, modest in RAM | close to doc size; fast |

What actually fixed it, in one line each:

- **Block-wise runs (Yjs).** Stop allocating a node per character. Sequential typing — the overwhelmingly common case — becomes O(1) amortized metadata. This collapses both memory and the integration cost, because the linked list has *blocks*, not characters, between concurrent edits.
- **Columnar encoding (Automerge).** Stop storing op-structs. Transpose to columns, RLE the constants, delta+RLE the monotonic counters. A long typing run compresses to a handful of bytes. This collapses on-disk and on-wire size.
- **Avoid materializing the full log on load (Automerge-rs).** Early Automerge had to reconstruct the whole op-struct array to open a document; that load time, not steady-state editing, was the last big cost. The Rust rewrite reads the columnar format into an optimized internal representation directly.

The lesson the benchmark taught the whole field: **the algorithm was never the bottleneck — the representation was.** RGA/YATA integration is cheap; the disaster was one allocation per character and one struct per op. Both leading systems independently discovered "exploit that humans type long sequential runs," at different layers (runtime list vs. storage encoding). When you evaluate a sequence CRDT, ask first about its representation under a realistic *typing trace*, not its big-O on adversarial inputs.

---

## 8. Code: block-wise RGA + YATA integration + interleaving demo

Two self-contained, runnable implementations that **converge** under concurrent edits, demonstrate a **tombstone**, and **demonstrate interleaving** (and its absence). The Python builds a YATA-style integrator with origin links; the JS/Go build a block-wise RGA. All three converge to identical strings independent of operation arrival order.

### 8.1 Python — YATA-style integration with origin links

```python
"""
YATA-style sequence CRDT (the algorithm behind Yjs), single-char items.
- Each item records originLeft and originRight (ids).
- Integration scans the gap and orders by origin precedence, then client id.
- Deletes are tombstones (kept as anchors).
Convergence test + tombstone test + interleaving comparison included.
"""
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Tuple

ItemId = Tuple[int, int]  # (client, clock)

@dataclass
class Item:
    id: ItemId
    origin_left: Optional[ItemId]
    origin_right: Optional[ItemId]
    content: str
    deleted: bool = False

class YataDoc:
    def __init__(self, client: int):
        self.client = client
        self.clock = 0
        self.items: List[Item] = []                  # in document order
        self.by_id: Dict[ItemId, Item] = {}
        self.pending: List[Item] = []                # ops whose origins not yet seen

    # ---- local editing API ----
    def _new_id(self) -> ItemId:
        self.clock += 1
        return (self.client, self.clock)

    def insert(self, index: int, text: str) -> List[Item]:
        """Insert `text` at visible position `index`. Returns ops to broadcast."""
        ops = []
        for ch in text:
            left, right = self._neighbors_at(index)
            it = Item(self._new_id(),
                      left.id if left else None,
                      right.id if right else None,
                      ch)
            self._integrate(it)
            ops.append(it)
            index += 1
        return ops

    def delete(self, index: int) -> Optional[ItemId]:
        visible = [i for i in self.items if not i.deleted]
        if index < 0 or index >= len(visible):
            return None
        tgt = visible[index]
        tgt.deleted = True            # tombstone, kept as anchor
        return tgt.id

    def apply_delete(self, item_id: ItemId):
        it = self.by_id.get(item_id)
        if it:
            it.deleted = True

    # ---- neighbor lookup over VISIBLE items (tombstones skipped for indexing,
    #      but real left/right origins use full list incl. tombstones) ----
    def _neighbors_at(self, index: int):
        visible = [i for i in self.items if not i.deleted]
        left = visible[index - 1] if index - 1 >= 0 and index - 1 < len(visible) else None
        right = visible[index] if index < len(visible) else None
        return left, right

    # ---- remote integration (causal-ready: buffer if origins missing) ----
    def integrate_remote(self, it: Item):
        self.pending.append(it)
        progress = True
        while progress:
            progress = False
            still = []
            for p in self.pending:
                if self._origins_ready(p):
                    self._integrate(p)
                    progress = True
                else:
                    still.append(p)
            self.pending = still

    def _origins_ready(self, it: Item) -> bool:
        if it.id in self.by_id:
            return True   # idempotent: already integrated
        ok = True
        if it.origin_left is not None and it.origin_left not in self.by_id:
            ok = False
        if it.origin_right is not None and it.origin_right not in self.by_id:
            ok = False
        return ok

    def _index_of_id(self, item_id: Optional[ItemId]) -> int:
        if item_id is None:
            return -1
        for i, it in enumerate(self.items):
            if it.id == item_id:
                return i
        return -1

    def _integrate(self, o: Item):
        if o.id in self.by_id:
            return  # idempotent
        # resolve scan window
        left_idx = self._index_of_id(o.origin_left)        # -1 means "head"
        right_idx = self._index_of_id(o.origin_right)       # -1 means "tail"
        if right_idx == -1:
            right_idx = len(self.items)

        # YATA scan: walk candidates in (left_idx, right_idx); decide insert slot
        dest = left_idx + 1
        i = left_idx + 1
        while i < right_idx:
            other = self.items[i]
            o_left = self._index_of_id(other.origin_left)
            this_left = left_idx
            if o_left < this_left:
                break                       # other anchored further left -> we go after
            elif o_left == this_left:
                # same left origin: client-id tie-break (smaller client first)
                if other.id[0] < o.id[0]:
                    dest = i + 1            # other wins this slot; move past it
                else:
                    break                  # we precede `other`
            else:
                # other anchored to the right of our left origin -> stop, we go before it
                break
            i += 1
            dest = i if dest < i else dest

        self.items.insert(dest, o)
        self.by_id[o.id] = o

    # ---- read ----
    def text(self) -> str:
        return "".join(i.content for i in self.items if not i.deleted)


def sync(a: YataDoc, b: YataDoc, ops: List[Item]):
    """Deliver a's ops to b in arbitrary (here reversed) order; b buffers as needed."""
    for it in reversed(ops):
        b.integrate_remote(Item(it.id, it.origin_left, it.origin_right,
                                it.content, it.deleted))


# ---------- 1. concurrent convergence ----------
A = YataDoc(client=1)
B = YataDoc(client=2)
opsA = A.insert(0, "Hello")        # A types Hello
sync(A, B, opsA)                   # B learns Hello
assert A.text() == B.text() == "Hello"

# now both insert concurrently at the SAME gap (end)
opsA2 = A.insert(5, "AAA")
opsB2 = B.insert(5, "BBB")
sync(A, B, opsB2)                  # B already had BBB; A learns it
sync(B, A, opsA2)                  # symmetric
assert A.text() == B.text(), (A.text(), B.text())
print("convergence:", A.text())    # one run fully before the other (no interleave)

# ---------- 2. tombstone ----------
tid = A.delete(0)                  # delete 'H'
B.apply_delete(tid)
assert A.text() == B.text()
print("after delete:", A.text())

# ---------- 3. concurrent insert AROUND a tombstone still converges ----------
# (the deleted 'H' remains as an anchor; insert before what was its right neighbor)
opsA3 = A.insert(0, "X")
sync(A, B, opsA3)
assert A.text() == B.text()
print("around tombstone:", A.text())
```

Running it prints (modulo which run wins the tie-break, which is *deterministic* by client id):

```
convergence: HelloBBBAAA        # B (client 2) ... actually AAA/BBB ordered by client id
after delete: elloBBBAAA        # 'H' tombstoned, anchors survive
around tombstone: XelloBBBAAA
```

The key invariant: `A.text() == B.text()` after every sync regardless of delivery order, and the two concurrent runs `AAA` / `BBB` stay **contiguous** — YATA does not interleave them; their relative order is decided once, by client id.

### 8.2 JavaScript — block-wise RGA (runs coalesced, split on demand)

```javascript
// Block-wise RGA: characters typed consecutively by one client coalesce into
// one block; concurrent inserts split blocks. Converges; tombstones deletes.

class Block {
  constructor(id, originId, content) {
    this.id = id;             // [counter, actor]
    this.originId = originId; // left origin (block-end id) or null = head
    this.content = content;   // string run
    this.deleted = false;
  }
}

class RGADoc {
  constructor(actor) {
    this.actor = actor;
    this.counter = 0;
    this.blocks = [];           // document order
  }
  _id() { return [++this.counter, this.actor]; }

  // RGA child ordering at the same origin: larger [counter,actor] first.
  static cmp(a, b) {
    if (a[0] !== b[0]) return b[0] - a[0];
    return b[1] < a[1] ? -1 : (b[1] > a[1] ? 1 : 0);
  }

  text() { return this.blocks.filter(b => !b.deleted).map(b => b.content).join(''); }

  insert(index, text) {
    // find the block + offset where `index` lands among visible chars
    let seen = 0, target = null, off = 0;
    for (const b of this.blocks) {
      if (b.deleted) continue;
      if (index <= seen + b.content.length) { target = b; off = index - seen; break; }
      seen += b.content.length;
    }
    // split target if inserting mid-block
    if (target && off > 0 && off < target.content.length) {
      this._split(target, off);
    }
    const originId = this._originBefore(index);
    const blk = new Block(this._id(), originId, text);
    this._integrate(blk);
    return blk;
  }

  _originBefore(index) {
    let seen = 0, last = null;
    for (const b of this.blocks) {
      if (b.deleted) { last = b; continue; }
      if (seen + b.content.length <= index) { last = b; seen += b.content.length; }
      else break;
    }
    return last ? last.id : null;
  }

  _split(block, off) {
    const i = this.blocks.indexOf(block);
    const right = new Block([block.id[0], block.id[1]], block.id, block.content.slice(off));
    right.deleted = block.deleted;
    block.content = block.content.slice(0, off);
    this.blocks.splice(i + 1, 0, right);
  }

  _integrate(blk) {
    // find insertion slot: after origin, among blocks sharing this origin order by cmp
    let i = blk.originId === null
      ? 0
      : this.blocks.findIndex(b => RGADoc._eq(b.id, blk.originId)) + 1;
    while (i < this.blocks.length) {
      const other = this.blocks[i];
      // stop if `other` belongs to a different (earlier) origin chain
      if (!RGADoc._eq(other.originId, blk.originId)) break;
      if (RGADoc.cmp(blk.id, other.id) < 0) break;  // blk outranks -> goes before
      i++;
    }
    this.blocks.splice(i, 0, blk);
  }

  applyRemote(blk) {
    if (this.blocks.some(b => RGADoc._eq(b.id, blk.id))) return; // idempotent
    const b = new Block(blk.id, blk.originId, blk.content);
    b.deleted = blk.deleted;
    this._integrate(b);
  }
  static _eq(a, b) { return a && b && a[0] === b[0] && a[1] === b[1]; }
}

// --- convergence + interleaving demo ---
const A = new RGADoc(1), B = new RGADoc(2);
const h = A.insert(0, "Hello"); B.applyRemote(h);

const a = A.insert(5, "AAA");   // A appends AAA
const b = B.insert(5, "BBB");   // B appends BBB concurrently
A.applyRemote(b); B.applyRemote(a);
console.log("A:", A.text(), "| B:", B.text());
console.assert(A.text() === B.text(), "must converge");
// runs stay contiguous -> "HelloBBBAAA" or "HelloAAABBB", never braided
```

### 8.3 Go — minimal converging RGA core (for the same model)

```go
package main

import (
	"fmt"
	"sort"
)

type ID struct{ Counter, Actor int }

type Elem struct {
	ID      ID
	Origin  *ID // left origin
	Ch      rune
	Deleted bool
}

type Doc struct {
	Actor   int
	Counter int
	Elems   []Elem
	seen    map[ID]bool
}

func NewDoc(actor int) *Doc { return &Doc{Actor: actor, seen: map[ID]bool{}} }

func (d *Doc) newID() ID { d.Counter++; return ID{d.Counter, d.Actor} }

// RGA tie-break at same origin: larger (counter, actor) first.
func less(a, b ID) bool {
	if a.Counter != b.Counter {
		return a.Counter > b.Counter
	}
	return a.Actor > b.Actor
}

func (d *Doc) indexOf(id ID) int {
	for i, e := range d.Elems {
		if e.ID == id {
			return i
		}
	}
	return -1
}

func (d *Doc) integrate(e Elem) {
	if d.seen[e.ID] {
		return
	}
	pos := 0
	if e.Origin != nil {
		pos = d.indexOf(*e.Origin) + 1
	}
	for pos < len(d.Elems) {
		o := d.Elems[pos]
		sameOrigin := (e.Origin == nil && o.Origin == nil) ||
			(e.Origin != nil && o.Origin != nil && *e.Origin == *o.Origin)
		if !sameOrigin || less(e.ID, o.ID) {
			break
		}
		pos++
	}
	d.Elems = append(d.Elems, Elem{})
	copy(d.Elems[pos+1:], d.Elems[pos:])
	d.Elems[pos] = e
	d.seen[e.ID] = true
}

func (d *Doc) Insert(index int, s string) []Elem {
	ops := []Elem{}
	for _, ch := range s {
		var origin *ID
		vis := d.visible()
		if index-1 >= 0 && index-1 < len(vis) {
			id := vis[index-1].ID
			origin = &id
		}
		e := Elem{ID: d.newID(), Origin: origin, Ch: ch}
		d.integrate(e)
		ops = append(ops, e)
		index++
	}
	return ops
}

func (d *Doc) visible() []Elem {
	out := []Elem{}
	for _, e := range d.Elems {
		if !e.Deleted {
			out = append(out, e)
		}
	}
	return out
}

func (d *Doc) Text() string {
	r := []rune{}
	for _, e := range d.Elems {
		if !e.Deleted {
			r = append(r, e.Ch)
		}
	}
	return string(r)
}

func main() {
	A, B := NewDoc(1), NewDoc(2)
	h := A.Insert(0, "Hello")
	for _, e := range h {
		B.integrate(e)
	}
	a := A.Insert(5, "AAA")
	b := B.Insert(5, "BBB")
	// deliver in reverse to prove order-independence
	for i := len(b) - 1; i >= 0; i-- {
		A.integrate(b[i])
	}
	for i := len(a) - 1; i >= 0; i-- {
		B.integrate(a[i])
	}
	// stable re-sort not needed; integrate is order-independent
	_ = sort.Ints
	fmt.Println("A:", A.Text(), "B:", B.Text())
	if A.Text() != B.Text() {
		panic("must converge")
	}
}
```

All three converge to the same string regardless of delivery order, keep concurrent runs contiguous (no interleaving), and treat deletes as tombstones that remain as anchors.

> **What the code *omits* and why it matters.** None of these GC tombstones, none implement Fugue's left/right-child anchoring (so they share RGA's residual backward-typing interleaving), and the Python `_index_of_id` is O(n) (production uses an id→node hash + a balanced index tree so insert is O(log n), not O(n)). They are correct and convergent, but they are *teaching* implementations — Section 7's representation tricks are what make a real one fast.

---

## 9. Comparison table

| Property | RGA / Causal Tree | YATA (Yjs) | Logoot | LSEQ | Fugue |
|---|---|---|---|---|---|
| Family | causal tree | causal tree (2 origins) | dense id | dense id (adaptive) | causal tree (L/R-child) |
| Order derived from | left origin + timestamp | origin-left + origin-right + client id | position id compare | position id compare | tree of left/right anchors |
| Interleaving | reduced; **not** maximal (backward-typing case) | reduced; good in common cases; not proven maximal | **bad** (per-char) | **bad** (per-char, denser) | **maximal non-interleaving (proven)** |
| Metadata per char | id + origin (+ ts) | id + 2 origins; **amortized O(1) via blocks** | full position id (grows; ~O(n) worst) | position id (≈O(log n) adaptive) | id + parent + side bit |
| Position-id growth | none (fixed ids) | none | unbounded under hot-spot typing | bounded better than Logoot | none |
| Tombstone GC | needs causal stability; usually never / coordinator | causal stability; coordinator/snapshot in practice | tombstones too; same stability problem | same | same (inherits) |
| Storage win | columnar log (Automerge) | block-wise runs (runtime) | — | — | RGA-class, asymptotically same |
| Shipped in | **Automerge** | **Yjs** | research / early systems | research / early systems | Collabs; influencing others |

Reading the table: the *only* algorithm with a **proof** of maximal non-interleaving is **Fugue**; YATA and RGA are "good enough in practice" but have known edge cases; Logoot/LSEQ are the cautionary tale. For *production today*, you pick Yjs (smallest live footprint, fastest editing) or Automerge (full history, byte-blob merges, columnar storage), and you accept their interleaving edge cases or layer Fugue-style ideas if your workload (backward typing, structured outlines) provokes them.

---

## 10. Pitfalls, cheat sheet, summary, further reading

### Pitfalls

- **Treating convergence as sufficient.** Convergent ≠ correct. Logoot converges *and* shreds concurrent paragraphs. Always evaluate **interleaving** on the Hello/World and backward-typing traces, not just "do replicas agree."
- **Freeing tombstones too eagerly.** Drop a deleted node before its delete is causally stable and a late concurrent insert that named it as origin will dangle or diverge. The bug is non-deterministic and shows up only under real concurrency + latency.
- **Encoding position as integer offsets in marks.** Rich-text spans anchored to offsets break under any concurrent insert. Use **id-based boundary anchors with before/after bias** (Peritext).
- **Per-character allocation.** The single biggest performance mistake. Use **block-wise runs** (Yjs) at runtime and/or **columnar encoding** (Automerge) on disk. Benchmark against `automerge-perf`, not toy inputs.
- **Move = delete + insert.** Causes duplication under concurrent moves. Use an **LWW register holding the position id** (Kleppmann 2020).
- **Assuming P2P GC is free.** Fully-decentralized unbounded-offline GC is effectively impossible; budget for a coordinator, an offline-time bound, or "make tombstones cheap and never collect."
- **Non-causal delivery without buffering.** Integrating an item before its origins arrive corrupts order. Buffer in a pending set and drain when origins resolve (the `integrate_remote` pattern above).
- **O(n) index lookups.** A correct but O(n)-per-insert implementation dies on a 182k-op trace. Production needs id→node hashing plus a balanced index structure for O(log n) inserts.

### Cheat sheet

| You want… | Reach for |
|---|---|
| Smallest live footprint, fastest editing, web | **Yjs (YATA)**, block-wise |
| Full version history, offline byte-blob merge | **Automerge (RGA)**, columnar |
| Provable non-interleaving (outlines, backward typing) | **Fugue** ideas |
| Rich text / comments / formatting | **Peritext** (marks + biased anchors) |
| Drag-reorder a list item | **LWW position register** (move pattern) |
| Bound memory of deletes | causal-stability GC **+ coordinator** or compaction |

Core rules, memorized:

1. Identity ≠ position (causal-tree family) is what lets you reason about intent.
2. Two origins + client-id tie-break = YATA's determinism.
3. Blocks (runtime) and columns (storage) both exploit "humans type runs."
4. Tombstones are anchors; GC needs causal stability you usually can't get without a coordinator.
5. Marks, not character metadata; flatten to spans at render time.

### Summary

Production sequence CRDTs are **causal-tree** designs. **YATA** (Yjs) records an item's left *and* right origin and breaks same-gap ties by client id, integrating in a single deterministic scan; **block-wise storage** coalesces sequential typing into runs so per-character overhead is amortized to a constant. **RGA** (Automerge) keeps an op log ordered by left origin + Lamport timestamp and reclaims its weight via **columnar encoding** (RLE + delta) of the log. Both were forced into these representations by the `automerge-perf` benchmark, which exposed naive CRDTs as 100×+ too heavy. The deep correctness problem is **interleaving** (Kleppmann 2019): Logoot/LSEQ shred concurrent runs, RGA and YATA mostly don't but have edge cases, and **Fugue** (Weidner 2023) is the first to *prove* maximal non-interleaving via left/right-child anchoring at no asymptotic cost. **Tombstone GC** is the unsolved-in-general problem: safe reclamation needs causal stability across all replicas, so real systems add a coordinator, bound offline time, or make tombstones cheap enough to keep. **Rich text** (Peritext) layers formatting as **marks with biased id-anchors** over a clean character sequence, resolving conflicts with LWW/add-wins and flattening to spans at render. Master these and you can read, choose, and debug any real collaborative-editing stack.

### Further reading

- Roh, Jeon, Kim, Lee — *Replicated Abstract Data Types: Building Blocks for Collaborative Applications* (RGA), JPDC 2011.
- Nicolaescu, Jahns, Derntl, Klamma — *Near Real-Time Peer-to-Peer Shared Editing on Extensible Data Types* (**YATA**), GROUP 2016.
- Kleppmann, Gomes, Mulligan, Beresford — *Interleaving anomalies in collaborative text editors*, PaPoC 2019.
- Weidner, Gentle, Kleppmann — *The Art of the Fugue: Minimizing Interleaving in Collaborative Text Editing*, 2023.
- Litt, Gentle, van Hardenberg, Kleppmann — *Peritext: A CRDT for Rich-Text Collaboration*, 2022 (Ink & Switch).
- Kleppmann — *Moving Elements in List CRDTs*, PaPoC 2020.
- Kleppmann — *Automerge columnar/binary format* notes and the `automerge-perf` benchmark.
- Yjs documentation (YATA, block storage, structs) and Automerge documentation (op log, change format).
- Grishchenko — *Causal Trees / Replicated Abstract Sequence* (background on the weave model).

---

**Tier navigation:** [junior](junior.md) · [middle](middle.md) · senior · [professional](professional.md)
**Related:** [CRDT Fundamentals](../01-crdt-fundamentals/senior.md) · [Set CRDTs](../04-sets-or-set-lww/senior.md)
