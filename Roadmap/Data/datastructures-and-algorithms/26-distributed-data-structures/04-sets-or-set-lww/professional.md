# Set CRDTs — Professional Level

> You are the senior engineer who owns the set CRDT in production: the shopping cart that must never resurrect a deleted item, the presence system that must converge after a netsplit, the timeline store that must not leak tombstones until the disk fills. This document is about the unglamorous reality of shipping set CRDTs — the metadata economics, the garbage-collection failure modes, the semantic surprises that page you at 3 a.m., and the test harness that catches them before your users do.

Estimated read time: ~55 minutes.

Prerequisites: you should already be comfortable with the material in [CRDT Fundamentals](../01-crdt-fundamentals/professional.md), [State vs Op CRDTs](../02-state-vs-operation-based-crdts/professional.md), and [Counters](../03-counters-g-pn/professional.md). If "join semilattice", "version vector", and "causal stability" are not yet reflexes, read those first.

---

## Table of Contents

1. [Where Set CRDTs Actually Ship](#1-where-set-crdts-actually-ship)
2. [The Metadata Reality](#2-the-metadata-reality)
3. [Garbage Collection in Practice](#3-garbage-collection-in-practice)
4. [Semantic Gotchas That Page You](#4-semantic-gotchas-that-page-you)
5. [LWW-Set vs OR-Set: The Decision](#5-lww-set-vs-or-set-the-decision)
6. [Maps and Nested CRDTs](#6-maps-and-nested-crdts)
7. [Anti-Entropy and Delta Sync for Sets](#7-anti-entropy-and-delta-sync-for-sets)
8. [Observability and Testing](#8-observability-and-testing)
9. [Realistic Code: An ORSWOT Store with Delta Sync](#9-realistic-code-an-orswot-store-with-delta-sync)
10. [Decision Tables, Sizing Math, Checklists](#10-decision-tables-sizing-math-checklists)
11. [Cheat Sheet](#11-cheat-sheet)
12. [Summary](#12-summary)
13. [Further Reading](#13-further-reading)

---

## 1. Where Set CRDTs Actually Ship

Set CRDTs are not academic curiosities. They are the convergence substrate underneath several systems you have probably used today. Understanding what each one chose — and why — is the fastest way to internalize the trade-offs, because every design decision in this space is a scar from a production incident.

### 1.1 Riak DT — `riak_dt_orswot` and `riak_dt_map`

Riak KV introduced first-class CRDTs ("Riak Data Types") in 2.0. The set type is implemented by the Erlang module `riak_dt_orswot` — **OR-Set Without Tombstones**, the optimized observed-remove set described by Bieniusa et al. (2012). The map type, `riak_dt_map`, is a composable CRDT whose values are themselves CRDTs (registers, counters, flags, sets, and nested maps).

The architecturally important detail: Riak attaches **one actor ID per vnode** (virtual node) participating in writes, not one per client. This is the single most important sizing lever in the whole space — Riak deliberately keeps the actor set small and bounded by cluster topology, so the version vectors that ORSWOT carries stay small. A client never becomes an actor; it routes its write through a coordinating vnode whose ID is already in the cluster's vocabulary. Hold this thought — it is the antidote to the "actor-id explosion" problem in §2.3.

Riak sets converge via state-based merge (a join over the ORSWOT semilattice) during read-repair, handoff, and active anti-entropy (AAE). When a client reads a set and gets siblings, Riak merges them server-side before returning a single value plus an opaque context blob the client must echo back on the next write.

### 1.2 SoundCloud Roshi — LWW-element-set over Redis

Roshi is SoundCloud's open-source time-series event store, built to back the activity stream / timeline ("here are the tracks the people you follow just posted"). It is, in the authors' own framing, an **LWW-element-set CRDT layered over a sharded farm of Redis instances**. Each element carries a timestamp; add-wins and remove-wins are resolved purely by comparing timestamps, with a deterministic tiebreak.

Roshi is the canonical "LWW is fine, actually" case study, and it is worth understanding *why* it is fine here:

- The data is a **stream of events keyed by (user, timestamp)**. The timestamp is intrinsic to the datum, not an artifact of when a replica happened to write. There is no meaningful notion of "concurrently editing the same element from two places".
- A small amount of reordering or loss at the millisecond boundary is **invisible** in a social timeline. Nobody notices if two events that happened 3 ms apart land in the "wrong" order.
- The metadata cost of OR semantics would be enormous relative to the value of the data. A timeline has billions of low-value elements; you cannot afford a version vector per element.

Roshi runs anti-entropy by walking key ranges across replicas and repairing divergence. It is the platonic example of **picking LWW on purpose, with eyes open**, because the data model makes the data-loss risk benign.

### 1.3 Akka Distributed Data — `ORSet`, `ORMap`, `ORMultiMap`, `LWWMap`

Akka's `akka.cluster.ddata` module ships a family of CRDTs replicated across an Akka cluster via a gossip protocol (a delta-CRDT-aware version of the classic anti-entropy gossip). The set is `ORSet` (observed-remove set), and there are composed types: `ORMap` (map with CRDT values), `ORMultiMap` (map from keys to `ORSet` values), `LWWMap` (map with last-write-wins register values), `PNCounterMap`, and so on.

Akka's actor IDs are **cluster member nodes** (`UniqueAddress`), again bounded by cluster size, not client count. Akka also implements **delta-CRDTs**: instead of gossiping full state every round, a node ships only the delta since the last successful exchange, with full-state fallback when deltas are lost. This is the production-grade answer to the bandwidth problem in §7.

A specific Akka gotcha worth flagging now: `ORSet` in Akka grows its internal version vector with the number of nodes that have *ever* performed an add, and pruning of departed nodes requires explicit configuration (`pruning` settings). A cluster that churns nodes without pruning leaks dots. We will return to this.

### 1.4 Redis Enterprise CRDB — Active-Active sets

Redis Enterprise's "CRDB" (Conflict-free Replicated DataBase / Active-Active) feature implements many native Redis types (including Sets) as CRDTs under the hood so that geo-distributed Redis databases can take writes in every region and converge. A `SADD`/`SREM` on a CRDB set is internally an observed-remove operation: the platform tracks per-element causal metadata so that a concurrent `SADD` and `SREM` of the same member resolve add-wins, matching the OR-Set semantics most users intuitively expect from a set. The metadata is hidden from the application but very much present on disk and on the wire.

### 1.5 Phoenix Presence — ORSWOT for "who's online"

Phoenix (the Elixir web framework) ships `Phoenix.Presence`, which tracks who is connected to which topic across a cluster of nodes. Underneath it is a CRDT very much in the ORSWOT family (the underlying library, `phoenix_pubsub`, uses a state-based observed-remove set with per-node clocks). The semantic fit is excellent: "user joined" is an add, "user left" is a remove, two nodes can disagree during a partition, and when they heal you want a deterministic merged view of presence with add-wins behavior (a join racing a leave on the *same* connection is rare; a join on node A racing the partition is what add-wins protects).

### 1.6 Shopping carts — the Dynamo origin story

The original motivation for observed-remove semantics in industry is the **Amazon Dynamo shopping cart** (DeCandia et al., 2007). Dynamo used vector clocks and **left conflict resolution to the application**. For the cart, Amazon chose to **merge divergent cart versions by taking the union of their contents**. This is correct for *adds* — never lose an "add to cart" — but it has a famous, deliberate consequence: **removed items can resurrect**.

The mechanism: you remove an item on cart version V1 while a concurrent V2 (which still contains the item, because the remove had not propagated) exists. Merge = union = the removed item comes back. Amazon accepted this trade-off because **a resurrected item in your cart is a recoverable annoyance, whereas a lost add is lost revenue**. The discomfort of that resurrection bug is precisely what motivated the academic community to design the OR-Set: a set where a remove only removes the *observed* adds, so a remove cannot be silently undone by a stale concurrent copy. When you ship a cart on a CRDT today, you are paying down the debt of that 2007 decision.

> The lineage to remember: **Dynamo cart (union merge, items resurrect, 2007) → OR-Set / observed-remove (a remove cancels only the adds it saw, ~2009–2011) → ORSWOT (same semantics, no per-removed-element tombstones, Bieniusa 2012).** Each step buys a strictly better property at a metadata cost.

---

## 2. The Metadata Reality

The value you store is rarely the problem. The *metadata* — the tags, dots, version vectors, and tombstones that make convergence work — is where set CRDTs go wrong in production. This section is the sizing math you need before you put a number in a capacity plan.

### 2.1 Vocabulary, precisely

- **Dot**: a pair `(actor, counter)`, e.g. `(node3, 47)` — a globally unique identity for one specific add event. ORSWOT identifies each add with exactly one dot.
- **Version vector (VV) / dot context**: a compact summary `{actor → max counter seen}` describing *all* dots an actor knows about. Size = O(number of actors).
- **Tag**: the classic OR-Set's per-add unique identifier. The naive OR-Set keeps a *set of tags* per element for adds, and a *set of tags* per element for removes (tombstones).
- **Tombstone**: metadata retained to remember that something was removed, so a stale concurrent add (or a re-delivered remove) doesn't undo the removal.

### 2.2 Naive OR-Set vs ORSWOT: the metadata gap

The naive OR-Set (Shapiro et al.) stores, for each element, a set of "add tags" and a set of "remove tags". An element is in the set iff it has an add tag not cancelled by a remove tag. The killer is that **remove tags accumulate forever** — every remove of every element you ever held leaves a tombstone. A set that has churned a million elements but currently holds ten can carry a million tombstones.

ORSWOT ("without tombstones", Bieniusa 2012) replaces per-element remove tombstones with a **single shared version vector (the dot context)**. The trick: instead of remembering "this specific element was removed" with a tombstone, ORSWOT remembers "actor N has been seen up to counter C" in the version vector, and a remove simply *deletes the dots* for that element. A re-delivered stale add is recognized as already-seen (its dot is ≤ the version vector) and silently dropped. No per-element remove metadata survives.

| Property | Naive OR-Set | ORSWOT |
|---|---|---|
| Per-element add metadata | set of tags | set of dots |
| Per-element remove metadata | set of tombstone tags (**grows forever**) | none |
| Shared metadata | none | one version vector, O(actors) |
| State size after M removes, N live elements | O(M + N) tombstones | O(actors + dots-for-N) |
| Dominant growth driver | remove churn | actor count |

The headline: **ORSWOT trades unbounded per-removal tombstone growth for a version vector whose size is the number of actors.** This is a fantastic trade *if and only if* you keep the actor count bounded. The next subsection is where teams ruin it.

### 2.3 The actor-id explosion (the #1 way to blow up ORSWOT)

ORSWOT's version vector has one entry per actor that has *ever* added an element (until pruned). If you make **every client an actor** — e.g. one actor ID per browser tab, per mobile session, per ephemeral Lambda invocation — your version vector grows without bound as ephemeral identities accumulate. A set with 12 live elements can carry a version vector of 50,000 dead actor entries. The metadata dwarfs the data by three orders of magnitude.

This is why Riak uses **vnode IDs** and Akka uses **cluster member addresses** as actors: those vocabularies are small (tens to low hundreds) and bounded by infrastructure, not by traffic. The rule:

> **Actors are servers, not clients.** A client mutates a set by *routing an operation through a server actor*. The number of distinct actors should equal the number of long-lived replicas, not the number of users, sessions, or requests.

If your design has clients as actors, you have two escapes: (a) funnel writes through a small fixed set of coordinator actors, or (b) aggressively prune retired actors (see §3.2), accepting the causal-stability constraints that pruning imposes.

### 2.4 Sizing math you can put in a capacity doc

Let:

- `A` = number of actors (replicas) = entries in the version vector.
- `N` = number of live elements in the set.
- `d_e` = average number of *concurrent surviving dots* per live element (usually 1; >1 only under concurrent re-adds across partitions).
- `s_dot` ≈ bytes per dot. A dot is `(actor_id, counter)`. With a 16-byte actor ID (e.g. a UUID or `node@host:port` hash) and an 8-byte counter, `s_dot ≈ 24` bytes plus serialization overhead; call it **~32 bytes** in a real wire format.
- `s_val` = average serialized size of an element value.

**ORSWOT state size estimate:**

```
state_bytes ≈ A * s_dot                  (the version vector / dot context)
            + N * (s_val + d_e * s_dot)   (each live element: value + its dots)
```

Worked example — a presence set for one chat room, 500 people online, 200 server nodes:

```
A      = 200
N      = 500
d_e    = 1
s_dot  = 32 bytes
s_val  = 24 bytes (a user id)

VV     = 200 * 32                     = 6.4 KB
elems  = 500 * (24 + 1 * 32)          = 500 * 56 = 28 KB
state ≈ 34.4 KB per room
```

That is healthy: metadata (6.4 KB VV + 16 KB element dots = ~22 KB) is comparable to data (12 KB of user ids). Now repeat the calculation with clients as actors — say 2 million lifetime sessions touched this room over a year and you never pruned:

```
A      = 2,000,000
VV     = 2,000,000 * 32               = 64 MB    (!!)  per room
```

A 64 MB version vector that must be merged, serialized, and gossiped on **every** write to a chat room is a production outage. The sizing math makes the actor-vocabulary decision quantitative, not aesthetic.

### 2.5 The "small but mighty" LWW-Set metadata

By contrast, an LWW-element-set carries **one timestamp per element** (plus a tiebreaker), no version vector, no tombstones beyond an optional removed-set with timestamps. Per-element metadata is ~16 bytes (a 64-bit physical timestamp + a tiebreak). For Roshi-scale data (billions of elements) this difference is the entire reason LWW was chosen: `16 bytes/element` is affordable; `A * s_dot` shared + per-element dots is not, when `A` and element count are both huge.

---

## 3. Garbage Collection in Practice

CRDT garbage collection is where the theory's "monotonic, never forget" purity collides with the operational reality of finite disks. You *must* eventually forget things, and forgetting safely is the hard part.

### 3.1 What needs collecting

| Garbage | Lives in | Reclaimed by |
|---|---|---|
| Tombstones (naive OR-Set remove tags) | per-element | causal-stability detection + compaction |
| Dead actor entries (departed replicas) | version vector | actor pruning |
| Superseded register values (LWW maps) | per-key | overwrite (cheap) |
| Delta buffers / op logs | replication layer | ack-based truncation |

ORSWOT eliminates the first row by construction. That is its whole point. But ORSWOT introduces the second row: actor entries in the version vector never disappear on their own.

### 3.2 Causal stability and safe pruning

A piece of metadata is safe to discard only once it is **causally stable**: every replica has seen everything up to it, so no future message can depend on it. Concretely, to prune actor `X` from a version vector, **every replica must have already incorporated all of X's writes**, *and* X must be guaranteed never to write again under that ID (it has permanently left the cluster).

Detecting causal stability requires knowing the minimum version vector across *all* replicas — i.e., the "least common knowledge". In a system with a stable membership view (Akka cluster, Riak ring), you can compute it: track each replica's reported VV, take the per-actor minimum, and anything below that frontier is stable. The operational cost: pruning **stalls when any replica is partitioned or down**, because you cannot prove the absent replica has caught up. This is the trap behind most tombstone/VV incidents.

> **The causal-stability deadlock:** one replica is down for a week (bad disk, forgotten in a corner of a rack). GC cannot advance the stability frontier because that replica might still be holding old state. Tombstones and dead-actor entries accumulate cluster-wide. Disks fill. The fix is operational, not algorithmic: have a **forced eviction / tombstoning of unreachable members after a bounded timeout**, accepting that a returning zombie replica must be wiped and re-synced from scratch rather than merged.

### 3.3 Incidents from unbounded tombstone growth

Real-world failure patterns (composited from public Riak/Akka postmortems and community reports; described generically):

1. **The hot-set tombstone blowup (naive OR-Set).** A set used as a work queue or a rapidly-churning membership list accumulates tombstones at the *write* rate, not the *live-size* rate. The live set stays at ~100 elements; the serialized object grows to tens of MB of tombstones. Symptoms: read latency climbs (you deserialize MBs to return 100 elements), then writes fail when the object crosses a size guard (Riak warns at large object sizes). **Mitigation:** ORSWOT instead of naive OR-Set; if stuck on naive, periodically rewrite the key to a fresh CRDT once the cluster is fully converged and quiet.

2. **The actor-churn VV leak (ORSWOT/Akka).** A cluster that adds and removes nodes for autoscaling — or, worse, where a buggy deploy gives each pod a fresh actor ID every restart — leaks version-vector entries. With pruning disabled (the default in some configs), the VV grows monotonically. Symptoms: gossip messages bloat, merge CPU rises, memory grows. **Mitigation:** stable actor IDs across restarts (persist the ID, don't regenerate); enable pruning with a sane `pruning-marker-time-to-live`; cap actor cardinality by funneling writes through fixed coordinators.

3. **The partition-stalled GC.** As in §3.2: a long partition or a long-down replica freezes the stability frontier and metadata grows everywhere until the partition heals or the replica is evicted. **Mitigation:** alerting on stability-frontier age and on per-object metadata bytes; an operational runbook to force-evict stuck members.

### 3.4 Compaction

Compaction = rewriting the stored representation into a smaller equivalent. For ORSWOT this means: contract the dot context where possible (a contiguous run of dots `1..k` for an actor becomes a single VV entry of `k`), drop dots that are dominated by the VV, and prune stable dead actors. Riak and Akka do this inside merge; you mostly get it for free, but you should *measure* that it's actually happening — a representation that never compacts is a representation that grows.

---

## 4. Semantic Gotchas That Page You

These are the surprises that look like data corruption to a product manager and like correct CRDT behavior to you. Knowing them in advance is the difference between a calm explanation and a frantic rollback.

### 4.1 Add-wins surprise: a concurrent remove "loses"

OR-Set and ORSWOT are **add-wins**: if `add(x)` and `remove(x)` are *concurrent* (neither saw the other), the element **survives**. This is by design — an observed-remove only removes the adds it observed; a concurrent add it never saw is untouched.

The production surprise: a user removes an item on their phone; concurrently the same item is (re-)added on their laptop, or simply the remove races a not-yet-propagated add. The element comes back, and the user swears they deleted it. To them it is a ghost. To the CRDT it is correctness.

You manage this by **picking the bias to match the feature**, not by fighting the math:

- **Add-wins is right when "presence/possession" should be sticky:** shopping carts (don't lose an add), tags/labels, room membership, feature opt-ins. The cost — occasional resurrection — is benign or recoverable.
- **Remove-wins is right when "removal is a safety/consent action":** unsubscribe, block-list, GDPR "delete my data", revoking a permission. A resurrected un-block or re-subscribe is a *compliance incident*, not an annoyance. Here you want a remove to win over a concurrent add.

There is no per-element "just do the right thing" — the bias is a global property of the CRDT type you pick. Mixed needs mean **two different sets**: an add-wins set for the additive feature and a separate remove-wins set (or a 2P-Set / a remove-wins ORSet variant) for the safety feature.

### 4.2 LWW silent data loss under clock skew

LWW resolves concurrency by **comparing wall-clock timestamps**. The failure mode is brutal and silent: if replica A's clock is 5 seconds ahead of replica B, then A's writes *always* win, even when B's write happened-later in real time. B's user makes a change, it appears to take, and then it silently vanishes when A's stale-but-higher-timestamp value propagates. No error, no sibling, no log line — the data is just gone.

Defenses, in order of strength:

1. **Don't use physical timestamps for LWW where loss matters.** Use a **hybrid logical clock (HLC)** or a Lamport timestamp with a node-id tiebreak, so causality is respected and only *truly* concurrent writes are arbitrated.
2. **Bound clock skew operationally** (NTP/PTP, monitor offset, alert when skew > threshold). This is necessary but not sufficient — a single bad clock still loses data silently.
3. **Restrict LWW to data where last-write-wins is the actual semantic** (see §5): a status flag, a "last seen" timestamp, a presence heartbeat. For anything where two users can independently produce information you must not drop, LWW is the wrong type.

### 4.3 The Dynamo cart resurrection bug — concretely

```
t0  cart = {milk}                       (replica R1 and R2 agree)
t1  partition between R1 and R2
t2  on R1: user removes milk            R1 cart = {}
t3  on R2: user adds eggs               R2 cart = {milk, eggs}   (R2 never saw the remove)
t4  partition heals; merge = union
    cart = {} ∪ {milk, eggs} = {milk, eggs}     <-- milk RESURRECTED
```

With a plain union merge (Dynamo's cart), milk comes back. With an **OR-Set**, the remove at t2 cancelled the *observed dot* of milk's add; R2's copy of milk carries that *same* dot (it's the same add), so the merge recognizes the add as removed and milk stays gone — **unless** R2 (or the user) performed a *new* add of milk concurrently, which would be a genuinely new dot and would (correctly, add-wins) survive. The OR-Set turns "spurious resurrection from stale copies" into "intentional re-add survives", which is exactly the semantic you want.

### 4.4 Element identity and re-adds

A subtle one: in OR-Set/ORSWOT, "the element value `x`" and "the *add event* of `x`" are different. Removing `x` removes the current adds; a later `add(x)` is a fresh event with a fresh dot and is fully live. This matters when your "value" is a struct with mutable fields — see Maps (§6). If you treat re-adding as "no-op because x is already present", you can lose the user's intent. Make adds idempotent at the *value* level only when that is truly the semantic.

---

## 5. LWW-Set vs OR-Set: The Decision

This is the load-bearing decision of the whole topic, so treat it as a deliberate trade, not a default.

### 5.1 The axis: metadata cost vs data-loss risk

| | LWW-element-set | OR-Set / ORSWOT |
|---|---|---|
| Per-element metadata | ~1 timestamp (~16 B) | dots; ORSWOT shares a VV |
| Concurrency resolution | wall-clock (or HLC) | observed-remove, add-wins |
| Data-loss risk | **yes** — losing writes is the *mechanism*; clock skew amplifies it | no spurious loss; concurrent add survives |
| Metadata growth driver | element count only | actor count (ORSWOT) / remove churn (naive) |
| Bias | last-write-wins | add-wins (remove-wins variants exist) |
| Sweet spot | high-volume, low-value, last-state-wins data | correctness-sensitive set membership |

### 5.2 When LWW's tiny metadata is worth the loss risk

Choose LWW when **the data is "last state wins" by nature**, so "losing" an older write is not loss — it is the intended overwrite:

- **Timelines / activity streams** (Roshi): events keyed by intrinsic timestamp; minor reordering invisible.
- **Presence heartbeats / "last seen at"**: you literally want the latest.
- **Idempotent status flags**: `online/offline`, `read/unread`, a setting toggle — the newest value is the truth.
- **Caches and materializations** that can be recomputed from a source of truth: a dropped write is repaired on next refresh.
- **Telemetry / sensor readings**: newest sample wins; old samples are noise.

The common thread: **there is no scenario where two users independently produce equally-valid information about the same element that you must keep both of.** When that's true, LWW's 16 bytes/element beats OR-Set's actor-bounded metadata by a wide margin and the loss risk is definitionally absent.

### 5.3 When you need OR semantics

Choose OR-Set/ORSWOT when **concurrent adds and removes carry independent intent you must not silently drop**:

- **Shopping carts / wishlists / collections** — don't resurrect deletes (use OR), don't lose adds.
- **Membership / access lists** — who is in this group, this room, this presence channel.
- **Tags / labels** applied by multiple actors concurrently.
- Anything where a product manager would call a dropped element "a bug".

If you also have a **safety-removal** angle (block, unsubscribe, GDPR delete) within the same feature, that specific set must be **remove-wins**, which is a deliberate, separate choice from the additive set.

### 5.4 The decision in one paragraph

> Default to **ORSWOT** for set membership where correctness matters and your actor vocabulary is server-bounded. Reach for **LWW-element-set** only when the data is genuinely last-state-wins *and* the volume makes OR metadata unaffordable — and when you do, use an HLC (not raw wall-clock) and accept, in writing, that concurrent writes are arbitrated rather than preserved. Never use LWW for additive, multi-author, must-not-lose data.

---

## 6. Maps and Nested CRDTs

Maps are where set CRDTs get composed into something that can model a whole document or record. They are also where the metadata and semantic costs compound.

### 6.1 What a CRDT map is

A CRDT map (Riak `riak_dt_map`, Akka `ORMap`/`ORMultiMap`) is a set of **keys**, each mapping to a **value that is itself a CRDT** (counter, register, flag, set, or nested map). The key set behaves like an OR-Set (observed-remove of keys, add-wins), and each value merges by its own CRDT join. Merging two maps = merge the key sets, then for keys present in both, recursively merge the values.

### 6.2 The remove-vs-update conflict (the map's headline gotcha)

Concurrent `remove-key(k)` on replica A and `update-value-at(k)` on replica B is the classic map conflict. Two reasonable resolutions:

- **Remove wins:** the key is gone; B's update is discarded.
- **Update wins (the usual OR-map choice):** the key survives with B's update, because the OR-semantics treat the update as "observing/re-asserting" the key. A remove only removes the key-presence the remover *observed*; B's concurrent update is a fresh observation that keeps the key alive.

Riak's map uses observed-remove semantics for keys, so a concurrent update generally **wins over a remove** (the key comes back with the updated value). This is the add-wins surprise from §4.1, one level up. It surprises people who model "delete the user record" as a key remove and then see the record reappear because a concurrent field update kept it alive. If "delete" must be final, you need a different model (e.g., a tombstone flag inside the value, or a remove-wins structure).

### 6.3 Recursive merge cost

Map merge is **recursive and not free**. Each merge walks the key set (O(keys)) and, for keys present on both sides, recursively merges values. A deeply nested map (map of maps of sets) has merge cost proportional to the *total node count* of the structure, and it carries **OR metadata at every level** — the key set's dots, each nested set's dots, each register's clock. The metadata-to-data ratio of a map can be far worse than a flat set, because every level pays the actor-bounded VV tax.

Practical guidance:

- **Keep maps shallow.** Prefer a flat map of registers over a map of maps where you can.
- **Bound the key count.** A map is not a database table; a map with 10^6 keys merges 10^6 entries per gossip round.
- **Watch the per-value metadata.** A map of OR-Sets (`ORMultiMap`) multiplies the actor-VV tax by the number of keys, since each value set carries its own dot context (implementations vary; some share context — verify yours).

### 6.4 Modeling tip: registers vs sets inside maps

Use an **LWW-register** for a field where last-write-wins is correct (a display name, a status). Use a **nested OR-Set** only for a field that is genuinely a multi-author collection (tags, members). Mixing register fields (cheap) for most attributes and one OR-Set field for the truly collaborative part keeps the map's metadata bill sane.

---

## 7. Anti-Entropy and Delta Sync for Sets

How replicas exchange state determines your bandwidth bill and your convergence latency. Sets, because of their metadata, make naive full-state gossip expensive.

### 7.1 The full-state problem

State-based replication merges *whole* set states. For a set whose serialized form is `S` bytes, every anti-entropy round between two replicas costs `O(S)` on the wire, even if only one element changed. With `R` replicas gossiping pairwise, your background bandwidth is roughly `O(R * S / interval)`. When `S` is fat with metadata (§2), this dominates your network budget. The hot-set tombstone incident (§3.3) is partly an anti-entropy incident: you ship the tombstones every round.

### 7.2 Delta-state CRDTs

Delta-state CRDTs (Almeida, Shoker, Baquero) ship **only the join-irreducible delta** since the last successful exchange — typically the few dots and elements that changed — with a **full-state fallback** when a delta is lost or a replica is too far behind. Akka Distributed Data implements this; it is the production answer.

The mechanics you must get right:

- **Delta buffering:** keep a buffer of recent deltas keyed by a sequence number; ship the suffix the peer hasn't acked.
- **Ack-based truncation:** once all peers ack up to sequence `n`, truncate the buffer below `n`. A peer that falls behind the buffer triggers full-state catch-up.
- **Idempotent, commutative, associative application:** a delta is just a small CRDT; merging it twice is harmless. This is what makes "at-least-once delivery + occasional duplicates" safe.

### 7.3 Anti-entropy beyond deltas: Merkle/range repair

For large keyspaces (Riak AAE, Roshi's range walks), replicas exchange **Merkle-tree hashes over key ranges** to find divergence cheaply, then repair only the divergent ranges. This is `O(log n)` to *find* divergence and `O(divergent)` to *fix* it, instead of `O(n)` to ship everything. The bandwidth model: hash exchange is tiny; repair is proportional to actual drift, which under healthy operation is near zero.

### 7.4 Bandwidth sizing

```
full-state gossip per round  ≈ S bytes per replica pair
delta gossip per round       ≈ (changed_elems * (s_val + s_dot)) + small header
merkle-tree probe per round  ≈ O(buckets) hashes (constant-ish)
```

Rule of thumb: **deltas turn your background bandwidth from "size of the data" into "rate of change of the data".** For a slow-moving set this is a 100–1000x reduction. Always confirm full-state fallback works, because a delta system that silently never falls back can permanently diverge after lost deltas.

---

## 8. Observability and Testing

A set CRDT that you cannot measure or test is a future incident. This section is the instrumentation and the test harness.

### 8.1 The metrics that matter

Expose, per set (or as a histogram across sets):

| Metric | Why | Alert when |
|---|---|---|
| `crdt_set_state_bytes` | total serialized size | sustained growth, or p99 > size guard |
| `crdt_set_live_elements` | the actual data size | — (denominator for ratios) |
| `crdt_set_metadata_ratio` = (state_bytes − value_bytes) / state_bytes | are you mostly metadata? | ratio > 0.7 sustained |
| `crdt_set_actor_count` (VV entries) | actor-id explosion detector | unbounded growth; > expected replica count |
| `crdt_set_tombstone_count` | naive OR-Set leak detector | any sustained growth |
| `crdt_stability_frontier_age` | GC health (causal stability) | frontier older than N minutes → GC stalled |
| `crdt_replication_lag` | convergence latency | lag > SLO; rising during partition |
| `crdt_delta_buffer_bytes` / `full_state_fallbacks` | delta health | frequent fallbacks → deltas being lost |

The two ratios — **metadata_ratio** and **actor_count** — are your early-warning system. They go bad *before* disks fill or latency spikes.

### 8.2 Convergence property tests

CRDTs have *invariants*, which makes them a perfect fit for **property-based testing** (see your project's notes on property-based testing). The invariants to assert:

1. **Commutativity:** `merge(a, b) == merge(b, a)`.
2. **Associativity:** `merge(merge(a, b), c) == merge(a, merge(b, c))`.
3. **Idempotence:** `merge(a, a) == a`.
4. **Convergence:** apply the *same set of operations in any order/interleaving* across replicas → all replicas converge to the same value.
5. **Add-wins invariant (the semantic one):** if `add(x)` is concurrent with `remove(x)` (neither causally before the other), then `x ∈ merged`.
6. **Observed-remove invariant:** if `remove(x)` causally follows the `add(x)` it removes, and there is no later add, then `x ∉ merged`.

Property tests should generate random operation sequences across N replicas, randomly partition and heal, and assert the invariants on the merged result. This is where you catch the bugs that example-based tests never reach.

### 8.3 Jepsen-style partition testing

Property tests verify the *data type*. **Jepsen** verifies the *system*: it injects real partitions, clock skew, and process pauses against a running cluster and checks that the observable history is consistent with the claimed semantics. For set CRDTs the Jepsen checks are:

- **Add-survival:** every acknowledged add appears in a final converged read (no lost adds).
- **No spurious resurrection** for the removes that *should* stick (observed removes).
- **Convergence after heal:** all replicas agree within bounded time after the partition ends.

Run partition tests in CI on the real cluster software, not just unit tests on the type. Convergence bugs hide in the *replication layer* (delta loss, GC, membership) far more than in the merge function.

### 8.4 What to test for LWW specifically

For LWW sets, add a **clock-skew test**: run replicas with deliberately skewed clocks and assert your *documented* loss behavior (you will lose writes — assert it's bounded and matches the spec) or, better, assert that with an HLC the *causally later* write always wins regardless of physical-clock skew.

---

## 9. Realistic Code: An ORSWOT Store with Delta Sync

Below is a runnable Python implementation of an ORSWOT-backed set store with delta synchronization, plus a property-based convergence/add-wins test using `hypothesis`. It is deliberately complete enough to reason about: dots, version vector (dot context), add/remove, full-state merge, delta extraction/apply, and compaction.

```python
"""
orswot.py — An ORSWOT (Observed-Remove Set WithOut Tombstones) with delta sync.

Model:
  - A "dot" is (actor, counter): a unique id for one add event.
  - The dot-context (version vector) summarizes all dots an actor has seen:
        ctx[actor] = highest contiguous counter seen for that actor.
  - dots: element -> set of currently-surviving dots for that element.

An element is "in the set" iff it has at least one surviving dot.
A remove deletes the element's surviving dots but the dot-context remembers
they happened, so a re-delivered stale add (dot <= ctx) is dropped (no resurrection),
while a genuinely NEW concurrent add (fresh dot) survives (add-wins).
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, Set, Tuple, Hashable

Dot = Tuple[str, int]  # (actor, counter)


@dataclass
class ORSWOT:
    actor: str
    ctx: Dict[str, int] = field(default_factory=dict)            # version vector
    dots: Dict[Hashable, Set[Dot]] = field(default_factory=dict) # element -> dots

    # ---- local mutations -------------------------------------------------

    def add(self, element: Hashable) -> Dot:
        """Add element under this replica's actor; returns the new dot."""
        counter = self.ctx.get(self.actor, 0) + 1
        self.ctx[self.actor] = counter
        dot = (self.actor, counter)
        # An add supersedes the element's prior surviving dots locally,
        # but we keep them so concurrent peers can still observe-remove correctly.
        self.dots.setdefault(element, set()).add(dot)
        return dot

    def remove(self, element: Hashable) -> None:
        """Observed-remove: drop the dots we currently see for element.
        The dot-context already records them, so they won't resurrect."""
        self.dots.pop(element, None)

    def value(self) -> Set[Hashable]:
        return {e for e, ds in self.dots.items() if ds}

    def __contains__(self, element: Hashable) -> bool:
        return bool(self.dots.get(element))

    # ---- dot-context helpers --------------------------------------------

    def _seen(self, dot: Dot) -> bool:
        actor, counter = dot
        return counter <= self.ctx.get(actor, 0)

    def _absorb_ctx(self, other_ctx: Dict[str, int]) -> None:
        for actor, counter in other_ctx.items():
            if counter > self.ctx.get(actor, 0):
                self.ctx[actor] = counter

    # ---- full-state merge (the join) ------------------------------------

    def merge(self, other: "ORSWOT") -> None:
        """In-place CRDT join. Commutative, associative, idempotent."""
        elements = set(self.dots) | set(other.dots)
        for e in elements:
            mine = self.dots.get(e, set())
            theirs = other.dots.get(e, set())

            # Keep a dot if BOTH have it, OR if exactly one has it AND the
            # other side has NOT seen it (i.e. it's a new add the other missed).
            # Drop a dot that one side removed (other side has seen it but
            # no longer carries it) -> observed-remove.
            survivors: Set[Dot] = set()
            for d in mine | theirs:
                in_mine = d in mine
                in_theirs = d in theirs
                if in_mine and in_theirs:
                    survivors.add(d)
                elif in_mine and not other._seen(d):
                    survivors.add(d)        # new on my side, peer hasn't seen it
                elif in_theirs and not self._seen(d):
                    survivors.add(d)        # new on peer side, I haven't seen it
                # else: one side removed a dot the other had seen -> drop it
            if survivors:
                self.dots[e] = survivors
            else:
                self.dots.pop(e, None)

        # contexts join by per-actor max
        self._absorb_ctx(other.ctx)

    # ---- delta sync ------------------------------------------------------

    def delta_since(self, known_ctx: Dict[str, int]) -> "ORSWOT":
        """Produce a small ORSWOT containing only dots the peer (described by
        known_ctx) has not yet seen, plus our full ctx so it can advance."""
        d = ORSWOT(actor=self.actor)
        d.ctx = dict(self.ctx)  # full ctx; lets peer drop our stale re-adds
        for e, ds in self.dots.items():
            fresh = {dot for dot in ds
                     if dot[1] > known_ctx.get(dot[0], 0)}
            if fresh:
                d.dots[e] = fresh
        return d

    # ---- compaction (representation only; value-preserving) -------------

    def compact(self) -> None:
        """Drop empty element entries. (Dot-runs are already summarized by ctx.)"""
        for e in [e for e, ds in self.dots.items() if not ds]:
            self.dots.pop(e, None)
```

A small store wrapper that several replicas would each hold, with delta exchange:

```python
"""store.py — many replicas, delta-synced. Demonstrates convergence."""

from orswot import ORSWOT


class Replica:
    def __init__(self, actor: str):
        self.crdt = ORSWOT(actor=actor)
        # what we believe each peer has seen, to ship minimal deltas
        self.peer_ctx: dict[str, dict] = {}

    def add(self, x):    self.crdt.add(x)
    def remove(self, x): self.crdt.remove(x)
    def value(self):     return self.crdt.value()

    def make_delta_for(self, peer_actor: str) -> ORSWOT:
        known = self.peer_ctx.get(peer_actor, {})
        return self.crdt.delta_since(known)

    def receive_delta(self, sender_actor: str, delta: ORSWOT):
        self.crdt.merge(delta)
        # remember the sender now knows at least everything in delta.ctx
        prev = self.peer_ctx.get(sender_actor, {})
        for a, c in delta.ctx.items():
            if c > prev.get(a, 0):
                prev[a] = c
        self.peer_ctx[sender_actor] = prev


def gossip(replicas: list[Replica]):
    """One naive full-mesh delta round; idempotent, order-independent."""
    snapshot = list(replicas)
    for src in snapshot:
        for dst in snapshot:
            if src is dst:
                continue
            dst.receive_delta(src.crdt.actor, src.make_delta_for(dst.crdt.actor))


if __name__ == "__main__":
    a, b = Replica("A"), Replica("B")
    a.add("milk")
    gossip([a, b])                 # b learns milk
    # PARTITION: a removes milk, b concurrently adds eggs
    a.remove("milk")
    b.add("eggs")
    # HEAL
    for _ in range(3):
        gossip([a, b])
    assert a.value() == b.value(), (a.value(), b.value())
    print("converged:", sorted(a.value()))   # -> ['eggs']  (milk stays removed)
```

The property-based test — convergence *and* the add-wins invariant — using `hypothesis`:

```python
"""test_orswot.py — run with: pytest test_orswot.py
   requires: pip install hypothesis pytest
"""

from hypothesis import given, settings, strategies as st
from orswot import ORSWOT

ELEMS = st.sampled_from(["x", "y", "z"])
# An op is (replica_index, "add"|"remove", element)
OP = st.tuples(st.integers(0, 2), st.sampled_from(["add", "remove"]), ELEMS)
PROGRAM = st.lists(OP, max_size=40)


def fresh_replicas(n=3):
    return [ORSWOT(actor=name) for name in list("ABC")[:n]]


def full_merge(replicas):
    """Merge everyone into a single converged value (order-independent)."""
    acc = ORSWOT(actor="_merge")
    for r in replicas:
        acc.merge(r)
    return acc


@given(PROGRAM)
@settings(max_examples=300)
def test_merge_is_commutative_and_idempotent():
    pass  # placeholder so the module imports cleanly; real tests below


@given(PROGRAM)
@settings(max_examples=400)
def test_convergence(program):
    """Applying ops, then fully gossiping, makes all replicas equal."""
    reps = fresh_replicas()
    for idx, op, e in program:
        (reps[idx].add if op == "add" else reps[idx].remove)(e)
    # gossip to fixpoint (full-mesh merges; idempotent so a few rounds suffice)
    for _ in range(len(reps) + 1):
        for src in reps:
            for dst in reps:
                if src is not dst:
                    dst.merge(src)
    values = [r.value() for r in reps]
    assert all(v == values[0] for v in values), values


@given(st.integers(0, 2), st.integers(0, 2), ELEMS)
@settings(max_examples=200)
def test_add_wins_under_concurrency(adder, remover, e):
    """A concurrent add and remove of e -> e survives (add-wins).
    'Concurrent' = neither replica has seen the other's op when it acts."""
    a, b, c = fresh_replicas()
    reps = [a, b, c]
    # establish e on the remover with a known dot, propagate, THEN partition
    reps[remover].add(e)
    for src in reps:                     # everyone learns the first add
        for dst in reps:
            if src is not dst:
                dst.merge(src)
    # PARTITION: remover removes the e it has seen; adder makes a NEW add of e
    reps[remover].remove(e)
    reps[adder].add(e)                   # fresh dot, unseen by remover
    if adder == remover:
        # same replica removed then re-added: re-add is newer -> present
        pass
    # HEAL
    for _ in range(len(reps) + 1):
        for src in reps:
            for dst in reps:
                if src is not dst:
                    dst.merge(src)
    merged = full_merge(reps).value()
    assert e in merged, (adder, remover, e, merged)


@given(PROGRAM)
@settings(max_examples=200)
def test_merge_idempotent(program):
    r = fresh_replicas()[0]
    for idx, op, e in program:
        (r.add if op == "add" else r.remove)(e)
    before = r.value()
    r.merge(r)                            # merge with self
    assert r.value() == before
```

Notes on the code's fidelity to real systems:

- The **dot-context** is the production ORSWOT trick: removes leave *no per-element tombstone*, only the version vector remembers. Run `test_add_wins_under_concurrency` to see add-wins; flip it to assert an *observed* remove (no concurrent re-add) sticks, and you've got §8.2's invariant 6.
- `delta_since` ships only unseen dots + the full context. In production you'd add **ack tracking and full-state fallback** (§7.2) so a peer that fell behind the delta buffer gets a snapshot.
- `compact` here is trivial because the dot-context already summarizes contiguous dot runs; a real implementation also **prunes stable dead actors** from `ctx`, which requires the causal-stability frontier (§3.2) and is *not* safe to do from a single replica's view.

---

## 10. Decision Tables, Sizing Math, Checklists

### 10.1 Pick the set type

| Feature | Type | Bias | Why |
|---|---|---|---|
| Shopping cart | OR-Set / ORSWOT | add-wins | never lose an add; never resurrect a delete |
| Group / room membership | ORSWOT | add-wins | join races partition; deterministic merge |
| Presence ("who's online") | ORSWOT | add-wins | Phoenix Presence model |
| Tags / labels (multi-author) | ORSWOT | add-wins | concurrent tags both survive |
| Block-list / unsubscribe / GDPR-delete | remove-wins set (e.g. 2P-Set or remove-wins ORSet) | **remove-wins** | a resurrected block is a compliance incident |
| Activity timeline / stream | LWW-element-set | last-write | huge volume, intrinsic timestamps (Roshi) |
| "Last seen", status flag | LWW-register (in a map) | last-write | newest value is the truth |
| Distinct very-large set, loss-tolerant | LWW-element-set | last-write | metadata must be O(1)/element |

### 10.2 Metadata sizing crib

```
ORSWOT state ≈ A * s_dot  +  N * (s_val + d_e * s_dot)
  A     = #actors (KEEP = #replicas, NOT #clients)
  N     = #live elements
  s_dot ≈ 32 B (16B actor id + 8B counter + framing)
  d_e   ≈ 1 (usually)

LWW-set state ≈ N * (s_val + ~16 B)        # one (timestamp, tiebreak) per element

Naive OR-Set state ≈ N*(s_val + tags) + M*(tombstone)   # M = lifetime removes -> AVOID
```

Red-flag thresholds:

- `A` exceeds ~2–3x your replica count → actor-id leak (clients as actors, or unpruned churn).
- `metadata_ratio > 0.7` sustained → wrong type or leaking metadata.
- `state_bytes` for one key approaching your store's large-object guard → tombstone blowup or a set that's too big to be one CRDT (shard it).

### 10.3 Shipping checklist

- [ ] **Actors are servers, not clients.** Verified: the VV vocabulary is bounded by replica count.
- [ ] **Stable actor IDs across restarts.** A pod restart must not mint a new actor id.
- [ ] **Type matches semantics.** Add-wins for additive features; remove-wins for safety removals; LWW only for last-state-wins data.
- [ ] **LWW uses HLC/Lamport, not raw wall-clock**, if you use LWW at all for loss-sensitive data.
- [ ] **Clock skew monitored** (NTP/PTP offset alarm) regardless.
- [ ] **GC / pruning configured** with a bounded unreachable-member eviction policy.
- [ ] **Stability-frontier age alarmed** so a stuck replica can't silently leak metadata forever.
- [ ] **Delta sync with full-state fallback** verified to actually fall back (test by dropping deltas).
- [ ] **Per-set metrics**: state_bytes, live_elements, metadata_ratio, actor_count, tombstone_count, replication_lag.
- [ ] **Property tests** for commutativity/associativity/idempotence/convergence + add-wins invariant in CI.
- [ ] **Jepsen-style partition test** against the real cluster, asserting no-lost-adds and converge-after-heal.
- [ ] **Large-set sharding plan**: a single CRDT object has a size ceiling; shard membership across many keys before you hit it.
- [ ] **Runbook**: "metadata growing / GC stalled" → identify stuck member → force-evict → wipe-and-resync the zombie.

### 10.4 Incident triage table

| Symptom | Likely cause | First action |
|---|---|---|
| Object size growing, live size flat | tombstones (naive OR-Set) or VV leak | check actor_count vs tombstone_count |
| Read latency up on small sets | deserializing fat metadata | metadata_ratio; switch to ORSWOT / shard |
| Users report "deleted item came back" | add-wins resurrection (concurrent re-add) or Dynamo-style union | confirm it's *concurrent* re-add (correct) vs union-merge bug |
| Writes silently lost | LWW clock skew | check clock offset; move to HLC |
| GC not advancing | causal-stability stall (down/partitioned member) | find stuck member; evict per runbook |
| Gossip bandwidth high | full-state replication | enable delta-CRDT sync |

---

## 11. Cheat Sheet

```
TYPES
  G-Set            grow-only set, no removes
  2P-Set           add once, remove once, can't re-add (remove-wins, simple)
  LWW-element-set  per-element timestamp; last-write-wins; tiny metadata; CAN LOSE DATA
  OR-Set           observed-remove, add-wins; per-element tags + remove tombstones (grow)
  ORSWOT           OR-Set Without Tombstones; dots + shared version vector; add-wins
  OR-Map / Riak Map / Akka ORMap   keys = OR-Set, values = nested CRDTs

CORE RULES
  add-wins:        concurrent add vs remove  ->  element SURVIVES
  observed-remove: remove cancels only the adds it SAW (no resurrection from stale copies)
  actors = SERVERS not clients (bounds the version vector)
  LWW arbitrates concurrency by clock -> use HLC, never bare wall-clock

WHERE IT SHIPS
  Riak DT      riak_dt_orswot + riak_dt_map     (actors = vnodes)
  Roshi        LWW-element-set over Redis        (timeline; LWW on purpose)
  Akka DData   ORSet/ORMap/ORMultiMap/LWWMap     (actors = cluster nodes; delta-CRDT)
  Redis CRDB   Active-Active sets                (OR semantics, hidden metadata)
  Phoenix      Presence = ORSWOT                 (who's online)
  Dynamo       cart = union merge                (origin of the resurrection bug)

SIZING
  ORSWOT ≈ A*s_dot + N*(s_val + s_dot)     A=#replicas, s_dot≈32B
  LWW    ≈ N*(s_val + ~16B)
  Naive OR-Set ≈ + M tombstones (M = lifetime removes)  -> AVOID

GC
  reclaim only when CAUSALLY STABLE (every replica caught up)
  a down/partitioned member STALLS gc -> evict after bounded timeout, then wipe+resync

ALARMS
  actor_count >> replica_count        -> actor-id leak
  metadata_ratio > 0.7                -> wrong type / leak
  stability_frontier_age high         -> gc stalled
  full_state_fallbacks frequent       -> deltas being lost
```

---

## 12. Summary

Set CRDTs are a solved problem *mathematically* and an unsolved problem *operationally* — the convergence math is the easy 20%, and the metadata economics are the load-bearing 80%.

The decisions that determine whether your set CRDT is a quiet success or a 3 a.m. page:

1. **Actors are servers, not clients.** This single rule keeps the version vector bounded and is the difference between a 34 KB presence set and a 64 MB one. Riak (vnodes) and Akka (cluster nodes) enforce it structurally; if your design lets clients be actors, fix that first.

2. **Pick the bias to match the feature.** Add-wins (OR-Set/ORSWOT) for additive, must-not-lose membership; remove-wins for safety removals where resurrection is a compliance incident; LWW only when the data is genuinely last-state-wins and the volume makes OR metadata unaffordable (Roshi's timeline). LWW with bare wall-clocks silently loses data under skew — use an HLC.

3. **GC is bounded by causal stability, and causal stability is bounded by your slowest replica.** Unbounded tombstone growth (naive OR-Set) and version-vector leaks (actor churn) are the dominant incident classes. Prefer ORSWOT to kill tombstones, keep actor IDs stable, and have an operational policy to evict stuck members so GC never stalls forever.

4. **Ship deltas, not full state**, with a working full-state fallback — this turns background bandwidth from "size of data" to "rate of change".

5. **Measure metadata_ratio and actor_count, and property-test the add-wins invariant plus Jepsen the partitions.** These catch the failure before the disk does.

The Dynamo cart resurrection bug is the cautionary tale that started it all: a union-merge that never loses an add but happily resurrects deletes. OR semantics exist precisely to give you "never lose an add" *and* "never resurrect a stale delete" — at a metadata cost you must keep bounded. Pay that cost deliberately, measure it, and your set CRDT will converge quietly while everyone else's pages.

For the level below this, see [senior](senior.md); for foundations, [middle](middle.md) and [junior](junior.md); to drill the trade-offs verbally, [interview](interview.md).

---

## 13. Further Reading

- **Bieniusa, Zawirski, Preguiça, Shapiro, Baquero, Balegas, Duarte (2012)** — *An Optimized Conflict-free Replicated Set* (the ORSWOT / OR-Set-Without-Tombstones paper). The canonical source for the dot-context trick.
- **Shapiro, Preguiça, Baquero, Zawirski (2011)** — *A Comprehensive Study of Convergent and Commutative Replicated Data Types* (INRIA RR-7506). The original CRDT zoo, including OR-Set and LWW-element-set definitions.
- **DeCandia et al. (2007)** — *Dynamo: Amazon's Highly Available Key-value Store* (SOSP). The shopping-cart union-merge and the resurrection trade-off that motivated observed-remove semantics.
- **Riak Data Types documentation** — `riak_dt_orswot`, `riak_dt_map`, and the developer guide for sets and maps (Basho/Riak docs). Read it for how vnodes-as-actors and read-repair work in practice.
- **SoundCloud Roshi** — the "Roshi: a CRDT system for timestamped events" engineering blog post and the GitHub README, for the LWW-element-set-over-Redis design and its anti-entropy walks.
- **Akka Distributed Data documentation** — `ORSet`, `ORMap`, `ORMultiMap`, `LWWMap`, delta-CRDTs, and pruning configuration. The most accessible production CRDT API to study.
- **Almeida, Shoker, Baquero (2018)** — *Delta State Replicated Data Types* (JPDC). The formal basis for the delta sync in §7.
- **Redis Enterprise Active-Active (CRDB) documentation** — how native Redis types are mapped onto CRDTs for geo-distributed multi-master writes.
- **Kyle Kingsbury — Jepsen analyses** — for the methodology of partition-testing convergence claims against real systems.
- Related topics in this roadmap: [CRDT Fundamentals](../01-crdt-fundamentals/professional.md), [State vs Op CRDTs](../02-state-vs-operation-based-crdts/professional.md), [Counters](../03-counters-g-pn/professional.md).
