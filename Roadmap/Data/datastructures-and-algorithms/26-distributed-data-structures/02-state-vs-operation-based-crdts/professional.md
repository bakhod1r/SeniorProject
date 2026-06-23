# State-based vs Operation-based CRDTs — Professional Level

> You are operating a replicated system in production and have to choose — or live with — a replication model. The math behind state-based, operation-based, and delta-state CRDTs is the easy part. The hard part is the bandwidth bill, the causal-broadcast layer you now have to run on-call, the op log that grows until disk fills at 3 a.m., and the Jepsen run that finds the convergence bug your unit tests missed. This document is about those realities: which model real systems actually pick, what each one costs to run, and how to instrument and test it so convergence is a property you can prove rather than a hope.

---

## Table of Contents

1. [Framing: the choice is operational, not theoretical](#1-framing-the-choice-is-operational-not-theoretical)
2. [What real systems pick — and why](#2-what-real-systems-pick--and-why)
3. [Bandwidth economics: state vs op vs delta](#3-bandwidth-economics-state-vs-op-vs-delta)
4. [The delivery-infrastructure tax of op-based](#4-the-delivery-infrastructure-tax-of-op-based)
5. [Dedup, idempotency, and the exactly-once myth](#5-dedup-idempotency-and-the-exactly-once-myth)
6. [GC and compaction: op logs, delta buffers, causal stability](#6-gc-and-compaction-op-logs-delta-buffers-causal-stability)
7. [Anti-entropy: Merkle diffing, hash exchange, read-repair](#7-anti-entropy-merkle-diffing-hash-exchange-read-repair)
8. [Decision guide: picking a model by workload](#8-decision-guide-picking-a-model-by-workload)
9. [Observability and testing](#9-observability-and-testing)
10. [Code: a delta-state store with Merkle anti-entropy + convergence tests](#10-code-a-delta-state-store-with-merkle-anti-entropy--convergence-tests)
11. [Checklists](#11-checklists)
12. [Cheat sheet](#12-cheat-sheet)
13. [Summary](#13-summary)
14. [Further reading](#14-further-reading)

---

## 1. Framing: the choice is operational, not theoretical

Both families are provably correct. A state-based (convergent, CvRDT) replica ships its whole state and merges with a join (least-upper-bound on a semilattice); merge is commutative, associative, and idempotent, so the order and multiplicity of merges does not matter. An operation-based (commutative, CmRDT) replica ships individual operations; operations commute, so applying them in any order yields the same result — **provided** every operation is delivered exactly once and in causal order.

That last clause is the entire story. The difference between the two families is not "which converges" — both do — it is **what the network and your operators must guarantee for convergence to hold**:

| Family | Convergence requires | You must run | Resends are |
|---|---|---|---|
| State-based (CvRDT) | merge is a join over a semilattice | *any* eventually-connected gossip | harmless (idempotent merge) |
| Op-based (CmRDT) | reliable causal broadcast (exactly-once, causal order) | a message log + dedup + causal delivery | catastrophic unless deduped |
| Delta-state | join over a semilattice **plus** reliable delta dissemination | gossip with ack/retransmit of delta intervals | harmless if joined, wasteful if not pruned |

So the decision is an *infrastructure* decision. Picking op-based commits you to building or buying a reliable causal-broadcast layer and operating it. Picking state-based commits you to paying O(state) on the wire every gossip round. Delta-state is the engineering compromise that tries to get op-like bandwidth with state-like robustness — at the cost of a retransmission buffer you must size and prune.

If you remember one thing from this page: **state-based moves cost to the network (big messages, simple delivery); op-based moves cost to the infrastructure (small messages, hard delivery); delta-state splits the difference and adds a buffer you have to manage.**

For the underlying lattice/commutativity theory, see [CRDT Fundamentals](../01-crdt-fundamentals/professional.md). Other tiers: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [interview](interview.md).

---

## 2. What real systems pick — and why

Real systems rarely use a textbook-pure form. They mix, optimize, and hide the model behind an API. Here is what production systems actually do, attributed as precisely as the public record allows.

### 2.1 Riak DT — state-based, gossip + active anti-entropy (Merkle)

Riak (Basho) shipped **Riak DT**, a library of state-based CRDTs (counters, sets via OR-Set/ORSWOT, maps, registers, flags) layered on Riak's existing Dynamo-style replication. The replication substrate is state-based by nature: replicas exchange and merge whole objects. Two complementary mechanisms keep replicas in sync:

- **Read-repair**: when a coordinating node reads an object from its N replicas and detects divergence, it merges and writes back the joined value.
- **Active anti-entropy (AAE)**: a background process keeps a per-partition **Merkle tree** (hash tree) of object versions; neighboring replicas exchange tree roots and descend only into subtrees whose hashes differ, repairing exactly the keys that diverge.

Why state-based here: Riak already replicates opaque values with hinted handoff and read-repair; making the *values* CRDTs means "merge on read" is correct without changing the delivery layer. The price is that every object that diverges is shipped whole — fine for counters and small sets, painful for large maps (which is why Riak DT maps are designed to be shallow and why "don't put a million elements in one CRDT" is folk wisdom).

### 2.2 Redis Enterprise CRDB — operation/effect-based geo-replication

Redis Enterprise's **CRDB (Conflict-free Replicated Database, "Active-Active")** geo-replicates Redis data types as CRDTs across clusters. Public material describes an **operation/effect-based** approach: a write is applied locally, an *effect* (the resolved operational delta — e.g. "increment by 3", "add element X with this causal tag") is computed, and that effect is propagated to peer clusters where it is applied. Each member cluster persists and replays effects; the inter-cluster channel provides ordered, reliable delivery with the metadata (vector-clock-like causal context) needed to resolve concurrent writes per data-type semantics.

Why op/effect-based here: Redis values can be large (a big sorted set, a big hash). Shipping the *effect* of a single command is far cheaper than shipping the whole key on every write, and Redis's command model maps naturally onto operations. CRDB invests heavily in the delivery layer (a persistent, ordered replication link between clusters) precisely because op-based demands it.

### 2.3 Automerge — change/op-based with a compressed op log

**Automerge** (Martin Kleppmann et al.) is an op-based JSON CRDT for local-first apps. Edits become **changes**, each containing a list of operations with causal dependencies (hashes of predecessor changes, forming a DAG). Replicas sync by exchanging the changes the other side is missing; Automerge has a **sync protocol** (Bloom-filter-based "have/need" exchange) so two peers can figure out the missing-change set without re-sending history. The full op history is retained (it powers time-travel, blame, and merge), and Automerge uses an aggressively **columnar, compressed binary encoding** to keep that history small.

Why op-based here: collaborative editing needs fine-grained merges and history. State-based would mean shipping the whole document on every keystroke-batch — absurd. The trade-off Automerge accepts is **unbounded history growth**: the op log is the source of truth and historically could not be fully garbage-collected, which is a real operational concern for long-lived documents (see §6).

### 2.4 Yjs — a highly optimized op-based sequence CRDT

**Yjs** is the other dominant local-first CRDT framework. It is op-based with a sequence CRDT (a YATA-derived design) optimized to the bone: operations are stored in a compact structure, runs of adjacent insertions are coalesced into single items, and the update format is a small binary delta. Yjs sync ("state vector" exchange) lets a peer request exactly the updates it lacks. In practice Yjs achieves extremely low per-edit overhead, which is why it underpins many production collaborative editors. Yjs *can* garbage-collect deleted content (replacing deleted items with tombstone markers and optionally dropping content), trading some history fidelity for bounded growth — a deliberately different point on the curve than Automerge's full-history default.

### 2.5 Akka Distributed Data — delta-state

**Akka Distributed Data (DData)** replicates CRDTs across an Akka cluster using gossip. Critically, it supports **delta-CRDTs**: instead of gossiping the whole state, a node accumulates the *delta* produced by recent updates and gossips that, falling back to full-state gossip when a peer is too far behind or deltas are lost. This is the textbook delta-state design (Almeida, Shoker, Baquero) in production: small messages in the common case, full-state convergence as the safety net.

Why delta-state here: Akka clusters can be large and CRDT values (e.g. a big OR-Set of cluster members or routing entries) non-trivial; full-state gossip every round would saturate the cluster network. Delta-state keeps steady-state traffic proportional to *churn*, not to *size*.

### 2.6 Phoenix Presence — state-based ORSWOT

Elixir's **Phoenix Presence** tracks who-is-online across a cluster of nodes using an **ORSWOT** (Observed-Remove Set Without Tombstones), a state-based CRDT, disseminated over Phoenix PubSub with a heartbeat/gossip mechanism. Presence is a perfect fit for state-based: the set is small (online users per topic), churn is moderate, and "merge two presence states" is exactly the join you want when nodes reconnect after a partition. No causal-broadcast infrastructure required — heartbeats are enough.

### 2.7 The pattern behind the picks

| System | Model | Delivery | Why this model |
|---|---|---|---|
| Riak DT | state-based | gossip + Merkle AAE + read-repair | reuse Dynamo replication; objects are small |
| Redis CRDB | op/effect-based | ordered inter-cluster link | values large, commands map to ops |
| Automerge | op-based (change DAG) | Bloom-filter sync, full history | collaborative editing needs fine merges + history |
| Yjs | op-based (optimized sequence) | state-vector sync, optional GC | editing at scale, minimal per-edit overhead |
| Akka DData | delta-state | gossip with full-state fallback | large clusters, non-trivial values, churn-bound traffic |
| Phoenix Presence | state-based (ORSWOT) | heartbeat/gossip | small sets, reconnect-merge, no infra to run |

The throughline: **op/delta wins when the object is large relative to a change; state wins when the object is small or you cannot afford to run reliable delivery.**

---

## 3. Bandwidth economics: state vs op vs delta

Let:

- `S` = serialized size of one replica's CRDT state (bytes)
- `o` = size of one operation/effect (bytes)
- `d` = size of an accumulated delta interval (bytes)
- `N` = number of replicas
- `f` = gossip fanout (peers contacted per round)
- `r` = gossip rounds per second
- `w` = local writes per second per replica

### 3.1 Steady-state wire cost per replica per second

**State-based (full-state anti-entropy gossip):** each round, a replica sends its state to `f` peers:

```
B_state ≈ S × f × r        (bytes/sec, per replica)
```

This is **independent of the write rate** and **proportional to total state size**. A replica with a 2 MB OR-Set, fanout 3, gossiping twice a second, sends `2e6 × 3 × 2 = 12 MB/s` whether or not anything changed. Across `N` replicas the cluster pushes `N × 12 MB/s`. That is the wall state-based hits.

**Op-based (broadcast every operation):** each local write is broadcast to all replicas that need it (typically all `N−1`):

```
B_op ≈ o × w × (N − 1)     (bytes/sec, per replica)
```

This is **independent of state size** and **proportional to write rate × replica count**. A 40-byte effect, 500 writes/s, 5 replicas: `40 × 500 × 4 = 80 KB/s`. Tiny — until `N` or `w` explodes, where the `(N−1)` fanout bites (this is why op-based geo-replication often uses a small number of clusters, not hundreds of nodes).

**Delta-state (gossip accumulated deltas):** each round you gossip the delta accumulated since you last successfully synced with that peer:

```
B_delta ≈ d × f × r        with d ≈ (bytes of state touched since last sync)
```

In steady state `d` tracks *churn*, not *size*: if 0.1% of a 2 MB set changes per round, `d ≈ 2 KB`, so `B_delta ≈ 2e3 × 3 × 2 = 12 KB/s` — a **1000×** reduction versus full-state for this object. The catch: if a peer falls behind and you lost the deltas, you must fall back to shipping `S`.

### 3.2 When state-based gossip becomes prohibitive

Full-state cost `S × f × r` blows up along three axes:

1. **Large objects.** A single CRDT map/set in the hundreds of KB to MB range. Counters are bytes; document-sized CRDTs are not. The crossover is roughly when `S` exceeds the per-round budget you are willing to spend.
2. **Many replicas.** Cluster traffic is `N × S × f × r`. At `N = 100`, `S = 500 KB`, `f = 3`, `r = 1`: `150 GB/s` cluster-wide. Untenable. This is why Riak/Phoenix-style state-based deployments keep `S` small and lean on Merkle AAE so they almost never ship full state — they ship *hashes* and repair only diffs.
3. **High edit rate on a shared object.** State-based wastes work re-shipping unchanged bytes; the more concurrent editors, the more redundant full-state transfers.

**Concrete sizing decision.** Suppose a collaborative document averages `S = 1.5 MB`, ops are `o ≈ 30 bytes`, edits arrive at `w = 20/s` across `N = 8` peers, gossip would be `f = 2, r = 1`:

```
State-based:  B = 1.5e6 × 2 × 1   = 3.0 MB/s per replica  → 24 MB/s cluster
Op-based:     B = 30  × 20 × 7    = 4.2 KB/s per replica  → 34 KB/s cluster
Delta (1% churn/round, d≈15KB):
              B = 1.5e4 × 2 × 1   = 30 KB/s per replica   → 240 KB/s cluster
```

Op-based is ~700× cheaper than state-based here, and even delta-state is ~100× cheaper. For documents, op-based is not a preference — it is the only viable model. Flip the scenario to Phoenix Presence (`S = 8 KB`, churn modest, no causal-broadcast infra available) and state-based is obviously right: 8 KB gossips are free and you avoid running a delivery layer entirely.

### 3.3 The hidden metadata cost

Bandwidth math above ignores **metadata**, which often dominates for small payloads:

- Op-based ships causal context (vector clock / dependency hashes) per op. A 4-byte counter increment can carry a 40-byte vector clock at `N = 10`. Your effective `o` is metadata-bound, not payload-bound.
- State-based ships the *whole* causal metadata inside `S` (every element's add/remove tags in an OR-Set). For sets with high tombstone churn, metadata can exceed live data — which is exactly why ORSWOT ("without tombstones") exists.

When you size, size with metadata. The real `o` and `S` are bigger than the data you think you are moving.

---

## 4. The delivery-infrastructure tax of op-based

State-based's superpower is delivery tolerance: **any** eventually-connected gossip suffices because merge is idempotent and order-independent. Drop a message, duplicate it, reorder it, replay last week's state — the join absorbs all of it. You can build state-based dissemination on UDP-and-pray and still converge.

Op-based has no such grace. For op-based correctness you need **reliable causal broadcast (RCB)**:

1. **Reliability** — every op reaches every replica that needs it, eventually. Lost ops never resolve on their own (unlike lost state, which the next gossip overwrites). So you need a **persistent log** and **retransmission** (acks, NAKs, or pull-based gap fills).
2. **Causal order** — an op is delivered to the application only after all ops it causally depends on. Implemented with **vector clocks** or **dependency hashes**: hold an op in a buffer until its dependencies have been delivered. Out-of-causal-order delivery can violate op semantics (e.g. applying a "remove element" before the "add element" it removes).
3. **Exactly-once application** — see §5; you must dedup because retransmission *will* deliver duplicates.

That is a real system to run. Concretely, the op-based tax includes:

- **A durable message log** per source (so you can retransmit and so a recovering replica can replay). This is storage + GC (§6).
- **Per-pair sync state**: who has seen up to where (state vectors, last-acked sequence numbers, Bloom filters of "haves"). This is memory and gossip overhead that scales with `N`.
- **Flow control / backpressure**: a slow consumer must not let the log grow unbounded; you need either bounded buffers with backpressure or a snapshot-and-skip fallback.
- **On-call surface**: gaps that never fill (a NAK lost forever), causal-order deadlocks (a dependency that will never arrive because its origin replica died before broadcasting), and log-disk-full incidents.

State-based's tax, by contrast, is bandwidth and the AAE machinery (Merkle trees, read-repair). No causal buffer, no per-op dedup, no "this op is stuck waiting for a dependency that's gone."

**This is the single most underweighted factor in the choice.** Teams pick op-based for the bandwidth win, then discover they have signed up to operate a reliable-causal-broadcast subsystem — effectively a small message broker — with all the failure modes that implies. If you cannot afford to run that, you cannot afford pure op-based. Delta-state is popular precisely because it needs only *reliable* dissemination of deltas (acks + fall back to full state), not *causal* delivery — the merge still provides order-independence; you only need to not silently lose a delta forever, and the full-state fallback covers you when you do.

| Delivery guarantee needed | State-based | Delta-state | Op-based |
|---|---|---|---|
| Eventual connectivity | ✅ required | ✅ required | ✅ required |
| No-loss (or recover from loss) | not needed (overwrite) | needed, but full-state fallback covers it | **required** |
| Causal ordering | not needed | not needed | **required** |
| Exactly-once / dedup | not needed | only to avoid waste | **required** |
| Run a persistent log | no | optional (delta buffer) | **yes** |

---

## 5. Dedup, idempotency, and the exactly-once myth

### 5.1 There is no exactly-once on the wire

Distributed systems give you at-most-once or at-least-once delivery; "exactly-once" is achieved only as **at-least-once delivery + idempotent or deduplicated processing**. For op-based CRDTs this is not optional polish — it is correctness. Re-applying a non-idempotent op (e.g. `counter += 1`) twice corrupts the value forever. State-based merge is idempotent by definition (`x ⊔ x = x`), so it is immune; op-based must engineer idempotence in.

### 5.2 How op-based achieves effective exactly-once

Two standard techniques, usually combined:

1. **Dedup by unique op id.** Tag every op with a globally unique id — typically `(replicaId, sequenceNumber)` or a content hash. Each replica keeps a "delivered set" (or, compactly, a per-source high-water mark plus a set of out-of-order ids above it). On receipt, if the id is already delivered, drop it. This makes re-delivery a no-op without requiring the op itself to be idempotent.
2. **Idempotent op design.** Design ops so re-application is harmless even without dedup — e.g. PN-Counter operations carry the op's unique tag and the counter is the sum over a *set* of tagged increments (adding the same tag twice is absorbed). OR-Set add/remove carry unique tags so duplicate "add X (tag t)" collapses. Effectively you push the idempotence into the data type by making each op carry a unique tag that the merge treats as set membership.

The compact dedup structure matters operationally. A naive "set of all delivered ids" grows forever. The standard fix is a **version vector**: store, per source replica, the contiguous sequence number you have fully received; only ids *above* the per-source water mark need explicit tracking, and they are pruned as the gap fills. This bounds dedup memory to (number of sources) + (current reorder window), not (total ops ever).

### 5.3 The idempotency / causal-order interaction

Dedup handles duplicates; it does **not** handle order. You still need causal delivery (§4) so that, e.g., an "add tag t" is delivered before the "remove tag t" that observed it. Some op designs make ops fully commutative *and* idempotent so causal order is unnecessary for convergence (these are "pure op-based" CRDTs); others require causal delivery. Know which kind your data type is — assuming commutativity you do not have is a classic source of "it converged in tests, diverged in prod under reordering" bugs.

---

## 6. GC and compaction: op logs, delta buffers, causal stability

Every model accumulates something that must be reclaimed, or you take an outage.

### 6.1 Op-log growth (Automerge-style history)

Op-based systems that retain history (Automerge by default) grow the log monotonically. The document's *value* is small but its *change history* is unbounded: a year of edits to a paragraph can be megabytes of changes. Operational consequences:

- Sync gets slower (more changes to diff/compare).
- Memory and disk per document grow without bound.
- Loading a document means replaying or materializing a long history.

Mitigations: **save/compaction** to a snapshot of current state (Automerge's binary save produces a compact document you reload instead of replaying every change), columnar compression of the change DAG, and (where the product allows) dropping deep history. Yjs takes the GC-friendlier default: it can replace deleted content with tombstones and drop the content bytes, bounding growth at the cost of full historical fidelity.

### 6.2 Delta-buffer pruning (delta-state)

A delta-state replica keeps a buffer of recently produced deltas so it can answer "give me everything since interval X" for peers that are behind. This buffer must be pruned, or it becomes an unbounded log. The rule: a delta can be dropped once **every replica you sync with has acknowledged a state at or after it** (you no longer need to be able to reconstruct that interval, because everyone has joined it). Until acked, you keep it; if a peer falls behind your retention window, you fall back to shipping full state. Sizing the retention window is the key tuning knob: too small ⇒ frequent expensive full-state fallbacks; too large ⇒ memory bloat.

### 6.3 Causal stability and tombstone reclamation

Many CRDTs accumulate **tombstones** (markers for removed elements) that exist only to win against not-yet-seen concurrent adds. A tombstone becomes safe to delete once it is **causally stable** — i.e. every replica has seen it, so no in-flight operation could possibly reference it. Computing causal stability requires knowing the minimum across all replicas' version vectors (a "stable cut"). This needs:

- Membership knowledge (who are all the replicas?), and
- Liveness assumptions (a permanently dead replica that never advances its clock will *freeze* causal stability and prevent all GC).

That second point is a real incident pattern: a node leaves uncleanly, its entry in everyone's version vector never advances, and tombstone GC stalls cluster-wide, leaking memory until someone manually evicts the dead member. ORSWOT and "without tombstones" designs exist specifically to reduce this fragility.

### 6.4 Incidents from unbounded logs (the on-call reality)

- **Op log fills disk.** A high-write collaborative document or an op-based replication link with a stuck consumer; the log grows until the volume is full and writes fail. Fix: bounded logs + snapshot/compaction + backpressure on producers.
- **Delta buffer never pruned.** A peer is partitioned for hours; its un-acked deltas are retained; memory climbs. Fix: cap retention, fall back to full-state for too-far-behind peers, alert on buffer size.
- **Tombstone leak.** A dead replica freezes the stable cut; tombstones never reclaim. Fix: aggressive dead-member detection and forced eviction; design with bounded tombstones.

The lesson: **GC is not a background nicety; it is a capacity-planning input.** Every model has an "if I never prune X" failure, and you must monitor X.

---

## 7. Anti-entropy: Merkle diffing, hash exchange, read-repair

Anti-entropy is how state-based (and delta-state) systems converge *cheaply* despite shipping whole states only when necessary. The trick: exchange **hashes**, not data, and ship data only where hashes disagree.

### 7.1 Merkle-tree (hash-tree) diffing — Riak AAE

Each replica maintains a **Merkle tree** over its keyspace: leaves hash the (key → version) entries in a bucket; internal nodes hash their children; the root summarizes everything. To compare two replicas:

1. Exchange roots. Equal ⇒ in sync, done (one hash exchanged for the whole partition).
2. If unequal, exchange the next level, descend only into children whose hashes differ.
3. Continue to the leaves that differ; those identify exactly the keys that diverge.
4. Repair the diverging keys (ship and merge those objects only).

Cost is `O(log n)` rounds and proportional to the *number of differing keys*, not total keys. This is why Riak can run AAE continuously across huge partitions: in steady state almost everything matches, so the root hashes match and nothing is shipped. Full-state transfer happens only for the keys that actually diverged.

### 7.2 Hash/state-vector exchange (op- and delta-based sync)

Op-based systems do the analogous thing with **state vectors** (per-source sequence numbers): a peer sends "I have seen up to (A:42, B:17, C:9)"; the other side computes the difference and ships only the missing ops. Automerge's Bloom-filter sync and Yjs's state-vector sync are both "tell me what you have, I'll send what you're missing" protocols — anti-entropy for op logs. The principle is identical: exchange a compact summary, transfer only the gap.

### 7.3 Read-repair

Read-repair is opportunistic anti-entropy on the read path: when a read fans out to N replicas and finds divergence, the coordinator merges (join) and writes the resolved value back to the stale replicas. It piggybacks convergence on traffic you were already doing, so hot keys self-heal without waiting for the background AAE sweep. Riak uses both; the combination means popular keys repair fast (read-repair) and cold keys repair eventually (AAE).

| Mechanism | Summary exchanged | Data shipped | Used by |
|---|---|---|---|
| Merkle AAE | hash tree (root → leaves) | only differing keys | Riak (state-based) |
| State-vector / Bloom sync | per-source seqnos / Bloom filter | only missing ops | Automerge, Yjs (op-based) |
| Read-repair | the read values themselves | merged value to stale replicas | Riak, Dynamo-style stores |

---

## 8. Decision guide: picking a model by workload

No model is universally best. Map your workload to the model whose costs you can pay.

### 8.1 The decision table

| Workload signal | Favors **state-based** | Favors **delta-state** | Favors **op-based** |
|---|---|---|---|
| Object size | small (≤ low KB) | medium–large | any (large is fine) |
| Replica count `N` | small–moderate | large clusters | small–moderate (fanout `N−1` hurts) |
| Edit rate per object | low | moderate | high / fine-grained |
| Network reliability | unreliable / lossy OK | lossy OK (full-state fallback) | needs reliable causal delivery |
| Can you run a broker / RCB? | no — and don't need to | no — and don't need to | **yes — required** |
| History / audit / time-travel needed | no (only current state) | no | **yes** (op log = history) |
| Tombstone/metadata churn | use ORSWOT to bound | manageable | manageable |
| Convergence robustness priority | highest (idempotent join) | high (join + fallback) | depends on delivery layer |

### 8.2 Decision flow (prose)

1. **Do you need fine-grained merges or edit history (collaborative editing, audit, time-travel)?** → Op-based (Automerge/Yjs-style). Accept the delivery layer and log-GC cost.
2. **Are objects small and you'd rather not run any reliable-delivery infrastructure (presence, small config, counters)?** → State-based. Lean on gossip + Merkle AAE + read-repair. (Riak DT, Phoenix Presence.)
3. **Are objects non-trivial and the cluster large, but you don't need history?** → Delta-state. Churn-bound bandwidth with full-state fallback. (Akka DData.)
4. **Is bandwidth across geo-clusters the binding constraint, command model maps to ops, and you can run a reliable inter-cluster link?** → Op/effect-based. (Redis CRDB.)
5. **Unsure / mixed?** → Default to **delta-state** if you have non-trivial state; it degrades to state-based safely and approximates op-based bandwidth without the causal-broadcast obligation.

### 8.3 Worked picks

- **Online-presence service, 50 nodes, sets of a few hundred users, no broker available.** State-based ORSWOT over heartbeats. (This *is* Phoenix Presence.)
- **Multi-region key-value store with large values, 3–5 regions, dedicated replication link.** Op/effect-based geo-replication. (This *is* Redis CRDB.)
- **Collaborative document editor, browsers + server, offline support, undo/history.** Op-based sequence CRDT with compressed log + GC. (Yjs, or Automerge if you want full history.)
- **Cluster-wide routing/config table, 100+ nodes, KB–MB values, churn-bound.** Delta-state with full-state fallback. (Akka DData.)
- **Counters and small sets in a Dynamo-style store you already run.** State-based CRDTs + Merkle AAE + read-repair. (Riak DT.)

---

## 9. Observability and testing

You do not get to *believe* a CRDT deployment converges; you instrument and test until you can *show* it.

### 9.1 Metrics to emit

| Metric | Why it matters | Alert when |
|---|---|---|
| `replication_bytes_total` (by peer) | the bandwidth bill; validates your sizing math | unexpected growth (full-state fallbacks?) |
| `op_log_size_bytes` / `delta_buffer_bytes` | unbounded-log incidents (§6) | exceeds retention budget |
| `replication_lag_seconds` (per peer) | how stale replicas are; SLO input | above convergence SLO |
| `merge_latency_seconds` | merge cost grows with state/history | p99 climbs (history not compacted) |
| `causal_buffer_depth` (op-based) | ops stuck waiting for dependencies | grows without draining (lost dep / dead origin) |
| `dedup_drop_total` | retransmission/duplication rate | spikes (delivery layer churning) |
| `full_state_fallback_total` (delta) | retention window too small | frequent fallbacks |
| `divergent_keys_repaired_total` (AAE) | anti-entropy health | sustained nonzero (constant divergence) |
| `causal_stability_cut` lag | tombstone GC blocked (dead member) | cut not advancing |

### 9.2 Property-based convergence tests

The defining CRDT properties are testable as universally-quantified properties, which is exactly what property-based testing (QuickCheck/Hypothesis-style) is for:

- **Commutativity:** `merge(a, b) == merge(b, a)`.
- **Associativity:** `merge(merge(a, b), c) == merge(a, merge(b, c))`.
- **Idempotence (state/delta):** `merge(a, a) == a`.
- **Convergence (the big one):** generate random sequences of operations on `k` replicas with arbitrary interleavings/partitions; after delivering all ops/states to all replicas (in any order, with duplicates), assert every replica reads the same value.

Generate adversarially: random op sequences, random delivery order, **duplicate** deliveries, **reordered** deliveries, and partition-then-heal schedules. If your op-based type requires causal order, the harness must respect causal dependencies (delivering a dependency before its dependent) — and you should *also* run a test that violates causal order to confirm your buffer enforces it (the buffered op should not be applied early).

### 9.3 Jepsen partition tests

Property tests run in-process; **Jepsen** runs the real system under real network partitions (via `nemesis` faults: partitions, clock skew, process pauses, packet loss) and checks a consistency model after healing. For CRDTs the checker asserts **eventual convergence**: after the nemesis stops and the cluster heals, all replicas read identical, correctly-merged values, and no acknowledged write was lost. Jepsen has found real CRDT/replication bugs in production databases; if you run a replicated store in production, a Jepsen-style partition suite is the difference between "we tested merge" and "we tested the *system*."

### 9.4 Deterministic simulation

The highest-leverage technique for replication logic: run the entire cluster — all replicas, the network, the clock — inside a **single deterministic simulator** with a seeded RNG controlling message order, drops, duplications, and partitions. Because it is deterministic, a failing seed reproduces exactly, and you can run millions of randomized schedules in CI. FoundationDB famously built its reliability this way; for a CRDT layer it means you can exhaustively (in practice, statistically) explore delivery schedules that you would never hit by luck in staging. Combine with property assertions (§9.2) as the oracle.

---

## 10. Code: a delta-state store with Merkle anti-entropy + convergence tests

A runnable, dependency-free Python example. It implements a **delta-state** keyed store of **G-Counters** (per-key grow-only counters) with:

- delta accumulation and `merge` (join),
- a Merkle-ish hash summary per shard so peers exchange hashes and ship only differing keys (anti-entropy),
- a simulated lossy/reordering/duplicating network, and
- a property-based convergence test asserting all replicas converge regardless of schedule.

The code is intentionally compact but correct; it runs on CPython 3.8+ with only the standard library.

```python
"""
delta_crdt.py — delta-state keyed G-Counter store with Merkle anti-entropy.

A G-Counter per key: state is {replica_id: count}; value = sum of counts.
Merge (join) is element-wise max -> commutative, associative, idempotent.
We accumulate deltas (only the (key, replica, count) entries that changed)
and ship those; a Merkle-ish per-shard hash lets peers detect which keys
diverge so anti-entropy ships only the differing keys.
"""
from __future__ import annotations
import hashlib
import random
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Tuple

# ---- G-Counter ------------------------------------------------------------

GCounter = Dict[str, int]  # replica_id -> count


def gc_value(c: GCounter) -> int:
    return sum(c.values())


def gc_merge(a: GCounter, b: GCounter) -> GCounter:
    """Join: element-wise max. Commutative, associative, idempotent."""
    out = dict(a)
    for rid, n in b.items():
        if n > out.get(rid, 0):
            out[rid] = n
    return out


# ---- Replica with delta accumulation -------------------------------------

NUM_SHARDS = 16


def _shard_of(key: str) -> int:
    return int(hashlib.blake2b(key.encode(), digest_size=2).hexdigest(), 16) % NUM_SHARDS


@dataclass
class Replica:
    rid: str
    # full state: key -> GCounter
    state: Dict[str, GCounter] = field(default_factory=dict)
    # accumulated delta since last gossip: key -> GCounter (only changed parts)
    delta: Dict[str, GCounter] = field(default_factory=dict)

    # --- local mutation ---
    def incr(self, key: str, by: int = 1) -> None:
        gc = self.state.setdefault(key, {})
        gc[self.rid] = gc.get(self.rid, 0) + by
        # record the change into the delta buffer
        dgc = self.delta.setdefault(key, {})
        dgc[self.rid] = gc[self.rid]  # latest value for this replica's slot

    def value(self, key: str) -> int:
        return gc_value(self.state.get(key, {}))

    # --- merge an incoming (partial) state map ---
    def merge_in(self, incoming: Dict[str, GCounter]) -> None:
        for key, gc in incoming.items():
            merged = gc_merge(self.state.get(key, {}), gc)
            self.state[key] = merged

    # --- delta dissemination ---
    def take_delta(self) -> Dict[str, GCounter]:
        d = self.delta
        self.delta = {}
        return d

    # --- Merkle-ish anti-entropy support ---
    def shard_hash(self, shard: int) -> str:
        """Hash of all (key, GCounter) entries in a shard, order-independent."""
        h = hashlib.blake2b(digest_size=16)
        items = sorted(
            (k, tuple(sorted(self.state[k].items())))
            for k in self.state
            if _shard_of(k) == shard
        )
        for k, gc in items:
            h.update(repr((k, gc)).encode())
        return h.hexdigest()

    def shard_summary(self) -> Dict[int, str]:
        return {s: self.shard_hash(s) for s in range(NUM_SHARDS)}

    def keys_in_shard(self, shard: int) -> Dict[str, GCounter]:
        return {k: dict(v) for k, v in self.state.items() if _shard_of(k) == shard}


# ---- Anti-entropy round (hash exchange, ship only differing shards) -------

def anti_entropy(a: Replica, b: Replica) -> int:
    """Reconcile a and b. Returns number of keys actually shipped (bandwidth proxy)."""
    sa, sb = a.shard_summary(), b.shard_summary()
    shipped = 0
    for shard in range(NUM_SHARDS):
        if sa[shard] == sb[shard]:
            continue  # Merkle match: ship nothing for this shard
        # shards differ: exchange the keys in that shard and merge both ways
        ka, kb = a.keys_in_shard(shard), b.keys_in_shard(shard)
        a.merge_in(kb)
        b.merge_in(ka)
        shipped += len(ka) + len(kb)
    return shipped


# ---- Lossy / reordering / duplicating network for delta gossip ------------

@dataclass
class Network:
    rng: random.Random
    loss: float = 0.2
    dup: float = 0.2
    inflight: List[Tuple[str, Dict[str, GCounter]]] = field(default_factory=list)

    def send(self, to_rid: str, payload: Dict[str, GCounter]) -> None:
        if self.rng.random() < self.loss:
            return  # dropped
        self.inflight.append((to_rid, payload))
        if self.rng.random() < self.dup:
            self.inflight.append((to_rid, dict(payload)))  # duplicate

    def deliver_all(self, replicas: Dict[str, Replica]) -> None:
        self.rng.shuffle(self.inflight)  # reorder
        for to_rid, payload in self.inflight:
            replicas[to_rid].merge_in(payload)  # merge is idempotent -> dup-safe
        self.inflight.clear()


# ---- Demo: gossip deltas, then anti-entropy to repair losses --------------

def demo() -> None:
    rng = random.Random(42)
    ids = ["A", "B", "C", "D"]
    reps = {i: Replica(i) for i in ids}
    net = Network(rng, loss=0.3, dup=0.3)

    for round_no in range(50):
        # local writes
        for r in reps.values():
            if rng.random() < 0.7:
                r.incr(f"k{rng.randint(0, 5)}", rng.randint(1, 3))
        # delta gossip to one random peer (best-effort, lossy)
        for r in reps.values():
            peer = rng.choice([i for i in ids if i != r.rid])
            net.send(peer, r.take_delta())
        net.deliver_all(reps)

    # periodic anti-entropy repairs whatever the lossy gossip missed
    shipped = 0
    for a in ids:
        for b in ids:
            if a < b:
                shipped += anti_entropy(reps[a], reps[b])

    vals = {i: {k: reps[i].value(k) for k in reps[i].state} for i in ids}
    converged = all(vals[i] == vals[ids[0]] for i in ids)
    print(f"anti-entropy shipped ~{shipped} key-transfers; converged={converged}")
    print("final values:", vals[ids[0]])


if __name__ == "__main__":
    demo()
```

### 10.1 Property-based convergence test

Using `hypothesis` (`pip install hypothesis`). It generates random operation/schedule plans, applies them with lossy/duplicating/reordering delivery, runs anti-entropy to heal, and asserts **all replicas converge**. It also asserts the algebraic laws of the join directly.

```python
"""test_convergence.py — property-based tests for the delta-state store."""
import random
from hypothesis import given, settings, strategies as st

from delta_crdt import Replica, Network, anti_entropy, gc_merge, GCounter

REPLICA_IDS = ["A", "B", "C", "D"]

# (replica_index, key_index, increment)
ops = st.lists(
    st.tuples(
        st.integers(min_value=0, max_value=len(REPLICA_IDS) - 1),
        st.integers(min_value=0, max_value=5),
        st.integers(min_value=1, max_value=5),
    ),
    min_size=0,
    max_size=200,
)


@settings(max_examples=300, deadline=None)
@given(ops=ops, seed=st.integers(min_value=0, max_value=2**31 - 1))
def test_convergence_under_lossy_delivery(ops, seed):
    rng = random.Random(seed)
    reps = {i: Replica(i) for i in REPLICA_IDS}
    net = Network(rng, loss=0.4, dup=0.4)

    for (ri, ki, inc) in ops:
        r = reps[REPLICA_IDS[ri]]
        r.incr(f"k{ki}", inc)
        peer = rng.choice([i for i in REPLICA_IDS if i != r.rid])
        net.send(peer, r.take_delta())
        if rng.random() < 0.3:
            net.deliver_all(reps)

    net.deliver_all(reps)  # flush
    # full anti-entropy heals anything the lossy network dropped
    for a in REPLICA_IDS:
        for b in REPLICA_IDS:
            if a < b:
                anti_entropy(reps[a], reps[b])

    # CONVERGENCE: every replica reads identical state for every key.
    ref = reps[REPLICA_IDS[0]]
    for i in REPLICA_IDS[1:]:
        assert reps[i].state == ref.state, f"{i} diverged from reference"


# Algebraic laws of the join (these are why convergence holds at all).
gcounters = st.dictionaries(
    st.sampled_from(REPLICA_IDS),
    st.integers(min_value=0, max_value=1000),
    max_size=4,
)


@given(a=gcounters, b=gcounters, c=gcounters)
def test_merge_commutative(a, b, c):
    assert gc_merge(a, b) == gc_merge(b, a)


@given(a=gcounters, b=gcounters, c=gcounters)
def test_merge_associative(a, b, c):
    assert gc_merge(gc_merge(a, b), c) == gc_merge(a, gc_merge(b, c))


@given(a=gcounters)
def test_merge_idempotent(a):
    assert gc_merge(a, a) == a
```

What this buys you operationally:

- The **convergence** test exercises loss, duplication, and reordering — the three things that break naive op-based code — and proves the delta/anti-entropy path heals them.
- The **law** tests pin the foundation: if someone "optimizes" `gc_merge` and breaks associativity, these fail instantly, before the bug ships and silently diverges replicas in production.
- The same harness shape (random ops + adversarial schedule + convergence oracle) is exactly what you scale up into deterministic simulation (§9.4) and validate against the real system with Jepsen (§9.3).

> Note: this example is *state/delta*-based, so duplicates and reordering are harmless by construction. For an op-based store, the analogous test must additionally feed **out-of-causal-order** deliveries and assert your causal buffer holds dependent ops until their dependencies arrive — and that dedup makes re-delivery a no-op. That extra rigor is precisely the §4 delivery tax made testable.

---

## 11. Checklists

### Choosing a model

- [ ] Measured (or estimated with metadata) `S`, `o`, `d`, `N`, `w` for the real workload.
- [ ] Computed steady-state bandwidth for each model; identified the binding constraint.
- [ ] Decided whether you need history/audit/time-travel (forces op-based).
- [ ] Decided whether you can operate a reliable causal-broadcast layer (gates op-based).
- [ ] If non-trivial state and unsure: defaulted to delta-state with full-state fallback.
- [ ] Picked CRDT types that bound metadata (e.g. ORSWOT over tombstoned OR-Set).

### Operating op-based

- [ ] Reliable delivery: persistent log + retransmission (ack/NAK/pull gap-fill).
- [ ] Causal order enforced via vector clocks / dependency hashes; buffer for out-of-order.
- [ ] Dedup via unique op ids + per-source water marks (bounded memory).
- [ ] Log compaction/snapshotting; bounded disk; backpressure on stuck consumers.
- [ ] Dead-origin detection so causal buffers don't deadlock on lost dependencies.
- [ ] Alert on `causal_buffer_depth`, `op_log_size_bytes`, `dedup_drop_total`.

### Operating state-/delta-based

- [ ] Merkle/AAE or hash-summary anti-entropy running and monitored.
- [ ] Read-repair on the read path for hot-key self-healing.
- [ ] Delta retention window sized; full-state fallback path tested.
- [ ] Causal-stability cut monitored; dead-member eviction so tombstone GC doesn't stall.
- [ ] Alert on `full_state_fallback_total`, `delta_buffer_bytes`, `divergent_keys_repaired_total`.

### Testing

- [ ] Property tests for commutativity, associativity, idempotence (state/delta).
- [ ] Convergence property test under loss/dup/reorder/partition-heal.
- [ ] (Op-based) explicit out-of-causal-order test proving the buffer holds dependents.
- [ ] Jepsen-style partition suite asserting eventual convergence + no acked-write loss.
- [ ] Deterministic simulation with seeded schedules in CI; failing seeds reproduce exactly.

---

## 12. Cheat sheet

| Question | State-based | Delta-state | Op-based |
|---|---|---|---|
| What's on the wire | whole state `S` | delta interval `d` | single op `o` |
| Steady-state cost | `S·f·r` (size-bound) | `d·f·r` (churn-bound) | `o·w·(N−1)` (rate·fanout-bound) |
| Delivery needed | any gossip | reliable (full-state fallback) | reliable **causal** broadcast |
| Dups/reorder | harmless (idempotent join) | harmless if joined | must dedup + causal-order |
| Infra to run | gossip + Merkle AAE | gossip + delta buffer | message log + RCB (≈ a broker) |
| GC concern | tombstones / causal stability | prune delta buffer | compact op log + tombstones |
| History/audit | no | no | yes (log = history) |
| Best when | small objects, no broker, presence/config | large objects, large clusters, no history | docs/editing, large objects, history, can run RCB |
| Real example | Riak DT, Phoenix Presence | Akka DData | Automerge, Yjs, Redis CRDB |

Mnemonics:

- **State** = "ship everything, deliver however you like." Cost on the network.
- **Op** = "ship the change, but you owe me reliable causal delivery." Cost on the infrastructure.
- **Delta** = "ship the recent change, fall back to everything if you fall behind." Cost in a buffer you must prune.
- The crossover: op/delta win once `S` ≫ a single change; state wins when `S` is tiny or you can't run a broker.

---

## 13. Summary

State-based, op-based, and delta-state CRDTs all converge — that is settled theory. The professional decision is about **where the cost lands and which failure mode you can operate around**. State-based pushes whole states and tolerates any delivery (drop, dup, reorder, replay — the idempotent join absorbs it all), so it is the right call for small objects and when you cannot afford to run delivery infrastructure: Riak DT and Phoenix Presence pick it, leaning on Merkle anti-entropy and read-repair so they almost never actually ship full state. Op-based ships tiny changes but demands a reliable causal-broadcast layer — a persistent log, retransmission, causal ordering, and dedup — effectively a small message broker you now run on-call; collaborative editors (Automerge, Yjs) and large-value geo-replication (Redis CRDB) pay this tax because shipping whole documents or whole keys per change is absurd. Delta-state is the pragmatic middle: churn-bound bandwidth like op-based, order-independence and a full-state fallback like state-based, at the price of a delta buffer you must size and prune — Akka DData's default for large clusters.

Run the sizing math with metadata included; the model that looks cheap on payload may be expensive on causal context. Treat GC as capacity planning, not housekeeping — unbounded op logs fill disks, un-pruned delta buffers leak memory, and dead replicas freeze tombstone reclamation. And do not *trust* convergence: prove the algebraic laws with property tests, prove healing under loss/dup/reorder with convergence property tests, prove the system under real partitions with Jepsen, and explore delivery schedules exhaustively with deterministic simulation. Pick the model whose bill you can pay and whose failure mode you can page yourself for.

---

## 14. Further reading

- **Riak DT & Active Anti-Entropy** — Basho Riak documentation on Riak Data Types (counters, sets, maps, ORSWOT) and Active Anti-Entropy (Merkle/hash-tree based read-repair).
- **Shapiro, Preguiça, Baquero, Zawirski — "Conflict-free Replicated Data Types"** (2011) and the companion INRIA tech report "A comprehensive study of CRDTs" — the foundational CvRDT/CmRDT treatment.
- **Almeida, Shoker, Baquero — "Delta State Replicated Data Types"** (Journal of Parallel and Distributed Computing) — the delta-state model Akka DData implements.
- **Akka Distributed Data documentation** — delta-CRDT replication, gossip, and full-state fallback in a production cluster runtime.
- **Redis Enterprise "Active-Active" / CRDB whitepaper & docs** — operation/effect-based geo-replication of Redis data types as CRDTs.
- **Martin Kleppmann — Automerge** (project docs, papers, and conference talks, including the local-first software essay "Local-First Software: You Own Your Data, in spite of the Cloud") — change/op-based JSON CRDT with compressed binary encoding and sync protocol.
- **Yjs documentation and internals** ("How Yjs works") — the optimized op-based sequence CRDT, state-vector sync, and GC behavior.
- **Phoenix Presence (Elixir/Phoenix docs)** — state-based ORSWOT presence tracking over PubSub.
- **Kyle Kingsbury — Jepsen** (jepsen.io analyses) — partition testing and consistency checking for distributed databases, including CRDT/replication systems.
- **FoundationDB — deterministic simulation testing** (talks and engineering write-ups) — the simulation methodology referenced in §9.4.
- **Related on this site:** [CRDT Fundamentals](../01-crdt-fundamentals/professional.md) · this topic at other tiers: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [interview](interview.md).
