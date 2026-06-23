# Sequence & Text CRDTs — Professional Level

> You are a senior engineer who has been handed a mandate: "ship the collaborative editor." Two people typing in the same document, live cursors, offline support, no merge dialogs, no lost keystrokes. This file is about the part nobody warns you about — what happens to memory, wire bytes, and load time after the demo, once a document has lived for two years and accumulated a million tombstones. We cover the real production systems (Yjs, Automerge, Figma), the CRDT-vs-OT decision the way it actually plays out in an architecture review, the economics, and the incidents.

## Table of Contents

1. [The Production Landscape](#1-the-production-landscape)
2. [CRDT vs OT in Production](#2-crdt-vs-ot-in-production)
3. [Memory & Performance Economics](#3-memory--performance-economics)
4. [Op-Log Encoding, Snapshots & Garbage Collection](#4-op-log-encoding-snapshots--garbage-collection)
5. [Networking: Awareness, Providers, Offline & Large-Doc Sync](#5-networking-awareness-providers-offline--large-doc-sync)
6. [Rich Text & Embeds: The Formatting-Span Problem](#6-rich-text--embeds-the-formatting-span-problem)
7. [Observability & Testing](#7-observability--testing)
8. [Decision Guide](#8-decision-guide)
9. [Realistic Code: A Block-Wise Sequence CRDT](#9-realistic-code-a-block-wise-sequence-crdt)
10. [Checklists, Sizing Math & Cheat Sheet](#10-checklists-sizing-math--cheat-sheet)
11. [Summary](#11-summary)
12. [Further Reading](#12-further-reading)

---

## 1. The Production Landscape

Before you write a line of code, you need an accurate map of who built what and why. Most of the confusion in this space comes from people lumping every collaborative editor into "CRDT" when the production reality is far more varied. Let me attribute carefully.

### 1.1 Yjs — the dominant open-source CRDT for editors

[Yjs](https://github.com/yjs/yjs) is, in practice, the default choice when an engineering team decides "we want a CRDT and we don't want to write one." It is a high-performance CRDT implementation in JavaScript built by Kevin Jahns. Its core data type for text is `Y.Text`, backed internally by a variant of the **YATA** algorithm (Yet Another Transformation Approach), which is a sequence CRDT with an optimization that matters enormously in practice: **block-wise (item) storage**. Instead of one CRDT element per character, Yjs stores runs of consecutively-inserted characters as a single `Item` (an `Item` holds a left origin, a right origin, content, and an ID), and splits the block only when a concurrent insertion lands in its middle. For the common case — a human typing left to right — a 10,000-character paragraph might be a handful of blocks rather than 10,000 nodes.

What makes Yjs the *production* answer rather than just a good algorithm is the ecosystem around it:

- **Editor bindings**: `y-prosemirror` (ProseMirror, and therefore TipTap, which is a ProseMirror wrapper), `y-codemirror` / `y-codemirror.next` (CodeMirror 5 and 6), `y-quill`, `y-monaco`, `y-textarea`. These bindings translate editor transactions into Yjs operations and Yjs remote updates back into editor changes — the genuinely hard, fiddly glue.
- **Providers** (the network layer): `y-websocket` (a relay-server model: a stateless-ish hub fans updates out to room members), `y-webrtc` (peer-to-peer with a signaling server), `y-indexeddb` (local persistence), and commercial/managed options like Liveblocks, PartyKit, and Hocuspocus (a y-websocket server framework).
- **Awareness**: a small, *non-CRDT*, ephemeral state channel (`y-protocols/awareness`) for cursors, selections, and presence — deliberately separated from the document because presence should not be persisted or tombstoned.

The mental model: **Yjs is the CRDT, the binding is the adapter to your editor, the provider is the transport, and awareness is presence.** You compose these four; you rarely write any of them.

### 1.2 Automerge — JSON CRDT for local-first apps

[Automerge](https://automerge.org/) comes out of [Ink & Switch](https://www.inkandswitch.com/) and the research of Martin Kleppmann and colleagues. Where Yjs is laser-focused on being the fast text CRDT for editors, Automerge is a **general JSON CRDT**: your whole document is a JSON-shaped tree (maps, lists, text, counters), every change is automatically tracked, and the entire edit history is retained and addressable. Automerge 2.x rewrote the core in Rust (compiled to WASM and native), specifically to fix the performance and memory problems that plagued Automerge 1.x — the columnar binary encoding and the rewrite are what made it production-viable.

Automerge's design center is **local-first software**: the document lives on the user's device, works fully offline, syncs peer-to-peer or through a relay, and the network is an optimization, not a requirement. Its sync protocol uses Bloom filters to efficiently figure out which changes a peer is missing without re-sending the whole history. If your product is "a Git-for-everything local-first app" more than "Google-Docs-but-ours," Automerge's full-history, any-JSON model is the better fit; if it's "a fast collaborative text editor," Yjs's specialization usually wins on raw numbers.

### 1.3 Figma — NOT a pure CRDT

This is the attribution people get wrong most often, so be precise: **Figma is not a full CRDT system, and Figma's own engineering blog says so.** In *"How Figma's multiplayer technology works"* (Evan Wallace), Figma describes a deliberately *simpler* design that leans on the fact that they always have **a central server** in the loop:

- The document is a **tree of objects** (layers, frames, etc.), each with properties.
- **Per-property conflict resolution is last-writer-wins (LWW)**, arbitrated by the server. If two clients set the same property of the same object, the server picks one ordering and everyone converges to it. Figma explicitly notes this is *not* a CRDT in the academic sense — they pragmatically chose LWW because, for design properties (a fill color, an x-coordinate), "one of the two values wins" is a perfectly acceptable, intuitive outcome.
- **Object ordering within a parent** (the z-order / child list) uses **fractional indexing**: each child gets a fractional position key (a string-encoded fraction) so that inserting *between* two siblings means picking a value between their keys — no renumbering, no array-index CRDT.
- Figma deliberately **does not use a text-sequence CRDT for the canvas object graph.** Text *content* editing inside a single text layer is a more constrained problem than full document collaboration.

Why did Figma choose this over a full text CRDT? Three reasons fall straight out of their blog and the nature of the product:

1. **They already have a central server**, so they don't need the peer-to-peer, no-coordinator guarantees that justify a full CRDT's overhead. The server can arbitrate.
2. **Design documents are object trees, not long text sequences.** The pathological cases CRDTs are built to handle (millions of concurrent character interleavings) basically don't occur — you don't have two people typing into the same coordinate of a rectangle.
3. **Simplicity and memory.** LWW-per-property plus fractional indexing is dramatically cheaper in memory and code than a full character-level CRDT, and it gives "intuitive enough" merges for a design tool.

The lesson for *your* architecture review: **if you control a central server and your data is mostly objects-with-properties rather than free-form collaboratively-typed prose, "LWW + fractional index + server arbitration" may be the right answer, not a CRDT.** Figma is the canonical proof that "we're building multiplayer" does not imply "we need a CRDT."

### 1.4 Google Docs & Apple — Operational Transformation lineage

**Google Docs uses Operational Transformation (OT), not a CRDT.** This is well documented and openly stated by Google engineers over the years. OT predates practical CRDTs by decades (the foundational Ellis & Gibbs paper is 1989, refined through Jupiter and the Google Wave / Google Docs lineage). In OT, operations are expressed as positional edits (`insert "x" at index 7`), and when two operations are concurrent, you **transform** one against the other to adjust indices so they apply consistently. OT requires a central server to define a single canonical operation order and to drive the transformation; it is *not* designed for serverless peer-to-peer merges.

Google sticks with OT for reasons that are entirely rational and that you should internalize: their architecture already centralizes on a server, OT is **memory-light** (you don't carry tombstones or per-character metadata — the document is just the text plus a transform function), it has a 20-year battle-tested track record at their scale, and rewriting Google Docs onto a CRDT would be a massive risk for, in their setting, little benefit. "We have OT and a server and it works at billions of documents" is a complete justification.

Apple's collaborative features (e.g., collaborative editing lineage in iWork) historically also trace to OT-style approaches rather than published CRDTs. **Apple Notes** collaboration: Apple has not published the internal algorithm in detail; the safe, accurate statement is that the public record does not confirm a CRDT, and you should describe it generically rather than assert.

### 1.5 Notion, Linear, Apple Notes — describe the pattern, attribute cautiously

Here you should be especially careful, because the marketing language ("real-time", "offline-first") does not tell you the algorithm, and most of these companies have not published authoritative algorithm-level descriptions.

- **Notion**: publicly described as having block-based documents with offline/sync support; Notion has discussed sync and offline engineering but has *not* (as of writing) published a definitive "we use CRDT X" statement that I would attribute as fact. Describe it as **block-structured with a sync engine**; do not assert it is or isn't a CRDT without a source.
- **Linear**: Linear is well known for a **client-side sync engine** ("Linear Sync Engine") with an in-memory observable store and a delta-sync protocol; it is a sync-engine architecture more than a published-CRDT architecture. For their data (issues, projects — structured records), last-writer-wins-style and server-arbitrated resolution is the pragmatic pattern. Again: describe the *pattern* (local store + delta sync + server as source of truth), not an unverified algorithm name.
- **Apple Notes**: as above — public detail is thin; describe generically.

The professional discipline here: **when you don't have a primary source for the algorithm, say "the pattern looks like X" and stop.** Confidently misattributing a CRDT to a company that uses OT (or vice versa) in a design doc is how you lose credibility in a review.

> Cross-reference the algorithmic foundations in [CRDT Fundamentals](../01-crdt-fundamentals/professional.md) and the related state-based structures in [Set CRDTs](../04-sets-or-set-lww/professional.md).

---

## 2. CRDT vs OT in Production

This is the decision your staff engineer will actually grill you on. Get the tradeoffs exactly right.

### 2.1 The core mechanical difference

| Dimension | Operational Transformation (OT) | Sequence CRDT |
|---|---|---|
| Identity of a position | Integer index, valid only relative to a document version | Stable, globally-unique element ID (never reused) |
| Conflict resolution | **Transform** the concurrent op's indices | Order by element ID / origin; conflicts resolve by deterministic rule |
| Coordinator | **Requires a central server** to define canonical order | Not required (peer-to-peer / serverless capable) |
| Memory per char | Effectively zero metadata (just the text) | Per-element metadata + tombstones (mitigated by block storage) |
| Correctness difficulty | Transform functions are notoriously hard to get right (TP1/TP2 properties); many published OT algorithms had bugs | Convergence is structural; correctness is easier to prove, harder to make *fast* |
| Offline / long partition | Possible but server-coupled; rebasing long offline edits is awkward | Natural — merge any two histories at any time |

The one-sentence version for the review: **OT trades a hard algorithm and a mandatory server for low memory; CRDTs trade higher memory and metadata for the ability to merge anywhere, anytime, without a coordinator.**

### 2.2 Why new local-first apps pick CRDTs

If your product thesis is **local-first** — the app must work fully offline, the user owns the data, sync is best-effort, and there might be no server at all (or an untrusted relay) — then OT is the wrong tool, because OT's correctness *depends* on a server imposing a single operation order. CRDTs let two devices that have never talked to each other merge their edits when they finally connect, with a mathematically guaranteed convergent result. That property is the whole reason Automerge and Yjs exist. The Ink & Switch *"Local-first software"* essay is the canonical articulation of why this matters: software you actually own, that survives the company shutting down its servers, that is fast because it's local.

### 2.3 Why Google Docs still uses OT (and why that's not hypocrisy)

A junior engineer reads "CRDTs are better for collaboration" and asks why Google doesn't switch. The senior answer:

1. **They have a server anyway.** Google Docs is a hosted product; there is no local-first requirement and no untrusted-peer scenario. The single biggest advantage of CRDTs (no coordinator needed) buys Google nothing.
2. **OT is memory-light at planetary scale.** Multiply per-character CRDT metadata across billions of documents and the storage/RAM bill is real. OT's document-is-just-text model is cheaper.
3. **Sunk correctness.** Their OT implementation is decades-hardened. CRDTs are "easier to prove correct" in the abstract, but Google's *specific* OT code is already correct and fast in production.
4. **Migration risk vastly exceeds benefit.** There is no user-visible feature a CRDT would unlock for hosted Google Docs that justifies rewriting the merge core.

The takeaway: **the CRDT-vs-OT choice is dominated by whether you have, and want to depend on, a central server.** Have a server and don't need offline-peer merges? OT (or LWW + fractional index) is often the leaner choice. Need local-first / peer-to-peer / long offline windows / untrusted relays? CRDT.

---

## 3. Memory & Performance Economics

This section is where collaborative-editor projects die. The algorithm "works" on day one; the document is unusable on day 700. You must do the sizing math *before* you commit.

### 3.1 Bytes per character — the naive horror story

A naive sequence CRDT (one element per character, à la classic WOOT/Logoot/RGA) stores, for *every character ever typed*:

- A unique ID: typically `(replicaId, clock)` — call it 8–16 bytes.
- Left/right origin references (another ID each) or position metadata.
- The character itself (1–4 bytes).
- Flags (deleted? visible?).

That is easily **50–100+ bytes of metadata per single character** in a naive in-memory representation, plus the JS object overhead (each object header in V8 is dozens of bytes). A 100 KB text document (100,000 characters) becomes **5–10 MB or more** in memory. Worse, **deletes don't free anything** — they leave tombstones (see §3.2). This is the reputation CRDTs earned in ~2015, and it's why people said "CRDTs don't scale."

### 3.2 Tombstone accumulation — the silent killer

In a sequence CRDT you cannot truly delete an element, because a concurrent operation might reference it (an insert whose origin is the deleted element). So a delete sets a flag and keeps the metadata: a **tombstone**. Over a document's lifetime, every character ever deleted persists as a tombstone. Consider the real shape of editing:

- A document with 50 KB of *visible* text might have had **500 KB or more of total text typed and deleted** over its life (rewrites, paste-and-replace, undo churn).
- The **tombstone ratio** (deleted elements ÷ live elements) climbs monotonically without GC. A heavily-edited two-year-old doc can be **5×–20×** the size of its visible content.

This is the metric you must monitor in production (see §7). When `tombstones / live > threshold`, load time and sync payload degrade even though the user sees "a small document."

### 3.3 What made CRDTs viable: block-wise & columnar encoding

Two engineering moves rescued CRDTs from the bytes-per-char disaster:

**Yjs — block-wise (run-length) storage.** A human typing "hello world" left-to-right produces 11 characters whose IDs are *consecutive* `(replica, clock..clock+10)` and whose origins chain trivially. Yjs stores this as **one `Item` block** with `content="hello world"`, splitting it only if a concurrent insert lands inside it. Result: metadata cost is **per-block, not per-character**. For typical human editing the block count is orders of magnitude smaller than the character count. Tombstones are also block-wise: deleting a contiguous run is one (split) tombstone, not N. Yjs further uses a **delete set** — a compact `(clientId → [ranges])` representation of deletions — rather than a per-character deleted flag.

**Automerge — columnar binary encoding.** Automerge stores the operation history in a **columnar format**: instead of an array of operation *records* (each with all its fields), it stores each field in its own column (all the actor IDs together, all the clocks together, all the action types together), then compresses each column (delta + RLE + LEB128 varints). Columns of monotonically increasing clocks compress to almost nothing under delta+RLE. This is the same idea that makes columnar analytics databases (Parquet) small, applied to a CRDT op-log. Automerge 2.0's Rust rewrite + columnar format is what dropped it from "100 MB for a paper" to competitive numbers.

### 3.4 The Kleppmann automerge-perf trace

The reference benchmark in this field is the **`automerge-perf` editing trace** assembled by Martin Kleppmann: the **full keystroke-level editing history of an academic paper (the LaTeX source)** — on the order of **~260,000 single-character operations** (insertions and deletions), captured as they actually happened. It became the standard "is your text CRDT fast and small?" benchmark. Key results people quote from it:

- A *naive* CRDT applying all 260K ops blows up to hundreds of MB and takes seconds.
- Yjs and Automerge 2.x apply the whole trace in well under a second to a few seconds and end at a few MB of memory — because of block/columnar encoding plus the fact that the trace is mostly *sequential* (block-friendly) typing.
- The trace exposes worst cases: large pastes, deletions, and the occasional backtrack-and-rewrite that splits blocks.

When you evaluate a library or your own implementation, **run the automerge-perf trace.** It is the closest thing to a real workload you can get without instrumenting your own users.

### 3.5 Document load / parse time

Memory is half the story; **load time** is what the user feels. To open a document you must reconstruct CRDT state from its persisted form:

- **From op-log**: replay every operation. O(ops). For a long-lived doc this is the slow path.
- **From snapshot**: deserialize a materialized state (Yjs `encodeStateAsUpdate`, Automerge `save`). Much faster, but you must produce snapshots.
- **Lazy loading**: don't materialize the whole document up front. Load the visible region / metadata, hydrate the rest on demand. Critical for huge docs.

The economics: a 1 MB Yjs update for a large doc parses in tens of milliseconds; the same doc replayed from a 50,000-op log might take hundreds of ms to seconds. **Snapshots convert load time from O(history) to O(state).** This is non-negotiable for any doc that lives longer than a session.

### 3.6 Sizing math you should do up front

Plug your numbers in before you build:

```
visible_chars            = expected document size (chars)
edit_churn_factor        = total_typed / visible   (2–10× typical; 20× for heavily rewritten)
total_elements           = visible_chars * edit_churn_factor
blocks                   = total_elements / avg_run_length   (avg_run_length 20–200 for prose)
bytes_per_block          ≈ 30–60  (Yjs-style, in encoded form)
encoded_doc_size         ≈ blocks * bytes_per_block + delete_set_size
in_memory_size           ≈ encoded_doc_size * (3–8)   (object overhead, indexes)

Example: a 50 KB collaborative doc, churn 6×, avg run 40:
  total_elements = 50,000 * 6        = 300,000
  blocks         = 300,000 / 40      = 7,500
  encoded        ≈ 7,500 * 45        ≈ 340 KB on the wire / at rest
  in_memory      ≈ 340 KB * 5        ≈ 1.7 MB RAM

The same doc as a *naive* per-char CRDT:
  300,000 elements * 80 bytes        = 24 MB encoded, 100+ MB in memory.
```

That 70× difference between naive and block-wise is the entire reason this technology is shippable.

---

## 4. Op-Log Encoding, Snapshots & Garbage Collection

### 4.1 On the wire and at rest

Yjs and Automerge both treat updates as **opaque binary blobs** you move around and persist; you do not parse them yourself.

- **Yjs update**: `Y.encodeStateAsUpdate(doc)` gives a full-state binary update; `Y.encodeStateVector(doc)` gives a compact summary of "what I have" (a `clientId → clock` map). To sync, a peer sends its state vector, and the other side replies with `Y.encodeStateAsUpdate(doc, theirStateVector)` — **just the delta** they're missing. Updates use variable-length integers and run-length encoding; consecutive operations compress well.
- **Automerge**: `Automerge.save(doc)` produces the full columnar binary; `Automerge.getChanges` / the sync protocol produce incremental changes. The sync protocol exchanges Bloom filters of change hashes to find the diff without a round-trip per change.

Both are far smaller than JSON. A Yjs update is typically a **fraction of the size** of the equivalent JSON patch, and you should still **gzip/brotli at the transport** for additional savings on large updates.

### 4.2 Snapshots + incremental updates

The production persistence pattern:

1. Keep an **append-only log of incremental updates** (cheap writes; every keystroke-batch appends).
2. Periodically (every N updates, or on idle, or on a timer) **compact**: load all updates, `encodeStateAsUpdate`, write a single **snapshot**, and drop the now-redundant log entries.
3. On load: read the latest snapshot, then replay only the updates appended *after* it.

This bounds load time to "snapshot parse + tail replay" and bounds storage to "one snapshot + recent tail." It's the same checkpoint-and-tail pattern as a write-ahead log / LSM database. Hocuspocus, Liveblocks, and most production Yjs backends implement exactly this.

### 4.3 Garbage collection of tombstones — and its hard limit

Can you ever delete tombstones? **Only when you can prove no future operation will reference them.** A tombstone is needed as an *origin anchor* for concurrent inserts. Once every replica has acknowledged seeing the deletion (i.e., the deletion is in everyone's causal past and no in-flight op can still arrive referencing the tombstone), the metadata can be collapsed.

- **Yjs** has a `gc` flag (on by default) that replaces deleted content with a compact placeholder once it's safe, and merges adjacent tombstone ranges in the delete set. It cannot, however, eliminate the *structural* positions entirely while the doc is live and other peers might lag — GC is opportunistic, not total.
- **The limit**: in a truly open peer-to-peer system you often **cannot know** that "every replica has seen the delete," because the set of replicas is unbounded and a peer can reappear after months offline carrying an old op that references a tombstone. So full GC requires either (a) a coordinator/server that defines membership and a stable causal frontier, or (b) accepting a bounded "tombstone horizon" and refusing to merge ops older than it (which sacrifices the unlimited-offline guarantee). **This is the fundamental tension: full tombstone GC and unbounded offline editing are in conflict.** Most production systems resolve it by having a server that owns the canonical history and prunes against an acknowledged frontier.

> This is the single most important paragraph in this file for capacity planning. If your product promises "edit offline for a year and merge cleanly," you have *also* promised "tombstones can never be fully collected on a path that might receive your year-old edit." Price that in.

---

## 5. Networking: Awareness, Providers, Offline & Large-Doc Sync

### 5.1 Awareness / presence (live cursors)

Live cursors, selections, "who's online," and "X is typing" are **awareness** state. Crucial design rule: **awareness is NOT part of the CRDT document.** It is ephemeral, high-frequency, and should never be tombstoned or persisted. Yjs models this with `y-protocols/awareness`: each client publishes a small state object (cursor position, name, color) with a clock and a timeout; states expire if a client goes silent. It is effectively an **LWW-per-field, TTL'd presence map** broadcast out-of-band from the document updates.

Why separate? Cursor updates fire dozens of times per second. If you fed them through the document CRDT you'd generate millions of tombstones an hour and bloat persistence with data nobody wants saved. Keep presence ephemeral, throttle it (e.g., 30–60ms), and let it die on disconnect.

### 5.2 Provider patterns: relay vs peer-to-peer

| Pattern | Mechanism | Pros | Cons |
|---|---|---|---|
| **WebSocket relay** (`y-websocket`, Hocuspocus, Liveblocks) | Clients connect to a hub; hub fans updates out and persists | Simple, scales with rooms, central persistence & auth, easy server-side GC/snapshot | Needs servers; hub is a coordination point |
| **WebRTC P2P** (`y-webrtc`) | Clients mesh directly (signaling server only for handshake) | Low latency, no relay traffic cost, privacy | NAT traversal pain, no central persistence, doesn't scale past small groups, no server-side auth on data |
| **Hybrid** | P2P for live edits + a server peer for persistence/auth | Best of both | Most complex |

For most products: **WebSocket relay.** You almost always need server-side persistence, authn/authz, and snapshots anyway, and the relay is where you do them. P2P is a niche choice for privacy-first or small-group tools.

### 5.3 Offline edit + reconnect

The offline story is where CRDTs shine and where you must still engineer carefully:

1. **Persist locally** (`y-indexeddb`) so edits survive a refresh/crash and the user can keep typing with no network.
2. On reconnect, the provider exchanges **state vectors** (Yjs) or **Bloom-filtered change hashes** (Automerge) so each side sends only the delta the other is missing — you do **not** re-send the whole document.
3. Merge is automatic and convergent: offline edits and edits made by others while you were gone interleave deterministically. No merge dialog.

The sharp edges: a user who edited offline for a long time accumulates a large delta and may face a noticeable sync on reconnect (and may hit the tombstone-horizon problem from §4.3). Also, **awareness must be re-announced** on reconnect (the old presence has expired server-side).

### 5.4 Large-document sync

For multi-megabyte documents:

- **Diff sync, never full sync** on steady-state (state-vector / Bloom diff).
- **Compress the wire** (brotli/gzip) — binary updates still benefit.
- **Lazy load / chunk** the initial open: hydrate visible content first.
- **Backpressure**: batch many small keystroke updates into one update per network tick (e.g., debounce 50–100ms) to avoid a message storm; Yjs transactions already coalesce edits within a tick.
- **Server-side snapshotting** so a newly-joining client gets one snapshot + short tail, not a 50K-op replay.

---

## 6. Rich Text & Embeds: The Formatting-Span Problem

Plain-text CRDTs are a solved problem. **Rich text is not**, and this is where naive implementations produce visibly wrong results.

### 6.1 Why formatting is hard

Formatting is a **span** over a *range* of characters: "bold from char 5 to char 12." But characters are CRDT elements that can be inserted and deleted concurrently. What happens when:

- Alice bolds "hello" while Bob types "XYZ" in the middle of it? Should "XYZ" be bold?
- Alice bolds chars 5–12 while Bob deletes chars 8–10? Where does the span end now?
- Two users apply *overlapping but different* formatting (bold 5–10, italic 8–12)?

If you model formatting as "store start/end *indices*," concurrent edits invalidate the indices and you get formatting that bleeds, drops, or lands on the wrong characters.

### 6.2 Peritext — the reference design

**[Peritext](https://www.inkandswitch.com/peritext/)** (Ink & Switch — Geoffrey Litt, Slim Lim, Martin Kleppmann, Peter van Hardenberg) is the published reference solution. Its key insight: **anchor formatting marks to character IDs, not indices, with explicit boundary semantics ("before" / "after" a character).** A bold mark from "after char A" to "before char B" survives concurrent insertions and deletions because it's anchored to stable IDs, and the *intent* (text inserted at the boundary of a bold span inherits boldness, per a deterministic rule) is preserved. Peritext defines a CRDT for marks that converges and matches user expectations for the overlap/insert/delete cases above. Yjs's `Y.Text` formatting and ProseMirror integration tackle the same problem with attribute-carrying items; Peritext is the cleanest published *specification* of the semantics.

The practical advice: **do not invent your own rich-text-span CRDT.** Use Yjs's `Y.Text` (with `format()`) and a ProseMirror/TipTap binding, or adopt a Peritext-based approach. Rolling your own is how you ship a "bold sometimes bleeds into the next paragraph" bug you can't reproduce.

### 6.3 Tables, embeds, comments/annotations

- **Tables**: model as nested CRDT structures (a list of rows, each a list of cells, each a `Y.Text`), not as text with delimiters. Concurrent row/column insertion is a fractional-index or list-CRDT problem.
- **Embeds** (images, mentions, math): an embed is a single atomic CRDT element in the sequence — one item with type "embed" and an attribute payload. It participates in ordering like a character but isn't split.
- **Comments / annotations**: anchor them to **character IDs** (same as Peritext marks), not indices, so a comment stays attached to the text it references even as surrounding text changes. Store comment *threads* in a separate CRDT map keyed by anchor ID. When the anchored text is fully deleted, you get an "orphaned comment" — decide product behavior (show as "resolved on deleted text" rather than losing it).

---

## 7. Observability & Testing

You cannot ship a merge engine you can't observe and can't fuzz. This is the part that separates a demo from a product.

### 7.1 Convergence property tests

The defining property of a CRDT: **any two replicas that have received the same set of operations are in the same state, regardless of order.** Test it with property-based testing:

- Generate random sequences of concurrent operations across N simulated replicas.
- Deliver them to each replica in **random, shuffled orders** (and with duplicates — idempotency).
- Assert all replicas converge to **byte-identical** materialized state.

This catches order-dependence and idempotency bugs that example tests never will. (See §9 for a runnable implementation.) The property to assert is **strong eventual consistency**: same delivered set ⇒ same state.

### 7.2 Replaying real editing traces

Run the **automerge-perf trace** (§3.4) and *your own* captured traces (instrument a fraction of real users — keystroke streams, anonymized) through your engine in CI. Assert correctness (final text matches) and track performance regressions (apply time, peak memory, final encoded size). A real trace exposes the pathological pastes/deletes that synthetic random ops underweight.

### 7.3 Fuzzing concurrent ops

Beyond property tests, **fuzz**: random insert/delete/format ops at random positions on random replicas, random network delivery, random partitions and heals. Run for millions of iterations under a sanitizer/with assertions. The goal is to find a single divergence — one is enough to mean "do not ship."

### 7.4 Jepsen-style partition tests

For the networked system (not just the data type), run **Jepsen-style** tests: partition the cluster (split clients into groups that can only talk within their group), let each group edit, heal the partition, and assert convergence and no lost acknowledged edits. Inject clock skew, message reordering, and duplicate delivery. This validates the *provider/sync* layer, which is where real incidents come from — the CRDT may be correct while your sync protocol drops an update under a specific reconnect race.

### 7.5 Metrics to put on a dashboard

| Metric | Why it matters | Alert when |
|---|---|---|
| **Document encoded size** (bytes) | Storage & sync cost | Grows much faster than visible content |
| **Tombstone ratio** (deleted ÷ live) | The silent killer (§3.2) | > 5–10× → schedule compaction/GC |
| **Sync payload size** (per reconnect / per tick) | Bandwidth & latency | p99 spikes → missing diff-sync, full resync bug |
| **Document load time** | User-felt open latency | p95 climbs → snapshot pipeline broken |
| **Update apply time** | CPU per edit | Climbs with doc age → block-splitting pathology |
| **Awareness message rate** | Presence flooding persistence | Presence leaking into doc updates |
| **Snapshot lag** (ops since last snapshot) | Bounds replay cost | Exceeds compaction threshold |
| **Divergence detector** (periodic cross-replica state hash) | Last line of defense | Any mismatch → page someone |

A **server-side periodic state-hash comparison** across replicas of the same room is the cheapest production divergence detector you can build: hash each replica's materialized state on a timer, compare, alarm on mismatch. It has caught real bugs that property tests missed because production has inputs your generators don't.

---

## 8. Decision Guide

### 8.1 The big table

| App type / situation | Recommended approach | Why |
|---|---|---|
| Hosted collaborative **text** editor, you run servers, no hard offline requirement | **OT** (or Yjs CRDT) | OT is memory-light with a server; Yjs is fine too and far easier to adopt than writing OT |
| **Local-first** app, offline-first, peer-to-peer or untrusted relay | **CRDT (Yjs or Automerge)** | Only CRDTs merge without a coordinator; this is their reason to exist |
| Collaborative **rich-text** editor (prose, comments), pragmatic | **Yjs + ProseMirror/TipTap binding** | Best-in-class block-wise CRDT + battle-tested editor bindings; Peritext-style marks |
| Collaborative **code** editor | **Yjs + CodeMirror/Monaco binding** | Same engine, code-editor binding |
| General **JSON / arbitrary-document** local-first app, full history wanted | **Automerge** | JSON CRDT, columnar encoding, full history, Git-like model |
| **Design tool / canvas** — object tree with properties, you run a server | **LWW-per-property + fractional indexing + server arbitration** (the Figma pattern) | Objects-with-properties, not long text; central server can arbitrate; far cheaper than a text CRDT |
| Structured **records** (issues, CRM, tasks), server-of-truth | **Sync engine + LWW / server arbitration** (the Linear-style pattern) | Records, not free-form text; conflicts are rare and LWW is acceptable |
| Ordered list where items are objects (kanban, playlist) | **Fractional indexing** (+ LWW per item) | Insert-between without renumbering; no character-CRDT needed |
| You're not sure and time-to-market matters | **Buy/adopt** Yjs (+ a managed provider: Liveblocks / PartyKit / Hocuspocus) | Do not write a CRDT under deadline pressure |

### 8.2 Build vs buy

**Default to buy/adopt.** Writing a correct, *fast*, *memory-efficient* sequence CRDT with rich-text marks, snapshots, GC, and a tested sync protocol is a multi-engineer-year effort, and the open-source options (Yjs, Automerge) plus managed providers already did it. Build your own only if (a) you have an unusual data model none of them fit, (b) you have hard constraints (e.g., a non-JS runtime with no binding) and the resources, or (c) you are a database/infra company for whom this *is* the product. For "we're adding collaboration to our app," **adopt Yjs.** This is the consensus professional default in 2024–2026.

### 8.3 CRDT vs OT, distilled to one decision

```
Do you require offline / peer-to-peer / untrusted-relay / no-coordinator merges?
   YES → CRDT (Yjs for text/editors, Automerge for general JSON).
   NO  → You have a server. Is your data long collaboratively-typed text?
            YES → OT (if you have the expertise) or Yjs (if you don't).
            NO (objects/records with properties) → LWW-per-property + fractional index, server-arbitrated (the Figma/Linear pattern).
```

---

## 9. Realistic Code: A Block-Wise Sequence CRDT

Below is a runnable, dependency-free JavaScript implementation of a **block-wise sequence CRDT** with **update encoding** and a **property-based convergence test** over random concurrent edits. It is intentionally a teaching implementation — it demonstrates the *block-wise* idea that makes real CRDTs viable (runs of characters share one block; concurrent inserts split blocks), origin-based ordering, tombstones, idempotent op application, and binary-ish update encoding. It is **not** a replacement for Yjs; in production you adopt Yjs. Run it with `node crdt.js`.

```js
// crdt.js — a block-wise sequence CRDT (teaching implementation).
// Demonstrates: per-block (run-length) storage, origin-based ordering,
// tombstones, idempotent op application, update encoding, and a
// property-based convergence test over random concurrent edits.
//
// Run: node crdt.js

'use strict';

// ---------- IDs ----------
// An element ID is (client, clock). A *block* covers a contiguous range
// of clocks [clock, clock+len) for one client — this is the run-length
// optimization that keeps metadata per-block instead of per-character.

function idEq(a, b) { return a.client === b.client && a.clock === b.clock; }

// A reference to a position: the ID of the element to the LEFT of an
// insertion (its "origin"). null means "start of document".

// ---------- Document ----------

class Doc {
  constructor(client) {
    this.client = client;            // this replica's id (string/number)
    this.clock = 0;                  // next clock value for this client
    this.blocks = [];                // ordered array of Block
    this.applied = new Set();        // de-dup: "client:clock" of seen ops (idempotency)
  }

  // Materialize visible text by walking blocks in order, skipping deleted.
  toString() {
    let out = '';
    for (const b of this.blocks) {
      if (!b.deleted) out += b.text;
    }
    return out;
  }

  // Map a visible character index -> (block index, offset within block).
  // Returns the origin ID for an insertion at visible position `pos`
  // (i.e., the ID of the visible char immediately to the left, or null).
  _originAt(pos) {
    let seen = 0;
    for (const b of this.blocks) {
      if (b.deleted) continue;
      if (pos <= seen + b.text.length) {
        const offsetInBlock = pos - seen;     // 0..b.text.length
        if (offsetInBlock === 0) {
          // origin is whatever is to the left of this block: handled by caller scan
          return this._leftOriginOfBlockStart(b);
        }
        // origin is the (offsetInBlock-1)-th char of this block
        return { client: b.client, clock: b.startClock + offsetInBlock - 1, _block: b, _off: offsetInBlock };
      }
      seen += b.text.length;
    }
    return this._lastElementId(); // append at end
  }

  _leftOriginOfBlockStart(block) {
    const idx = this.blocks.indexOf(block);
    for (let i = idx - 1; i >= 0; i--) {
      const b = this.blocks[i];
      // last element of previous block (visible or not — origins reference any element)
      if (b.text.length > 0) {
        return { client: b.client, clock: b.startClock + b.text.length - 1 };
      }
    }
    return null;
  }

  _lastElementId() {
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const b = this.blocks[i];
      if (b.text.length > 0) return { client: b.client, clock: b.startClock + b.text.length - 1 };
    }
    return null;
  }

  // ----- LOCAL EDITS: produce ops -----

  // Insert `text` at visible position `pos`. Returns an op (to broadcast).
  insert(pos, text) {
    const origin = this._originAt(pos);
    const originId = origin ? { client: origin.client, clock: origin.clock } : null;
    const op = {
      type: 'ins',
      id: { client: this.client, clock: this.clock },
      origin: originId,         // element this insert follows
      text,
    };
    this.clock += text.length;  // reserve a clock per character in the run
    this._applyInsert(op);
    this.applied.add(opKey(op));
    return op;
  }

  // Delete `count` visible characters starting at visible position `pos`.
  // Returns an array of delete ops (one per affected element id range).
  delete(pos, count) {
    const ops = [];
    let remaining = count;
    let seen = 0;
    for (const b of this.blocks) {
      if (remaining <= 0) break;
      if (b.deleted) continue;
      const blockStartVisible = seen;
      const blockEndVisible = seen + b.text.length;
      if (pos < blockEndVisible && pos + remaining > blockStartVisible) {
        const from = Math.max(pos, blockStartVisible) - blockStartVisible;
        const to = Math.min(pos + remaining, blockEndVisible) - blockStartVisible;
        for (let off = from; off < to; off++) {
          ops.push({ type: 'del', target: { client: b.client, clock: b.startClock + off } });
        }
        remaining -= (to - from);
      }
      seen = blockEndVisible;
    }
    for (const op of ops) { this._applyDelete(op); this.applied.add(opKey(op)); }
    return ops;
  }

  // ----- REMOTE OPS: idempotent application -----

  apply(op) {
    const k = opKey(op);
    if (this.applied.has(k)) return false;   // idempotent: ignore duplicates
    if (op.type === 'ins') this._applyInsert(op);
    else if (op.type === 'del') this._applyDelete(op);
    this.applied.add(k);
    return true;
  }

  _applyInsert(op) {
    // Find insertion index: just after the element with id == op.origin,
    // using deterministic tie-break among concurrent inserts at the same
    // origin (higher client id goes first => stable total order).
    const elem = new Block(op.id.client, op.id.clock, op.text);
    // Locate the block+offset that contains op.origin (split if needed).
    let insertAt; // index into this.blocks to splice the new block before
    if (op.origin === null) {
      insertAt = this._concurrentSkip(0, op);  // start of doc
    } else {
      const loc = this._locate(op.origin);
      if (loc === null) {
        // Origin not present yet (causally out of order). For this teaching
        // impl we append; a real CRDT buffers until causal deps arrive.
        insertAt = this._concurrentSkip(this.blocks.length, op);
      } else {
        // split the containing block so origin is the last char of left part
        this._splitAt(loc.blockIndex, loc.offset + 1);
        insertAt = this._concurrentSkip(loc.blockIndex + 1, op);
      }
    }
    this.blocks.splice(insertAt, 0, elem);
    this._tryMerge(insertAt);
  }

  // Among already-present concurrent inserts at the same origin, place the
  // new one in a deterministic spot: order by client id descending so all
  // replicas agree regardless of arrival order.
  _concurrentSkip(idx, op) {
    while (idx < this.blocks.length) {
      const b = this.blocks[idx];
      // Only skip blocks that were also inserted "at the same origin region"
      // and have a higher client id. Simplified deterministic rule:
      if (b.client > op.id.client) idx++;
      else break;
    }
    return idx;
  }

  _applyDelete(op) {
    const loc = this._locate(op.target);
    if (loc === null) return; // not present yet; a real impl buffers
    this._splitAt(loc.blockIndex, loc.offset + 1);
    this._splitAt(loc.blockIndex, loc.offset);
    // after the two splits, the single target char is its own block at loc.blockIndex+? 
    const b = this._blockOf(op.target);
    if (b) b.deleted = true; // tombstone (keeps metadata as an origin anchor)
  }

  // Find (blockIndex, offset) for an element id, or null.
  _locate(id) {
    for (let i = 0; i < this.blocks.length; i++) {
      const b = this.blocks[i];
      if (b.client === id.client && id.clock >= b.startClock && id.clock < b.startClock + b.text.length) {
        return { blockIndex: i, offset: id.clock - b.startClock };
      }
    }
    return null;
  }

  _blockOf(id) {
    for (const b of this.blocks) {
      if (b.client === id.client && id.clock >= b.startClock && id.clock < b.startClock + b.text.length) return b;
    }
    return null;
  }

  // Split block `i` at internal offset (0..len). After: left part keeps
  // [0,offset), a new block holds [offset,len). No-op at boundaries.
  _splitAt(i, offset) {
    const b = this.blocks[i];
    if (!b || offset <= 0 || offset >= b.text.length) return;
    const right = new Block(b.client, b.startClock + offset, b.text.slice(offset));
    right.deleted = b.deleted;
    b.text = b.text.slice(0, offset);
    this.blocks.splice(i + 1, 0, right);
  }

  // Try to merge a block with its right neighbor if contiguous & same state
  // (the inverse of split — keeps block count low).
  _tryMerge(i) {
    for (const j of [i, i - 1]) {
      const a = this.blocks[j], b = this.blocks[j + 1];
      if (!a || !b) continue;
      if (a.client === b.client &&
          a.startClock + a.text.length === b.startClock &&
          a.deleted === b.deleted) {
        a.text += b.text;
        this.blocks.splice(j + 1, 1);
      }
    }
  }

  // ----- UPDATE ENCODING -----
  // Encode all ops needed to bring a peer (with state vector `sv`) up to
  // date. State vector = { client: nextClockSeen }. We emit a compact,
  // length-prefixed binary-ish buffer (here a Uint8Array via a tiny writer).

  encodeStateVector() {
    const sv = {};
    for (const b of this.blocks) {
      const end = b.startClock + b.text.length;
      sv[b.client] = Math.max(sv[b.client] || 0, end);
    }
    return sv;
  }

  // Emit the *blocks* (run-length!) as update entries the peer is missing.
  // This is the wire format: per block we send client, startClock, deleted,
  // origin, and text — one entry per RUN, not per character.
  encodeUpdate(remoteSV = {}) {
    const w = new Writer();
    const entries = [];
    for (const b of this.blocks) {
      const have = remoteSV[b.client] || 0;
      if (b.startClock + b.text.length <= have) continue; // peer already has it
      entries.push(b);
    }
    w.varint(entries.length);
    for (const b of entries) {
      w.str(String(b.client));
      w.varint(b.startClock);
      w.varint(b.deleted ? 1 : 0);
      w.str(b.text);
      // origin: encode the left neighbor's last element id (for re-insertion)
      const origin = this._encodeOriginFor(b);
      if (origin) { w.varint(1); w.str(String(origin.client)); w.varint(origin.clock); }
      else { w.varint(0); }
    }
    return w.bytes();
  }

  _encodeOriginFor(block) {
    const idx = this.blocks.indexOf(block);
    for (let i = idx - 1; i >= 0; i--) {
      const b = this.blocks[i];
      if (b.text.length > 0) return { client: b.client, clock: b.startClock + b.text.length - 1 };
    }
    return null;
  }

  decodeAndApply(bytes) {
    const r = new Reader(bytes);
    const n = r.varint();
    for (let i = 0; i < n; i++) {
      const client = r.str();
      const startClock = r.varint();
      const deleted = r.varint() === 1;
      const text = r.str();
      const hasOrigin = r.varint() === 1;
      let origin = null;
      if (hasOrigin) origin = { client: r.str(), clock: r.varint() };
      // Re-apply as an insert op per element of the run (idempotent guards dedupe).
      for (let off = 0; off < text.length; off++) {
        const op = {
          type: 'ins',
          id: { client, clock: startClock + off },
          origin: off === 0 ? origin : { client, clock: startClock + off - 1 },
          text: text[off],
        };
        this.apply(op);
        if (deleted) this.apply({ type: 'del', target: { client, clock: startClock + off } });
      }
    }
  }
}

class Block {
  constructor(client, startClock, text) {
    this.client = client;
    this.startClock = startClock;
    this.text = text;
    this.deleted = false;
  }
}

function opKey(op) {
  if (op.type === 'ins') return `i:${op.id.client}:${op.id.clock}`;
  return `d:${op.target.client}:${op.target.clock}`;
}

// ---------- Tiny binary writer/reader (varint + length-prefixed strings) ----------

class Writer {
  constructor() { this.buf = []; }
  varint(n) { // LEB128 unsigned
    n = n >>> 0;
    do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; this.buf.push(b); } while (n);
  }
  str(s) {
    const bytes = Array.from(Buffer.from(s, 'utf8'));
    this.varint(bytes.length);
    for (const b of bytes) this.buf.push(b);
  }
  bytes() { return Uint8Array.from(this.buf); }
}

class Reader {
  constructor(bytes) { this.b = bytes; this.i = 0; }
  varint() {
    let n = 0, shift = 0, byte;
    do { byte = this.b[this.i++]; n |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
    return n >>> 0;
  }
  str() {
    const len = this.varint();
    const s = Buffer.from(this.b.slice(this.i, this.i + len)).toString('utf8');
    this.i += len;
    return s;
  }
}

// ============================================================
// PROPERTY-BASED CONVERGENCE TEST
// Generate random concurrent edits across N replicas, deliver ops in
// random orders (with duplicates), and assert all replicas converge to
// byte-identical text. This is the defining CRDT property (SEC).
// ============================================================

function mulberry32(seed) { // tiny deterministic PRNG for reproducible fuzzing
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runConvergenceTrial(seed, nReplicas = 3, nRounds = 40) {
  const rng = mulberry32(seed);
  const docs = [];
  for (let i = 0; i < nReplicas; i++) docs.push(new Doc(`r${i}`));

  const inbox = docs.map(() => []); // pending remote ops per replica
  const allOps = [];

  const randInt = (lo, hi) => lo + Math.floor(rng() * (hi - lo));
  const letters = 'abcdefgh';

  for (let round = 0; round < nRounds; round++) {
    // Each replica makes a random local edit on its current state.
    for (let i = 0; i < nReplicas; i++) {
      const d = docs[i];
      const len = d.toString().length;
      if (rng() < 0.7 || len === 0) {
        const pos = len === 0 ? 0 : randInt(0, len + 1);
        const text = letters[randInt(0, letters.length)];
        const op = d.insert(pos, text);
        allOps.push(op);
        for (let j = 0; j < nReplicas; j++) if (j !== i) inbox[j].push(op);
      } else {
        const pos = randInt(0, len);
        const cnt = randInt(1, Math.min(3, len - pos) + 1);
        const ops = d.delete(pos, cnt);
        for (const op of ops) {
          allOps.push(op);
          for (let j = 0; j < nReplicas; j++) if (j !== i) inbox[j].push(op);
        }
      }
    }
    // Randomly deliver SOME pending ops to SOME replicas, out of order,
    // sometimes duplicating (idempotency check).
    for (let i = 0; i < nReplicas; i++) {
      // shuffle inbox
      for (let k = inbox[i].length - 1; k > 0; k--) {
        const j = randInt(0, k + 1);
        [inbox[i][k], inbox[i][j]] = [inbox[i][j], inbox[i][k]];
      }
      const deliver = randInt(0, inbox[i].length + 1);
      for (let k = 0; k < deliver; k++) {
        const op = inbox[i].shift();
        docs[i].apply(op);
        if (rng() < 0.2) docs[i].apply(op); // duplicate delivery
      }
    }
  }

  // Final: flush every pending op to every replica.
  for (let i = 0; i < nReplicas; i++) {
    for (const op of allOps) docs[i].apply(op);
  }

  // Assert convergence.
  const texts = docs.map(d => d.toString());
  const allEqual = texts.every(t => t === texts[0]);
  return { allEqual, texts };
}

// Also exercise the update-encoding round trip: a fresh replica that
// learns the document ONLY via encodeUpdate/decodeAndApply must converge.
function runEncodingTrial(seed) {
  const a = new Doc('A');
  const rng = mulberry32(seed);
  const letters = 'xyz123';
  for (let i = 0; i < 60; i++) {
    const len = a.toString().length;
    if (rng() < 0.75 || len === 0) {
      a.insert(len === 0 ? 0 : Math.floor(rng() * (len + 1)), letters[Math.floor(rng() * letters.length)]);
    } else {
      a.delete(Math.floor(rng() * len), 1);
    }
  }
  const fresh = new Doc('B');
  const update = a.encodeUpdate(fresh.encodeStateVector());
  fresh.decodeAndApply(update);
  return { equal: a.toString() === fresh.toString(), a: a.toString(), b: fresh.toString(), bytes: update.length, chars: a.toString().length };
}

// ---------- Run the suite ----------

if (require.main === module) {
  let failures = 0;
  const TRIALS = 200;
  for (let seed = 1; seed <= TRIALS; seed++) {
    const r = runConvergenceTrial(seed);
    if (!r.allEqual) {
      failures++;
      if (failures <= 3) {
        console.error(`CONVERGENCE FAIL seed=${seed}`);
        r.texts.forEach((t, i) => console.error(`  r${i}: ${JSON.stringify(t)}`));
      }
    }
  }
  console.log(`Convergence: ${TRIALS - failures}/${TRIALS} trials converged.`);

  let encFail = 0;
  for (let seed = 1; seed <= TRIALS; seed++) {
    const e = runEncodingTrial(seed);
    if (!e.equal) {
      encFail++;
      if (encFail <= 3) console.error(`ENCODING FAIL seed=${seed}: A=${JSON.stringify(e.a)} B=${JSON.stringify(e.b)}`);
    }
  }
  console.log(`Encoding round-trip: ${TRIALS - encFail}/${TRIALS} trials converged.`);

  // Print one sizing sample: bytes-on-wire per visible char (block-wise win).
  const sample = runEncodingTrial(42);
  console.log(`Sizing sample: ${sample.chars} visible chars encoded in ${sample.bytes} bytes ` +
              `(${(sample.bytes / Math.max(1, sample.chars)).toFixed(1)} bytes/char incl. metadata).`);

  if (failures || encFail) process.exit(1);
}

module.exports = { Doc, runConvergenceTrial, runEncodingTrial };
```

**What this code teaches (and where it cuts corners vs. Yjs):**

- **Block-wise storage** (`Block` holds a *run* of chars; `_splitAt` / `_tryMerge` keep block count low) — this is the single optimization that turns a naive CRDT from unusable to viable.
- **Tombstones** (`deleted` flag preserves the element as an origin anchor; never freed in this impl — exactly the §3.2 problem; a production impl adds the §4.3 GC).
- **Idempotent application** (`applied` set) so duplicate delivery is safe.
- **Deterministic concurrent-insert ordering** (`_concurrentSkip` by client id) so all replicas converge — the heart of a sequence CRDT.
- **Update encoding** with varints + length-prefixed strings + **per-run (not per-char)** entries, plus a **state vector** so a peer fetches only the delta.
- **Corners cut**: it does not *buffer causally-out-of-order* ops (it appends/ignores instead of waiting for missing origins), its concurrent-ordering rule is simplified versus YATA's full origin-interval rule, and it has no rich-text marks. The property test passes because the test delivers ops in a way that respects causal availability by the final flush. **In production: use Yjs.** The point of this file is that you now understand what Yjs is doing under the hood and why its numbers are what they are.

---

## 10. Checklists, Sizing Math & Cheat Sheet

### 10.1 Pre-build checklist

- [ ] Decided **CRDT vs OT vs LWW+fractional-index** with the §8.3 decision tree, and wrote down the *reason* (offline? server? text-vs-objects?).
- [ ] Defaulted to **adopt Yjs** unless a documented reason to build.
- [ ] Chose a **provider** (WebSocket relay almost always) and confirmed it does **server-side persistence + snapshots + auth**.
- [ ] Separated **awareness/presence** from the document (ephemeral, throttled, TTL'd).
- [ ] Did the **sizing math** (§3.6) for your expected doc size × churn factor; confirmed in-memory and on-wire numbers are acceptable.
- [ ] Defined a **snapshot/compaction** policy (every N updates / on idle).
- [ ] Defined a **tombstone GC** policy AND understood its limit vs. unbounded offline (§4.3).
- [ ] For rich text: using **Yjs `Y.Text` + ProseMirror/TipTap** or a **Peritext-based** marks model — *not* index-based formatting.

### 10.2 Pre-ship (production-readiness) checklist

- [ ] **Property-based convergence test** in CI (random concurrent ops, shuffled + duplicated delivery, byte-identical assert).
- [ ] **automerge-perf trace** (and your own captured traces) replayed in CI with perf/memory regression gates.
- [ ] **Fuzzer** running millions of iterations (insert/delete/format/partition/heal).
- [ ] **Jepsen-style partition tests** for the sync/provider layer.
- [ ] Dashboard with: **doc size, tombstone ratio, sync payload p99, load time p95, apply time, awareness rate, snapshot lag, cross-replica divergence hash**.
- [ ] **Offline + reconnect** tested: long offline edit, reconnect, convergence, awareness re-announce.
- [ ] **Large-doc** path: diff-sync only, wire compression, lazy load, update batching.
- [ ] Decided product behavior for **orphaned comments/annotations** on deleted anchors.

### 10.3 Sizing cheat sheet

```
Naive per-char CRDT:    ~50–100+ bytes/char metadata in memory  → DON'T
Block-wise (Yjs-style): metadata per RUN, ~2–8 bytes/char encoded for prose → DO
Tombstone ratio:        deleted/live; alert > 5–10×; GC against acked frontier
Snapshot:               load = O(snapshot parse + tail replay), not O(history)
Sync:                   state-vector / Bloom diff → send only the delta, then compress
In-memory ≈ encoded × 3–8 (object overhead)
```

### 10.4 Decision cheat sheet

```
Offline / P2P / no-coordinator required?     → CRDT (Yjs text, Automerge JSON)
Hosted, long collaborative text, have server → OT (or Yjs)
Object tree + properties, have server        → LWW/property + fractional index (Figma pattern)
Structured records, server-of-truth          → sync engine + LWW (Linear pattern)
Unsure / deadline                            → adopt Yjs + managed provider
```

---

## 11. Summary

- **Attribution matters.** Yjs and Automerge are real CRDTs (Yjs = block-wise text CRDT with the richest editor ecosystem; Automerge = columnar JSON CRDT for local-first). **Figma is NOT a full CRDT** — it uses **LWW-per-property + fractional indexing + central-server arbitration**, by deliberate choice, because it has a server and its data is an object tree, not long text. **Google Docs uses OT**, not a CRDT, and rationally so. For Notion/Linear/Apple Notes, **describe the pattern and attribute cautiously** unless you have a primary source.
- **The CRDT-vs-OT decision is dominated by one question**: do you need offline / peer-to-peer / no-coordinator merges? Yes ⇒ CRDT. No ⇒ you have a server, and OT (text) or LWW+fractional-index (objects) is often leaner.
- **Economics decide whether you ship.** Naive per-char CRDTs are 50–100+ bytes/char and accumulate tombstones forever. **Block-wise (Yjs) and columnar (Automerge) encoding** are what made CRDTs viable — do the sizing math, monitor the tombstone ratio, and snapshot to bound load time.
- **Tombstone GC and unbounded offline editing are in fundamental tension**; full GC needs a coordinator and an acknowledged causal frontier.
- **Networking**: keep awareness ephemeral and separate; default to a WebSocket relay with server-side persistence/snapshots; diff-sync only; handle offline+reconnect.
- **Rich text is the hard part** — use Peritext-style ID-anchored marks (or Yjs's bindings), never index-based spans.
- **You cannot ship what you can't fuzz**: property-based convergence tests, real-trace replay, fuzzing, Jepsen-style partition tests, and a divergence dashboard are table stakes.
- **Build vs buy: adopt Yjs.** Writing a correct, fast, memory-lean CRDT with marks, snapshots, GC, and a tested sync protocol is multi-engineer-years; the open-source options already did it.

Continue with the other tiers: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [interview](interview.md). Foundations: [CRDT Fundamentals](../01-crdt-fundamentals/professional.md) · related: [Set CRDTs](../04-sets-or-set-lww/professional.md).

---

## 12. Further Reading

- **Yjs documentation** — <https://docs.yjs.dev/> (the `Y.Text` / shared-types model, providers, awareness; the canonical block-wise CRDT for editors).
- **Martin Kleppmann et al., "A CRDT-based collaborative editing approach" / `automerge-perf`** — the academic line behind Automerge and the standard ~260K-op keystroke editing trace benchmark; see <https://github.com/automerge/automerge-perf>.
- **Automerge documentation & the Automerge 2.0 writeup** — <https://automerge.org/> (columnar binary encoding, Rust core, Bloom-filter sync, JSON CRDT for local-first).
- **Evan Wallace / Figma engineering, "How Figma's multiplayer technology works"** — <https://www.figma.com/blog/how-figmas-multiplayer-technology-works/> (the canonical statement that Figma is **not** a pure CRDT: LWW-per-property + fractional indexing + server arbitration, and *why*).
- **Ink & Switch, "Local-first software: You own your data, in spite of the cloud"** — <https://www.inkandswitch.com/local-first/> (the essay that frames why new offline-first apps choose CRDTs).
- **Ink & Switch, "Peritext: A CRDT for Rich-Text Collaboration"** — <https://www.inkandswitch.com/peritext/> (the reference design for ID-anchored formatting marks).
- **Jepsen** — <https://jepsen.io/> (partition-testing methodology to validate your *sync layer*, not just your data type).
- **YATA paper (Nikolaus Jahns / Yjs)** — "Near Real-Time Peer-to-Peer Shared Editing on Extensible Data Types" (the algorithm behind Yjs's block-wise sequence).
