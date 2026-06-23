# CRDT Fundamentals — Professional Level

> **Audience.** A senior engineer about to ship CRDTs into a production fleet — or already running them and bleeding from the metadata. You know the theory: join-semilattices, monotone merges, the strong-eventual-consistency (SEC) guarantee. This page is about what happens *after* the proof: how state actually grows, where the tombstones bury you, which companies run which CRDT and why, and how to decide — honestly — whether you should be using one at all.
>
> **Read time.** ~55 minutes. **Prerequisites.** [junior](junior.md), [middle](middle.md), [senior](senior.md). For the theory you'll see referenced here, go back to [senior](senior.md); for interview-shaped recall, [interview](interview.md).

---

## Table of Contents

1. [The one-paragraph refresher (so we agree on terms)](#1-the-one-paragraph-refresher)
2. [Where CRDTs actually ship](#2-where-crdts-actually-ship)
3. [The metadata-cost reality](#3-the-metadata-cost-reality)
4. [Garbage collection in practice](#4-garbage-collection-in-practice)
5. [Delta-state CRDTs and anti-entropy](#5-delta-state-crdts-and-anti-entropy)
6. [Choosing CRDTs vs the alternatives](#6-choosing-crdts-vs-the-alternatives)
7. [Observability and testing](#7-observability-and-testing)
8. [Operational pitfalls and incidents](#8-operational-pitfalls-and-incidents)
9. [A production-shaped CRDT store (code)](#9-a-production-shaped-crdt-store-code)
10. [Capacity, sizing, SLOs, and rollout](#10-capacity-sizing-slos-and-rollout)
11. [Checklists](#11-checklists)
12. [Cheat sheet](#12-cheat-sheet)
13. [Summary](#13-summary)
14. [Further reading](#14-further-reading)

---

## 1. The one-paragraph refresher

A CRDT is a data type whose replicas converge to the same value once they have seen the same set of updates, **without coordination**. Two families exist: **state-based (CvRDT)**, where replicas exchange their whole state and merge it with a join (least-upper-bound) operation that is **commutative, associative, and idempotent**; and **operation-based (CmRDT)**, where replicas broadcast operations that must be delivered (typically in causal order) and applied — those operations need only commute for concurrent pairs. The deep dive on that split lives in [State-based vs Operation-based CRDTs](../02-state-vs-operation-based-crdts/professional.md). Everything below assumes you've internalized that merge is a lattice join and that "convergence" is a mathematical consequence, not a hope.

The professional reality the theory papers over: **convergence is cheap; the metadata to make merge associative is expensive, and it does not shrink on its own.** That is the entire content of this page.

---

## 2. Where CRDTs actually ship

Attribution discipline matters here. The list below is restricted to systems whose CRDT use is publicly documented by the vendor or by the engineers who built them. Where a usage is folklore, it is marked as a *pattern* rather than a named deployment.

### 2.1 Databases and key-value stores

| System | Vendor / origin | CRDTs used | Notes |
|---|---|---|---|
| **Riak KV + Riak DT** | Basho | G-Counter, PN-Counter, OR-Set, LWW-Register, Maps, Flags | The canonical production CRDT database. "Riak DT" shipped data types as first-class values with server-side convergence. Basho's engineers (Cribbs, Brown) co-authored much of the delta-CRDT and AAE work. |
| **Bet365** | — (Riak user) | PN-Counters / OR-Sets on Riak | Publicly discussed adopting Riak + Erlang for high-throughput betting state; counters and sets under heavy concurrent write load are the textbook fit. Bet365 later acquired Basho's assets. |
| **Redis Enterprise (Active-Active / CRDB)** | Redis Inc. | CRDT-backed versions of Strings, Counters, Sets, Hashes, Sorted Sets, Lists | "CRDB" = Conflict-free Replicated Database. Multi-region active-active where each geo accepts writes; Redis data types are reimplemented with CRDT semantics underneath. The whitepaper is the best vendor-side explanation of LWW-vs-CRDT tradeoffs at the type level. |
| **Cosmos DB / DynamoDB-style AP stores** | Microsoft / Amazon | LWW registers (and conflict feeds) | These are **not** general CRDT engines. Cosmos DB's multi-region multi-write uses **LWW by default** (timestamp/region-priority) with an optional custom conflict-resolution stored procedure or a conflict feed. DynamoDB global tables are **LWW**. Mention them as the *boundary case*: AP multi-master, but conflict resolution is LWW, not a set/counter CRDT. |

### 2.2 Collaborative editing (the JSON / text CRDT lineage)

| System | Origin | CRDTs used | Notes |
|---|---|---|---|
| **Automerge** | Martin Kleppmann, Ink & Switch | JSON CRDT (RGA-style sequence + maps + registers), columnar binary encoding | The reference "local-first" JSON CRDT. Compresses operation history into a columnar format; supports full history/time-travel. Heavier metadata, richer semantics. |
| **Yjs** | Kevin Jahns | YATA sequence CRDT + shared types (Y.Map, Y.Array, Y.Text) | The performance-leader for real-time editing. Aggressively optimized: struct-store with item splitting/merging, delete-set GC, state-vector-based sync. Powers a large share of "Google-Docs-style" web editors via y-websocket / y-webrtc bindings. |
| **Figma** | Figma | *Custom* multiplayer engine (LWW-per-property on a tree), **not** an off-the-shelf CRDT | Figma's own engineers describe their system as CRDT-*inspired* but bespoke: a server is authoritative, each object property is last-writer-wins, and the tree has special-cased conflict rules (e.g., for reparenting). Treat Figma as a *pattern* — "server-arbitrated LWW with CRDT-like merge for a document tree" — not as "Figma uses Automerge." |

The distinction in that last row is the kind of attribution error that gets repeated in blog posts. Figma's blog ("How Figma's multiplayer technology works") is explicit that they did *not* use a textbook CRDT.

### 2.3 Frameworks, sync engines, and consumer products

| System | Origin | CRDTs used | Notes |
|---|---|---|---|
| **Akka Distributed Data** | Lightbend | Delta-CRDT library: GCounter, PNCounter, GSet, ORSet, ORMultiMap, LWWMap, LWWRegister, Flag | A production delta-CRDT toolkit on top of Akka Cluster gossip. Good source of *naming/replicator* design decisions and how delta propagation is wired into gossip. |
| **SoundCloud Roshi** | SoundCloud | **LWW-element-set** over Redis | An index/timeline store. Roshi is a clean public example of a **LWW-Set CRDT** built as a thin layer over many Redis instances, with read-repair. Open source; the README is a good "CRDT-as-a-service-over-a-dumb-store" case study. |
| **Apple Notes / iCloud sync** | Apple | CRDTs for note bodies (documented in WWDC/engineering talks at a high level) | Apple has publicly discussed using CRDT techniques for conflict-free sync of note content across devices. Treat the *mechanism* details as not fully public — the safe claim is "Apple uses CRDT-style merge for offline-edited note sync." |
| **TomTom** | TomTom | CRDTs in their sync/collaboration stack | TomTom engineers have given public talks on adopting CRDTs (notably Automerge-style JSON CRDTs) for distributed/offline data. Cite as "publicly discussed adoption," not a specific schema. |
| **PayPal** | PayPal | CRDT-based eventually consistent stores discussed in engineering talks | PayPal engineers have spoken about CRDTs for high-availability counters/sets in their data platform. Again: cite the *talk*, describe the *pattern*. |

**The honest summary of the landscape:** two big buckets. (1) *AP databases* that expose CRDT *types* so app developers stop hand-rolling merge logic — Riak DT, Redis CRDB, Akka DData. (2) *Collaborative-editing engines* where a sequence/JSON CRDT is the core product — Automerge, Yjs. Almost everything else (Figma, DynamoDB global tables, Cosmos DB) is **LWW-with-arbitration**, which is technically a (degenerate) CRDT but loses the "no data loss on concurrent write" property that makes CRDTs interesting.

---

## 3. The metadata-cost reality

This is the section that separates people who *read* about CRDTs from people who've *run* them. The value you care about (a counter total, a set's members) is small. The bookkeeping required to make merge associative is not.

### 3.1 The shapes of metadata

Three structures show up everywhere:

- **Version vectors (VV):** one integer per actor, `{actor_id → max_seq_seen}`. Size = `O(#actors)`. Used to detect "have I seen this update?" and to compare causality (`a ≤ b` iff every entry of `a` ≤ the corresponding entry of `b`).
- **Dotted version vectors (DVV):** a VV plus a set of detached *dots* `(actor, seq)` that represent updates seen out of contiguous order. DVVs let you represent "I've seen actor A up to 5, plus A's dot 9, but not 6–8." Riak uses **dotted version vectors** for per-key causality precisely to avoid sibling explosion under concurrent client writes. Size = `O(#actors + #detached dots)`.
- **Tombstones:** markers that a removed element *was* removed, kept so a concurrent re-add or a lagging replica doesn't resurrect it. An OR-Set keeps `(element, unique-tag)` pairs in an add-set and a remove-set; a removed element's tags linger as tombstones until you can prove no one needs them.

For an OR-Set specifically: every `add(e)` mints a **unique tag** (a dot). A `remove(e)` records the set of tags currently observed for `e`. State size is therefore `O(#adds-ever)` for the add-set tags and `O(#removes-ever)` for the remove metadata — **not** `O(current members)`. A set that holds 100 elements but has seen 10 million add/remove cycles carries 10 million tags' worth of metadata. That is the failure mode.

### 3.2 How state grows with cluster size and churn

Two independent multipliers:

1. **Cluster size (number of actors).** Every VV/DVV is `O(#actors)`. A G-Counter across `N` replicas is an `N`-entry map *per counter*. With 1,000 counters and 50 replicas that's 50,000 integers minimum — fine. The danger is when "actor" doesn't mean "replica."

2. **Churn (number of distinct operations ever performed).** OR-Set tags, sequence-CRDT character IDs, and tombstones accumulate per *operation*, not per *live element*. A document edited a million times has a million-ish identifiers even if it's 500 words long (this is exactly why Yjs and Automerge invest so heavily in run-length / columnar encoding and GC — see §4).

### 3.3 The actor-id explosion problem

The single most common way teams blow up CRDT metadata in production:

> **Every client mints a fresh, globally-unique actor ID, and clients are ephemeral.**

A G-Counter's state is a map keyed by actor ID. If your "actors" are *browser tabs* or *mobile app launches* — each generating a new UUID — then over a month you accumulate **millions of actor entries** in a counter that conceptually counts a single number. The VV never shrinks because old actors might "come back." This is the canonical CRDT OOM.

The same disease hits sequence CRDTs: in Automerge/Yjs each editing session is an actor, and the per-character IDs reference actor IDs. Millions of one-edit sessions means millions of actor namespaces in the operation log.

**Mitigations (in rough order of preference):**

| Mitigation | What it is | Cost / caveat |
|---|---|---|
| **Server-side actor IDs** | Clients send *operations*; a bounded set of server replicas own the actor IDs and apply them. Clients are never actors. | Reintroduces a round trip / loses pure offline P2P. This is what Roshi-style and most "CRDT-over-a-server" systems actually do. |
| **Named (stable) vs anonymous actors** | Give *long-lived* participants stable IDs (a device that syncs for years), give *transient* participants disposable IDs that you GC aggressively. | Need a policy for "when is an anonymous actor dead." |
| **Actor-ID recycling / interning** | Map external client IDs to a small, reused internal ID space; reclaim IDs of provably-gone actors. | Recycling is only safe once an actor is **causally stable** (no in-flight ops reference it) — see §4. Recycling too early = correctness bug. |
| **Compaction to a coordinator** | Periodically, an authoritative node "absorbs" many actor entries into its own single entry (sum the per-actor sub-counts of a PN-Counter into one). | Requires a coordination point; only some CRDTs support a sound absorb. For a G-Counter you can't simply collapse without losing the ability to merge concurrent old states — you must prove those actors are stable first. |

The meta-rule: **the number of actors must be bounded and roughly equal to the number of long-lived, independently-writing replicas — not the number of clients.** If you can't guarantee that, you don't want a pure client-side state CRDT; you want clients shipping *operations* to a bounded server replica set.

---

## 4. Garbage collection in practice

CRDT GC is where most "we adopted CRDTs and it was great" stories quietly add "...until month four."

### 4.1 The unbounded-growth failure mode

Restating it crisply: **the value can be bounded while the metadata is monotonically increasing.** OR-Set tombstones, sequence-CRDT deleted items, and dead actor entries all grow with *history*, not with *current size*. Without GC:

- Memory grows until OOM.
- Merge latency grows (you're merging ever-larger structures — merge is at least `O(state size)`).
- Replication bandwidth grows (more state to ship).
- Cold-start / rehydration time grows.

Teams hit this as a *slow* incident: dashboards look fine for weeks, then `merge_latency_p99` and `rss` creep, then a node OOMs during a GC pause or a rebalance, then the replica that takes over also OOMs because it inherited the same fat state. Classic cascading failure.

### 4.2 Causal stability: the key that unlocks GC

You may delete a tombstone only when you can **prove no replica will ever again present an operation that needs it.** That property is **causal stability**: an update is causally stable once *every* replica has seen it (and everything before it), so no concurrent operation referencing it can still be in flight.

Detecting causal stability requires knowing the *minimum* progress across all replicas — typically a **stable version vector** computed as the element-wise minimum of all replicas' VVs. An update `(actor, seq)` is stable when `min_over_replicas(VV[actor]) ≥ seq`. Anything below the stable frontier can be compacted: its tombstones dropped, its tags coalesced, its actor entries potentially recycled.

The catch that bites teams: **computing the min requires hearing from every replica.** One permanently-partitioned or decommissioned-but-not-removed replica pins the stable frontier at the dawn of time, and GC stops entirely. Operational consequence: **you must have a reliable replica-membership / eviction process**, or a single zombie node silently disables garbage collection across the fleet.

### 4.3 Compaction in the editors

- **Automerge** keeps the full operation history (that's a feature — time travel, blame). It controls cost via a **columnar binary encoding** of the change log (run-length and delta encoding of the highly-repetitive op stream) and a `save()`/`load()` cycle that produces a compact document. Newer Automerge work pushes on incremental compaction and chunked storage so you don't re-encode the world on every save. The mental model: *history is never thrown away, but it is squeezed hard.*

- **Yjs** does the opposite end of the spectrum: it **actively garbage-collects deleted content.** Its struct store merges adjacent items (run-length) and, by default, *replaces deleted content with a compact "GC" marker* (`Y.Doc({ gc: true })`), keeping only the delete-set tombstone needed for convergence rather than the deleted text itself. Sync uses **state vectors** (`Y.encodeStateVector`) so a peer sends only the diff the other side is missing. This is why Yjs documents stay small under heavy churn while Automerge documents historically grew (and why Automerge's redesign focused so hard on encoding).

The tradeoff is explicit: **Automerge = retain history, accept size, get time-travel; Yjs = discard deleted content aggressively, get small size, lose full history.** Choose based on whether your product needs an audit/version trail.

### 4.4 Tombstone reclamation patterns you'll implement

1. **Epoch/stability-based:** track the stable VV; on a periodic compaction pass, drop everything below it. Simple, sound, requires full membership liveness.
2. **TTL-bounded (pragmatic, slightly unsafe):** drop tombstones older than `T` where `T ≫ max realistic partition + max clock skew`. Used by LWW-set systems (Roshi-style) where the worst case of dropping too early is a resurrected element, which is acceptable for the use case (a timeline). **Never** use bare TTL where resurrection corrupts an invariant.
3. **Coordinated compaction:** a leader/coordinator periodically performs a sound "absorb" and broadcasts a new compact snapshot. Trades a little coordination for bounded metadata — and is, in practice, what most "CRDT" production systems do, blurring the line with consensus.

---

## 5. Delta-state CRDTs and anti-entropy

### 5.1 Why nobody ships full-state CvRDTs

Naïve state-based CRDTs ship the **entire state** on every sync. For a 50 MB OR-Set that gained one element, you'd transmit 50 MB to propagate 30 bytes of real change. That is a non-starter at fleet scale.

**Delta-state CRDTs** (δ-CRDTs, Almeida–Shoker–Baquero) fix this: each operation produces a small **delta** — itself a CRDT fragment from the same lattice — and you propagate and merge *deltas* instead of full states. Merging a delta is the same join operation, so all the convergence guarantees hold. The wins:

- **Bandwidth:** you ship `O(change)` not `O(state)`.
- **Delta-interval / delta-buffer:** a replica buffers recent deltas and ships a *causally-contiguous interval* to peers that are slightly behind, falling back to a full-state anti-entropy only when a peer is too far behind to catch up from the buffer.

This is the model Akka Distributed Data implements (the Replicator gossips deltas, with periodic full-state gossip as backstop) and the model you should default to for any new state-based CRDT system. Detail in [State-based vs Operation-based CRDTs](../02-state-vs-operation-based-crdts/professional.md).

### 5.2 Anti-entropy via Merkle trees (Riak AAE)

Deltas handle the *fast path* (recent changes). You still need a *background* mechanism to detect and repair divergence from dropped messages, bit rot, or restored-from-backup nodes. The standard tool is a **Merkle tree** over the keyspace, exchanged between replicas to find *exactly which keys differ* in `O(log n)` comparisons instead of scanning everything.

Riak's **Active Anti-Entropy (AAE)** is the reference implementation: each vnode maintains a persistent hash tree of its keys/objects; periodically two replicas exchange tree roots, descend only into subtrees whose hashes differ, and **read-repair** the divergent keys (merging their CRDT values). The economics: a full keyspace comparison costs one root-hash exchange when everything agrees, and `O(divergent keys · log n)` when it doesn't. Dynamo-lineage stores (Cassandra's anti-entropy repair, Roshi's read-repair) use the same family of techniques.

**Operational note:** AAE/Merkle repair is itself a load source. Tree rebuilds and full repairs can saturate disk and network; teams schedule them off-peak and rate-limit them. A common incident is "the cluster got slow at 02:00 every night" → it was the AAE tree rebuild.

---

## 6. Choosing CRDTs vs the alternatives

CRDTs are a tool for **availability under partition with no coordination**. They are the wrong tool for many problems, and choosing them by default is how you end up with the metadata incidents in §8. Decide deliberately.

### 6.1 The decision table

| Approach | Consistency | Coordination needed | Tolerates partition (still writable) | Can lose writes? | Best for | Worst for |
|---|---|---|---|---|---|---|
| **CRDT** | Strong eventual (SEC) | None | **Yes** | **No** (concurrent writes all survive, merged by type semantics) | Counters, sets, presence, carts, offline-first editing, multi-region AP | Anything needing a global invariant (uniqueness, balance ≥ 0), or where merge semantics surprise users |
| **LWW + light coordination** | Eventual; "loser" silently dropped | Optional (timestamp/region priority) | Yes | **Yes** — concurrent write loses | Idempotent "latest value wins" fields (a profile name, a setting), where lost concurrent edits are acceptable | High-value concurrent edits; anything where silent loss is a bug |
| **Consensus (Raft/Paxos)** | Linearizable / strong | **Yes** (quorum) | **No** (minority partition can't write) | No | Invariants that *must* hold globally: uniqueness, balances, leader election, config | High-availability writes during partition; ultra-low-latency multi-region writes |
| **Operational Transformation (OT)** | Convergent w/ central server | Usually a central server to order/transform ops | Partially (degrades without server) | No (transforms preserve intent) | Real-time text editing with a server in the loop (Google Docs lineage) | Pure P2P / serverless offline; OT correctness is famously hard to get right across all op pairs |

### 6.2 Reading the table

- **CRDT vs LWW.** LWW *is* a CRDT (a LWW-Register is the simplest CRDT). The real question is "is silent loss of the concurrent write acceptable?" For a counter, *no* (you'd lose increments) → use a PN-Counter. For "user's display name," *probably yes* → LWW is simpler and cheaper. **Choose the weakest type that preserves your intent**, because stronger types (OR-Set, sequence) cost more metadata. See [Counters](../03-counters-g-pn/professional.md) and [Sets / OR-Set / LWW](../04-sets-or-set-lww/professional.md).

- **CRDT vs consensus.** This is the CAP decision. If you need a global invariant, you need coordination, full stop — **no CRDT can enforce one** (§6.3). If you need to stay writable in a minority partition and can tolerate eventual convergence, CRDT.

- **CRDT vs OT.** Both solve collaborative editing. OT (Google Docs) needs a central server to transform concurrent ops against each other and is notoriously hard to prove correct (the famous "TP2" transformation-property bugs). CRDTs (Automerge/Yjs) push the convergence into the data type itself and work P2P/offline — at the cost of more per-character metadata. The industry has largely moved toward CRDTs for *new* offline-capable editors; established server-centric editors keep OT. See [Sequence/Text CRDTs](../05-sequences-and-text-crdts/professional.md).

### 6.3 Invariants CRDTs CANNOT enforce

Burn this into the team's collective memory. CRDTs guarantee **convergence**, not **correctness of a global predicate**. Any invariant that requires knowing the *global* state at write time cannot hold under uncoordinated concurrent writes:

| Invariant you want | Why a CRDT can't give it | What to do instead |
|---|---|---|
| **Global uniqueness** ("this username is taken") | Two partitions can both "claim" the same username; merge will contain both. No type makes that not-happen without coordination. | Allocate uniqueness from a coordinated authority (a single-writer per namespace, a consensus group, or a uniqueness service). CRDT can *track* claims; it can't *prevent* duplicates. |
| **Non-negative balance / no overdraft** | Two partitions each see balance 100, each withdraw 80; merge → −60. A PN-Counter happily represents −60. | Use a **reservation/escrow** pattern (pre-allocate budget per replica, like a bounded-counter / escrow-CRDT) or require consensus for the withdrawal path. |
| **"At most N of X"** (inventory, rate limit) | Same overshoot problem as balance. | Escrow N tokens across replicas up front (each replica may spend only its tranche); fall back to coordination to redistribute. |
| **Referential integrity across keys** | Concurrent ops can leave a dangling reference after merge. | Application-level repair, or model the relationship inside *one* CRDT object so merge is atomic for it. |

The professional phrasing for a design review: *"CRDTs convert the consistency problem into a convergence problem. If your invariant survives any interleaving of merges, a CRDT fits. If a specific interleaving violates your invariant, you need coordination on that path — no amount of CRDT cleverness removes that."*

---

## 7. Observability and testing

CRDT bugs are *convergence* bugs and *growth* bugs. Both are hard to catch with example-based tests because they appear only under specific concurrent interleavings or only after months of churn. You test them with **properties** and **simulation**, and you watch them with **metadata metrics**.

### 7.1 Property-based testing for convergence

The merge of a state CRDT must form a **join-semilattice**: it must be **commutative**, **associative**, and **idempotent**. These are *properties*, so test them as properties (generate thousands of random states/op-sequences and assert the law) rather than hand-picking examples. This is exactly the use case the property-based-testing discipline exists for.

The four laws to encode:

```
Commutativity:   merge(a, b)            == merge(b, a)
Associativity:   merge(merge(a, b), c)  == merge(a, merge(b, c))
Idempotence:     merge(a, a)            == a
Convergence:     for any permutation/duplication of a delta multiset D,
                 folding merge over D yields the same final state
```

The fourth (convergence under reordering/duplication) is the one that catches real bugs: generate a set of deltas, apply them to several replicas in **different random orders, with random duplicates and drops-then-redelivery**, and assert all replicas equal. If that ever fails, your merge isn't a true join. A runnable version is in §9.

### 7.2 Jepsen-style partition testing

Property tests check the *type*. Jepsen checks the *system*: it injects **network partitions, clock skew, process pauses, and node crashes** while a workload runs, then checks the recorded history against a consistency model. For CRDT systems the relevant Jepsen-style assertions are:

- After healing every partition and draining replication, **all replicas converge** to byte-identical state.
- **No acknowledged write is lost** (every increment that returned success is reflected in the final counter; every added-and-not-removed element is in the final set).
- For LWW fields, the documented tie-break actually holds.

Riak's CRDT behavior was famously studied with Jepsen (Aphyr's analyses), which is part of why Riak DT's semantics are well-documented. If you're shipping a CRDT store, a Jepsen (or Jepsen-like `jepsen`/`maelstrom`) suite is table stakes for credibility.

### 7.3 Deterministic simulation and fuzzing

- **Deterministic simulation testing (DST):** run the whole replicated system in a single process with a *seeded, virtual* network and clock, so any failing interleaving is **perfectly reproducible from the seed**. This is the FoundationDB-popularized technique and is the gold standard for distributed-data-structure testing. You can hammer millions of message orderings per minute and replay the one that broke.
- **Merge fuzzing:** treat your serialized CRDT state as the fuzz target — generate arbitrary (even malformed) states and feed `merge(deserialize(a), deserialize(b))`, asserting it never panics and always yields a valid lattice element. Catches deserialization and "partial state" bugs that property tests with well-formed inputs miss.

### 7.4 Metrics to watch (the four numbers that predict your next incident)

| Metric | Why it matters | Alert when |
|---|---|---|
| **State size per object (p50/p99/max)** | Detects metadata bloat *before* OOM. | p99 grows monotonically over days; max object exceeds a hard cap (e.g., 1 MB). |
| **Tombstone / dead-actor count per object** | Direct measure of GC health. | Count grows while *live* size is flat → GC is stalled (likely a zombie replica pinning the stable VV). |
| **Merge latency (p99)** | Merge is `O(state)`; rising latency = rising state. | p99 climbs; correlates with state-size growth. |
| **Replication lag / convergence time** | Time from write to all-replicas-converged. Drives your "how stale can a read be" SLO. | Lag exceeds the window your GC TTLs assume (dangerous: you might GC something still in flight). |

A fifth worth tracking: **actor-count per object** (the §3.3 explosion canary). If it tracks request volume rather than replica count, you have the bug *now*, not later.

---

## 8. Operational pitfalls and incidents

Anonymized, composited from publicly-discussed CRDT failure modes. Each is a pattern you should be able to recognize on a dashboard.

### 8.1 Clock-driven LWW data loss

**Shape.** A LWW-Register / LWW-Map used a wall-clock timestamp as the tie-breaker. One fleet had a few nodes with NTP misconfigured, running **minutes** ahead. Those nodes' writes won *every* conflict regardless of real ordering; correct, more-recent writes from healthy nodes were silently discarded because their timestamps were "older." Users reported "my edit reverted itself."

**Root cause.** Physical clocks are not a causal ordering. LWW with wall-clock loses data exactly when clocks disagree — and clocks *always* eventually disagree.

**Fixes.** (1) Use a **hybrid logical clock (HLC)** or logical timestamps so causally-later always wins over causally-earlier, with a stable tiebreak (e.g., actor ID) only for true concurrency. (2) Where loss is unacceptable, **don't use LWW** — use an OR-Set / counter that preserves all writes. (3) Monitor clock skew and refuse to accept writes from a node whose skew exceeds a bound.

### 8.2 Tombstone storms

**Shape.** An OR-Set tracked "items in a frequently-rebuilt index." A nightly job cleared and rebuilt the set: millions of removes (→ tombstones) followed by millions of adds, every night. Tombstones never GC'd because one decommissioned-but-not-evicted replica pinned the stable VV (§4.2). Within weeks, set objects were hundreds of MB; merges took seconds; a rebalance OOM'd a node and the failover inherited the bloat and OOM'd too.

**Root cause.** Churn-proportional metadata + stalled causal-stability detection.

**Fixes.** Reliable replica eviction so the stable VV advances; switch the "rebuild" pattern to *diff-and-apply* (only emit ops for actual changes) instead of clear-and-readd; cap object size with an alert; consider a non-CRDT store for a fully-rebuilt index (a CRDT's value here was marginal).

### 8.3 Metadata-bloat OOMs from actor-id explosion

**Shape.** Exactly §3.3: a per-user "activity counter" was a G-Counter whose actor ID was minted **per mobile session**. Map grew by ~the DAU count every day. Looked fine for a month; then merge latency and RSS climbed, and counters became multi-megabyte. The "counter" stored one number but carried millions of actor entries.

**Fixes.** Server-side bounded actor IDs (clients send increments as ops; a fixed replica set owns the counter). Retrofit: a coordinated compaction that, once actors are provably stable, sums their sub-counts into a single replica entry.

### 8.4 Semantic surprises: concurrent add/remove → add-wins

**Shape.** A shopping cart used an OR-Set. User on phone removes an item; user on laptop (offline) had concurrently re-added it. On merge, OR-Set semantics are **add-wins**: the item *reappears* in the cart. Support tickets: "I deleted this and it came back." It's not a bug — it's the *defined* semantics — but nobody told product.

**Root cause.** The team picked OR-Set for its convergence properties without socializing its *conflict semantics* (add-wins) to product/design. (The mirror image — Remove-wins set / 2P-Set — would have surprised users the other way: "I added it and it vanished.")

**Fixes.** Choose set semantics from the *product* requirement, not convenience: add-wins, remove-wins, or last-write-wins each give a different user-visible behavior under concurrent add/remove. Document it. For "delete should be sticky," a remove-wins or LWW design is closer to user expectation. Deep treatment in [Sets / OR-Set / LWW](../04-sets-or-set-lww/professional.md).

### 8.5 The general lesson

Every one of these is *either* a metadata-growth problem (§3, §4) *or* a semantic-mismatch problem (the conflict resolution didn't match user intent). Those are the two CRDT incident categories. Convergence itself almost never breaks in a well-tested implementation — it's the cost and the *meaning* of convergence that get you.

---

## 9. A production-shaped CRDT store (code)

Below is a deliberately production-*shaped* (not toy) state-based CRDT store in Python: a **PN-Counter and an OR-Set**, with **delta propagation**, **version vectors**, **causal-stability-based GC**, and a **property-based convergence test** written out. It's ~250 lines and runs as-is on CPython 3.9+ (no third-party deps; the property test is hand-rolled so you can read the assertions).

```python
"""
A production-shaped state-based CRDT store with delta propagation,
version vectors, and causal-stability GC. Single-file, stdlib-only.

Design notes you'd actually defend in review:
  * Actors are BOUNDED (a fixed replica set). Clients are NOT actors;
    they call into a replica. This avoids the actor-id explosion.
  * Every mutation returns a DELTA (a small CRDT fragment) for gossip.
  * GC runs only below the causally-stable frontier (min over replica VVs).
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, Set, Tuple, Iterable, Optional
import itertools
import random
import uuid

ActorId = str
Dot = Tuple[ActorId, int]  # (actor, sequence number)


# --------------------------------------------------------------------------
# Version vector
# --------------------------------------------------------------------------
class VersionVector(dict):
    """{actor -> max contiguous seq seen}. Supports merge and <= compare."""

    def merge(self, other: "VersionVector") -> "VersionVector":
        out = VersionVector(self)
        for a, s in other.items():
            out[a] = max(out.get(a, 0), s)
        return out

    def dominates_dot(self, dot: Dot) -> bool:
        a, s = dot
        return self.get(a, 0) >= s

    @staticmethod
    def stable_frontier(vvs: Iterable["VersionVector"]) -> "VersionVector":
        """Element-wise MIN across all replicas: the causally-stable VV.
        Anything <= this has been seen everywhere and is safe to compact."""
        vvs = list(vvs)
        if not vvs:
            return VersionVector()
        actors = set().union(*[set(v) for v in vvs])
        return VersionVector({a: min(v.get(a, 0) for v in vvs) for a in actors})


# --------------------------------------------------------------------------
# PN-Counter (two G-Counters: increments and decrements)
# --------------------------------------------------------------------------
@dataclass
class PNCounter:
    inc: Dict[ActorId, int] = field(default_factory=dict)
    dec: Dict[ActorId, int] = field(default_factory=dict)

    def value(self) -> int:
        return sum(self.inc.values()) - sum(self.dec.values())

    def increment(self, actor: ActorId, n: int = 1) -> "PNCounter":
        assert n >= 0
        self.inc[actor] = self.inc.get(actor, 0) + n
        return PNCounter(inc={actor: self.inc[actor]})  # delta

    def decrement(self, actor: ActorId, n: int = 1) -> "PNCounter":
        assert n >= 0
        self.dec[actor] = self.dec.get(actor, 0) + n
        return PNCounter(dec={actor: self.dec[actor]})  # delta

    def merge(self, other: "PNCounter") -> "PNCounter":
        inc = {a: max(self.inc.get(a, 0), other.inc.get(a, 0))
               for a in set(self.inc) | set(other.inc)}
        dec = {a: max(self.dec.get(a, 0), other.dec.get(a, 0))
               for a in set(self.dec) | set(other.dec)}
        return PNCounter(inc=inc, dec=dec)


# --------------------------------------------------------------------------
# OR-Set (add-wins) with dotted tags + tombstone GC below stable frontier
# --------------------------------------------------------------------------
@dataclass
class ORSet:
    # element -> set of dots that added it
    adds: Dict[str, Set[Dot]] = field(default_factory=dict)
    # tombstoned dots (removed adds)
    removed_dots: Set[Dot] = field(default_factory=set)

    def elements(self) -> Set[str]:
        return {e for e, dots in self.adds.items()
                if dots - self.removed_dots}

    def add(self, element: str, dot: Dot) -> "ORSet":
        self.adds.setdefault(element, set()).add(dot)
        return ORSet(adds={element: {dot}})  # delta

    def remove(self, element: str) -> "ORSet":
        """Add-wins remove: tombstone the dots we currently observe."""
        observed = self.adds.get(element, set()) - self.removed_dots
        self.removed_dots |= observed
        return ORSet(removed_dots=set(observed))  # delta

    def merge(self, other: "ORSet") -> "ORSet":
        adds: Dict[str, Set[Dot]] = {}
        for e in set(self.adds) | set(other.adds):
            adds[e] = self.adds.get(e, set()) | other.adds.get(e, set())
        removed = self.removed_dots | other.removed_dots
        return ORSet(adds=adds, removed_dots=removed)

    def gc(self, stable: VersionVector) -> None:
        """Drop tombstoned dots that are causally stable (seen everywhere):
        no in-flight op can reference them, so they can never resurrect."""
        stable_removed = {d for d in self.removed_dots
                          if stable.dominates_dot(d)}
        self.removed_dots -= stable_removed
        for e in list(self.adds):
            self.adds[e] -= stable_removed
            if not self.adds[e]:
                del self.adds[e]


# --------------------------------------------------------------------------
# Replica: owns a bounded actor id; produces deltas; merges deltas.
# --------------------------------------------------------------------------
class Replica:
    def __init__(self, actor: ActorId):
        self.actor = actor
        self.seq = 0
        self.vv = VersionVector({actor: 0})
        self.counter = PNCounter()
        self.orset = ORSet()
        self.delta_buffer: list = []  # recent deltas for interval gossip

    def _next_dot(self) -> Dot:
        self.seq += 1
        self.vv[self.actor] = self.seq
        return (self.actor, self.seq)

    def increment(self, n: int = 1):
        d = self.counter.increment(self.actor, n)
        self.delta_buffer.append(("counter", d))

    def add(self, element: str):
        d = self.orset.add(element, self._next_dot())
        self.delta_buffer.append(("orset", d))

    def remove(self, element: str):
        d = self.orset.remove(element)
        self.delta_buffer.append(("orset", d))

    def drain_deltas(self):
        out, self.delta_buffer = self.delta_buffer, []
        return out

    def apply(self, deltas, peer_vv: Optional[VersionVector] = None):
        for kind, d in deltas:
            if kind == "counter":
                self.counter = self.counter.merge(d)
            else:
                self.orset = self.orset.merge(d)
        if peer_vv:
            self.vv = self.vv.merge(peer_vv)

    def compact(self, all_vvs: Iterable[VersionVector]):
        stable = VersionVector.stable_frontier(all_vvs)
        self.orset.gc(stable)


# --------------------------------------------------------------------------
# PROPERTY-BASED CONVERGENCE TEST (hand-rolled, stdlib only)
#
# Invariant under test: regardless of the ORDER, DUPLICATION, or
# partial application of deltas, all replicas converge to the SAME value.
# This is the property that catches a non-associative / non-idempotent
# merge. A real suite would use Hypothesis to shrink failing seeds.
# --------------------------------------------------------------------------
def random_workload(seed: int, n_replicas: int = 3, n_ops: int = 200):
    rnd = random.Random(seed)
    replicas = [Replica(f"r{i}") for i in range(n_replicas)]
    universe = [f"e{k}" for k in range(10)]
    all_deltas: list = []

    for _ in range(n_ops):
        r = rnd.choice(replicas)
        op = rnd.choice(["inc", "add", "remove"])
        if op == "inc":
            r.increment(rnd.randint(1, 3))
        elif op == "add":
            r.add(rnd.choice(universe))
        else:
            r.remove(rnd.choice(universe))
        all_deltas.extend(r.drain_deltas())
    return replicas, all_deltas


def test_convergence(seed: int) -> None:
    replicas, deltas = random_workload(seed)

    # Apply the SAME delta multiset to every replica, but each in a
    # different shuffled order, WITH duplicates (idempotence) and a
    # re-application tail (re-delivery). Then assert all converge.
    for r in replicas:
        rnd = random.Random(seed ^ hash(r.actor))
        shuffled = list(deltas)
        rnd.shuffle(shuffled)
        shuffled += rnd.sample(deltas, k=len(deltas) // 4)  # duplicates
        r.apply(shuffled)

    # Bring all version vectors to the same frontier, then GC everywhere.
    merged_vv = VersionVector()
    for r in replicas:
        merged_vv = merged_vv.merge(r.vv)
    for r in replicas:
        r.vv = VersionVector(merged_vv)
        r.compact([r.vv for r in replicas])

    # ---- ASSERTIONS ----
    ref_count = replicas[0].counter.value()
    ref_set = replicas[0].orset.elements()
    for r in replicas[1:]:
        assert r.counter.value() == ref_count, (
            f"counter diverged: {r.actor} {r.counter.value()} != {ref_count}")
        assert r.orset.elements() == ref_set, (
            f"orset diverged: {r.actor} {r.orset.elements()} != {ref_set}")


def test_merge_laws(seed: int) -> None:
    """Commutativity, associativity, idempotence of merge."""
    rnd = random.Random(seed)

    def rand_counter():
        c = PNCounter()
        for _ in range(rnd.randint(0, 8)):
            c.inc[f"r{rnd.randint(0,3)}"] = rnd.randint(0, 20)
            c.dec[f"r{rnd.randint(0,3)}"] = rnd.randint(0, 20)
        return c

    a, b, c = rand_counter(), rand_counter(), rand_counter()
    assert a.merge(b).value() == b.merge(a).value()                 # commutative
    assert a.merge(b).merge(c).value() == a.merge(b.merge(c)).value()  # assoc
    assert a.merge(a).value() == a.value()                          # idempotent


if __name__ == "__main__":
    for s in range(500):       # 500 random seeds ~ a cheap property sweep
        test_convergence(s)
        test_merge_laws(s)
    print("OK: 500 seeds converged; merge laws hold.")
```

Run it:

```bash
$ python3 crdt_store.py
OK: 500 seeds converged; merge laws hold.
```

What this code is teaching by being shaped this way:

- **Actors are bounded** (`r0..rN`), and the comment says so loudly — that's the §3.3 lesson encoded.
- **Mutations return deltas** that go into a `delta_buffer` for interval gossip — that's §5.1.
- **GC only fires below the stable frontier** (`stable_frontier` = element-wise min over all VVs) — that's §4.2, and it will *not* collect anything if one replica's VV lags, which is the zombie-replica failure mode made visible in code.
- **The test exercises the actual risk:** reordering + duplication + re-delivery, then asserts identical observable values. That's the only kind of test that catches a broken merge.

In a real repo you'd swap the hand-rolled sweep for Hypothesis (`@given(st.lists(deltas()))` with shrinking), add deterministic-simulation harnessing of the network, and fuzz the `merge` entry point with malformed serialized states.

---

## 10. Capacity, sizing, SLOs, and rollout

### 10.1 Sizing math (do this before you ship, not after the OOM)

Per-object state for the common types (bytes are illustrative; measure your encoding):

| Type | State size formula | Driver |
|---|---|---|
| G-Counter / PN-Counter | `~ A × (id_bytes + 8)` | `A` = number of **actors** (must = replica count, not client count) |
| OR-Set | `~ (live_elems + tombstones) × (elem_bytes + dot_bytes)` | grows with **adds-ever** until GC |
| Sequence/Text CRDT (Yjs/Automerge) | `~ ops_ever × per_op_bytes` (before run-length/columnar compaction) | grows with **edit count**, not doc length |
| Version vector / DVV per key | `~ A × (id_bytes + 8) + dots × dot_bytes` | actor count + detached dots |

**Worked example — the actor-explosion trap, quantified.** A PN-Counter, `id_bytes ≈ 16` (UUID) + 8 + 8 bytes ≈ **32 B per actor**.

- *Correct design* — 9 replicas as actors: `9 × 32 B ≈ 288 B` per counter. A million counters ≈ **288 MB**. Fine.
- *Broken design* — actor per mobile session, 100k DAU, 30-day retention: `~3,000,000 actors × 32 B ≈ 96 MB per counter`. A *single* counter is 96 MB. A thousand of them is **96 GB**. Instant OOM. (And merge of two 96 MB counters is a multi-second operation.)

That four-orders-of-magnitude gap is the whole reason §3.3 exists.

**Worked example — OR-Set under churn.** 1,000 live elements, `elem_bytes ≈ 32`, `dot_bytes ≈ 24`. With healthy GC (stable frontier advancing): `~1,000 × 56 B ≈ 56 KB`. With **stalled GC** and 2M add/remove cycles before discovery: `~2,000,000 × 24 B ≈ 48 MB` of pure tombstones around a 56 KB live set — a **~850×** bloat factor. This is the §8.2 incident in numbers.

### 10.2 SLOs worth committing to

| SLO | Typical target | How it's bounded |
|---|---|---|
| **Convergence time** (write → all replicas reflect it) | p99 < a few seconds intra-region; seconds-to-low-minutes cross-region | delta gossip interval + replication lag; AAE for tail |
| **Read staleness** | bounded by convergence time; reads are *local* and always available | this is the CAP payoff — reads never block on coordination |
| **Max object state size** | hard cap (e.g., 1 MB) with alerting at 50% | GC health + actor bounding |
| **Merge latency** | p99 < tens of ms | keep state small (it's `O(state)`) |
| **Durability of acknowledged writes** | no loss after a write returns success | the CRDT guarantee — *if* you didn't pick LWW for a no-loss field |

### 10.3 Rollout guidance

1. **Start with the cheapest type that preserves intent.** Counter? PN-Counter. "Latest value, loss OK"? LWW-Register. Don't reach for OR-Set/sequence unless the product needs add-remove or ordered insert semantics.
2. **Bound your actors on day one.** Decide whether clients are actors (they almost never should be). Wire server-side actor IDs before launch — retrofitting is an incident.
3. **Ship GC and a stable-frontier metric from day one.** A CRDT system without working GC is a time bomb with a multi-week fuse. Alert on "tombstones rising while live size flat."
4. **Ship object-size and actor-count dashboards before the feature is GA**, with hard caps and alerts.
5. **Make replica eviction reliable.** A decommissioned node that stays in the membership pins the stable VV and silently disables GC. Test the eviction path.
6. **Canary with a Jepsen/DST suite** that injects partitions and clock skew; gate GA on "all replicas converge after heal, no acknowledged write lost."
7. **Socialize the conflict semantics with product/design** (add-wins vs remove-wins vs LWW). The §8.4 "it came back" ticket is a *product* surprise, not just an engineering one.
8. **Decide the alternative explicitly for every invariant** (§6.3). If any field needs global uniqueness/balance, route *that path* through coordination and document why.

---

## 11. Checklists

### 11.1 Design-review checklist

- [ ] Is a CRDT actually the right tool, or is this an LWW field / a consensus invariant in disguise? (§6)
- [ ] For every business invariant, confirmed a CRDT can't violate it under *some* merge interleaving — and routed those to coordination. (§6.3)
- [ ] Chosen the **weakest** type that preserves intent (cheapest metadata). (§10.3)
- [ ] Set conflict semantics from product requirements (add-wins/remove-wins/LWW), and documented them. (§8.4)
- [ ] Actor IDs are **bounded** to the replica set; clients are not actors. (§3.3)
- [ ] LWW fields use logical/HLC time, not raw wall clock; clock-skew refusal in place. (§8.1)

### 11.2 Pre-production checklist

- [ ] Delta propagation implemented (not full-state shipping). (§5.1)
- [ ] Anti-entropy (Merkle/AAE-style) implemented and rate-limited/off-peak. (§5.2)
- [ ] GC implemented and gated on the **stable frontier**; reclaim is provably safe. (§4.2)
- [ ] Reliable replica-eviction path tested (no zombie pinning the frontier). (§4.2, §8.2)
- [ ] Property tests: commutativity, associativity, idempotence, and reorder/duplicate convergence. (§7.1)
- [ ] Jepsen/DST partition + clock-skew suite passing; "converge after heal, no lost ack'd write." (§7.2–7.3)
- [ ] Merge entry point fuzzed against malformed serialized state. (§7.3)
- [ ] Sizing math done; max-object cap chosen; worst-case churn estimated. (§10.1)

### 11.3 Operational / on-call checklist

- [ ] Dashboards: state-size p50/p99/max, tombstone count, actor count, merge latency, convergence lag. (§7.4)
- [ ] Alert: tombstones/actors rising while live size flat → **GC stalled**, find the zombie replica.
- [ ] Alert: object size approaching the hard cap.
- [ ] Runbook: how to evict a dead replica and unstick the stable frontier.
- [ ] Runbook: how to force a coordinated compaction/absorb if metadata bloated.
- [ ] Runbook: clock-skew incident → identify the fast-clocked node, quarantine, reconcile LWW losses.

---

## 12. Cheat sheet

```text
TYPES (cheapest → richest metadata)
  LWW-Register   tiny     latest-value-wins, loses concurrent writes
  G-Counter      O(A)     increment-only; A = replica count ONLY
  PN-Counter     O(A)     inc + dec
  G-Set          O(adds)  add-only, no remove
  2P-Set         O(adds+removes)  remove is permanent (remove-wins)
  OR-Set         O(adds-ever until GC)  add-wins, concurrent re-add resurrects
  Sequence/Text  O(ops-ever until compaction)  ordered insert (Yjs/Automerge)

THE TWO INCIDENT FAMILIES
  1. Metadata growth  -> OOM, slow merges, slow rehydrate
       causes: actor explosion (clients as actors), stalled GC (zombie replica),
               churn-proportional tombstones
  2. Semantic mismatch -> "my delete came back", "my edit reverted"
       causes: add-wins surprise, wall-clock LWW loss

GC RULE
  Reclaim a tombstone/dot only when it is CAUSALLY STABLE
  = seen by EVERY replica = below min(all replica VVs).
  One zombie replica that never advances => GC stops fleet-wide.

BANDWIDTH RULE
  Ship DELTAS, not full state. Merkle/AAE for background divergence repair.

CHOOSE
  need global invariant (uniqueness, balance>=0)? -> CONSENSUS, not CRDT
  need writable-under-partition + no lost writes?  -> CRDT
  latest-value, loss OK?                           -> LWW
  server-centric real-time text editing?           -> OT (or sequence CRDT)

CRDTs GUARANTEE convergence, NOT correctness of a global predicate.
```

---

## 13. Summary

- **CRDTs are everywhere they belong and nowhere they don't.** Riak DT (counters/sets, Bet365-scale), Redis Enterprise CRDB (active-active geo), Akka Distributed Data (delta-CRDT toolkit), Automerge and Yjs (JSON/text editing), SoundCloud Roshi (LWW-set over Redis), Apple Notes-style sync, and publicly-discussed adoptions at TomTom/PayPal. Figma, DynamoDB global tables, and Cosmos DB are **LWW-with-arbitration** — adjacent, but not "set/counter CRDTs." Get that attribution right.
- **Convergence is the easy part; metadata is the expensive part.** State grows with *cluster size* (`O(actors)`) and especially with *churn* (`O(operations-ever)`), independent of the live value's size.
- **The actor-id explosion is the #1 self-inflicted CRDT outage:** never let ephemeral clients be actors. Bound actors to the replica set; route client writes as operations.
- **GC is gated on causal stability** (the min version vector across all replicas). It is mandatory, and a single zombie replica silently disables it fleet-wide.
- **Ship deltas, not full state; use Merkle/AAE for background repair.**
- **Choose deliberately.** CRDTs give availability without coordination and lose no concurrent writes — but they **cannot enforce a global invariant**. Uniqueness, non-negative balances, and "at most N" need coordination or escrow, not cleverness.
- **Test with properties and simulation, not examples.** Commutativity/associativity/idempotence as properties; Jepsen/DST for partitions and clocks; fuzz the merge. Watch state size, tombstone/actor count, merge latency, and convergence lag.
- The two incident families are **metadata growth** and **semantic mismatch** — everything in §8 is one or the other.

Continue: [State-based vs Operation-based CRDTs](../02-state-vs-operation-based-crdts/professional.md) · [Counters](../03-counters-g-pn/professional.md) · [Sets / OR-Set / LWW](../04-sets-or-set-lww/professional.md) · [Sequence/Text CRDTs](../05-sequences-and-text-crdts/professional.md). Other tiers: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [interview](interview.md).

---

## 14. Further reading

**Foundational papers**

- Marc Shapiro, Nuno Preguiça, Carlos Baquero, Marek Zawirski — *"Conflict-free Replicated Data Types"* (INRIA, 2011). The naming paper; CvRDT/CmRDT, the SEC theorem, the type catalog.
- Shapiro et al. — *"A comprehensive study of Convergent and Commutative Replicated Data Types"* (INRIA RR-7506, 2011). The long-form companion with proofs and the full type zoo.
- Paulo Sérgio Almeida, Ali Shoker, Carlos Baquero — *"Delta State Replicated Data Types"* (2016) and *"Efficient State-based CRDTs by Delta-Mutation"* (2014). The δ-CRDT / delta-interval anti-entropy basis for every production state-CRDT system.
- Nuno Preguiça et al. — *"Dotted Version Vectors"* / *"Scalable and Accurate Causality Tracking"* — why Riak uses DVVs to avoid sibling explosion.

**Production systems and engineering write-ups**

- **Riak DT** documentation and Basho engineering posts (Sean Cribbs, Russell Brown) on production CRDT data types and **Active Anti-Entropy**.
- **Redis Enterprise "CRDB" / Active-Active** whitepaper and docs (Redis Inc.) — type-by-type LWW-vs-CRDT design decisions in a commercial DB.
- **Akka Distributed Data** documentation (Lightbend) — a real delta-CRDT replicator over cluster gossip.
- **SoundCloud Roshi** README and announcement — LWW-element-set over Redis, with read-repair, as a service.
- Evan Wallace / Figma — *"How Figma's multiplayer technology works"* — the canonical "we did NOT use a textbook CRDT" case study; bespoke server-arbitrated LWW on a tree.
- Kevin Jahns — **Yjs** docs and talks (YATA, delete-set GC, state-vector sync); benchmarks vs other editors.

**Local-first / collaborative editing**

- Martin Kleppmann, Adam Wiggins, Peter van Hardenberg, Mark McGranaghan — *"Local-first software: you own your data, in spite of the cloud"* (Ink & Switch, 2019). The manifesto that frames *why* JSON CRDTs matter.
- Martin Kleppmann & Alastair Beresford — *"A Conflict-Free Replicated JSON Datatype"* (2017). The theory behind **Automerge**.
- Martin Kleppmann's Automerge talks and the "CRDTs: The Hard Parts" talk — the best public explanation of metadata cost, GC, and why it's *hard*, not magic.

**Testing and verification**

- Kyle Kingsbury (Aphyr) — **Jepsen** analyses (including Riak's CRDT behavior) and the *jepsen.io* knossos/maelstrom tooling.
- FoundationDB — talks on **deterministic simulation testing** ("Testing Distributed Systems w/ Deterministic Simulation"), the gold standard for replicated-data testing.
- The property-based-testing literature (QuickCheck / Hypothesis) for encoding commutativity/associativity/idempotence as machine-checked laws.
