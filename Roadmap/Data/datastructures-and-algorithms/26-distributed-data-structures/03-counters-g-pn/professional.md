# Distributed Counters — Professional Level

> You already know the math: a G-Counter is a vector of per-actor monotonic
> integers whose merge is element-wise `max`; a PN-Counter is two G-Counters
> (`P` minus `N`). At the professional tier the math is the easy part. The hard
> part is everything the math hides: the vector grows one slot per actor and you
> have millions of actors; one counter goes viral and a single key absorbs the
> write traffic of an entire cluster; a "sum" read is a snapshot that lags
> convergence by seconds; and the moment someone points a PN-Counter at money or
> inventory, the unbounded-below property that made it commutative becomes the
> reason your warehouse oversells. This page is about running counters in
> production — sizing the state, taming hot keys, choosing when a CRDT counter
> is the wrong tool, and reading real incident post-mortems.

---

## Table of Contents

1. [Where distributed counters actually ship](#1-where-distributed-counters-actually-ship)
2. [The actor-id explosion in the wild](#2-the-actor-id-explosion-in-the-wild)
3. [Hot keys and write contention](#3-hot-keys-and-write-contention)
4. [PN-Counter pitfalls and bounded counters](#4-pn-counter-pitfalls-and-bounded-counters)
5. [Delta propagation and anti-entropy](#5-delta-propagation-and-anti-entropy)
6. [Read consistency: a sum is a snapshot](#6-read-consistency-a-sum-is-a-snapshot)
7. [Observability and testing](#7-observability-and-testing)
8. [Incident vignettes](#8-incident-vignettes)
9. [Realistic code: sharded delta-state PN-Counter](#9-realistic-code-sharded-delta-state-pn-counter)
10. [Sizing, SLOs, and checklists](#10-sizing-slos-and-checklists)
11. [Cheat sheet](#11-cheat-sheet)
12. [Summary](#12-summary)
13. [Further reading](#13-further-reading)

---

## 1. Where distributed counters actually ship

Before sizing anything, it helps to know which production systems give you a
counter, what kind of counter it is, and — critically — whether it is a *real*
CRDT or merely *looks* like one. The distinction is the difference between
"converges under arbitrary partitions" and "converges only if you never lose a
message and never replay one."

### 1.1 The landscape, by correctness class

| System | Counter type | True CRDT? | Topology | Notes |
|---|---|---|---|---|
| Riak DT (`riak_dt_pncounter`, `riak_dt_gcounter`) | G / PN-Counter | Yes | Multi-master, AP | Built on the academic CRDT model; actor = vnode/client id |
| Redis Enterprise CRDB (Active-Active) | CRDT counter type | Yes | Multi-region active-active | Counters implemented as CRDTs in the geo-distributed DB |
| Cassandra `counter` columns | Replicated counter | **No (not a clean CRDT)** | Multi-master, AP | Read-before-write internally; historically not idempotent under retries |
| DynamoDB `ADD` atomic counter | Atomic increment | **No (single-master)** | Single-master per item | Strong per-item ordering; *not* partition-tolerant in the CRDT sense |
| Generic metrics pipelines (StatsD/Prometheus counters) | Local monotonic + aggregation | Partly | Per-process counters summed centrally | Convergence by re-scrape, not by merge |

The rest of this section walks each row. Where attribution is uncertain I say so
explicitly — getting "is this a CRDT?" wrong is exactly the kind of mistake that
produces the incidents in [§8](#8-incident-vignettes).

### 1.2 Riak DT counters

Riak's `riak_dt` library is one of the few mainstream, production-grade,
*honestly-CRDT* counter implementations. A Riak PN-Counter is exactly the
two-G-Counter construction from the fundamentals page: increments and decrements
accumulate per-actor, replicas merge by element-wise `max` on both the `P` and
`N` maps, and the value is `sum(P) - sum(N)`.

Bet365 is the canonical large-scale public reference for Riak DT in anger. Their
engineering team described moving a high-throughput betting/totals workload onto
Riak and the `riak_dt` types specifically because the workload needed
always-available, eventually-consistent aggregates across data centres — running
bets, pooled totals, and similar accumulating quantities map naturally onto
counters that must stay writable during a partition. (The precise internal
schema is theirs; the public takeaway is that **CRDT counters were chosen for
write-availability under partition**, which is the whole point.)

The lesson to carry forward: Riak's counters are correct *because* they pay the
actor-id cost honestly. Every distinct client that performs an increment can
become a slot in the map unless you constrain the actor set — which is precisely
[§2](#2-the-actor-id-explosion-in-the-wild).

### 1.3 Redis Enterprise CRDB counters

Redis Enterprise's "Active-Active" geo-distribution (CRDB) implements several
Redis types as CRDTs so that the *same key* can be written in multiple regions
simultaneously and converge without a central coordinator. Counters are the
flagship type: a `INCRBY`/`DECRBY` in `us-east` and another in `eu-west` on the
same key both succeed locally and the database merges them.

Two things matter for an operator:

- **The merge is CRDT-correct for counters** (additive increments commute), so
  concurrent increments across regions *add* rather than clobber. This is the
  behaviour that a naive "last-writer-wins on the integer" would get wrong — LWW
  would lose one of two concurrent `+1`s.
- **`SET` on a counter key is *not* additive.** If your code ever does
  `SET key 0` (a reset) concurrently with an `INCR`, the semantics get subtle:
  resets and increments are different operations and the conflict resolution for
  an overwrite is not the same as for an accumulate. Treat CRDB counter keys as
  *append-only increment streams*; route resets through an explicit,
  coordinated path.

If you are unsure whether a specific Redis deployment is Enterprise CRDB vs.
open-source Redis with a single master, **assume single master**. Open-source
Redis `INCR` is a single-node atomic op, not a CRDT, and replicates
asynchronously last-writer-wins-style at the key level for failover — it does
*not* give you multi-master additive merge.

### 1.4 Cassandra counters — *not* a clean CRDT

This is the most important "be careful" in the section, because Cassandra
counters are widely used and widely misunderstood.

A Cassandra `counter` column is **not** a G/PN-Counter CRDT. Internally, the
classic implementation performed a **read-before-write**: to apply `+1`, a
replica read the current shard value, added, and wrote the new total. That
design has two consequences a CRDT does not have:

1. **Increments were historically not idempotent.** If the coordinator timed out
   and the client (or driver) *retried* a non-idempotent counter mutation, the
   increment could be applied **twice** — a double-count. Pure CRDT counters
   carry a per-actor identity and dedupe by construction; the old Cassandra
   counter had no such identity for a client increment, so a retried write was
   indistinguishable from a new one. This is why every Cassandra guide warns:
   **do not retry counter writes blindly.**
2. **No clean merge function.** Because the value was derived from a read, two
   replicas that diverged could not always be reconciled by a commutative merge;
   reconciliation relied on internal shard bookkeeping rather than a
   mathematical join.

Cassandra's counters were substantially **reworked (around the 2.1 era)** to
make them far more robust — the redesign moved to a more "log-of-increments"
style internally, improving correctness and performance. But the headline for an
architect remains: **Cassandra counters are an *approximate*, eventually-ish
counter with documented correctness caveats, not a CRDT you can reason about
with the G/PN algebra.** If you need provable convergence under arbitrary
partition + retry, do not reach for a Cassandra `counter` column; reach for an
actual CRDT counter (Riak DT, Redis CRDB) or build one.

### 1.5 DynamoDB atomic counters — single-master, not a CRDT

DynamoDB's `UpdateItem` with the `ADD` action (or `SET x = x + :n`) gives you an
**atomic counter**, and it is genuinely atomic — but for a *different reason*
than a CRDT. DynamoDB is **single-master per item**: every write to a given
partition key is serialized through one leader replica. There is no concurrent
multi-master merge to reconcile, because concurrency is resolved by
*serialization*, not by *commutativity*.

Practical contrasts with a CRDT counter:

- **Idempotency is your problem.** `ADD x :1` is not idempotent; a retried
  request re-adds. To make it safe you layer a *conditional* write or a
  dedupe/idempotency key on top. (This mirrors the Cassandra retry hazard.)
- **No partition-tolerant writes for the same key.** During a partition that
  isolates the leader, writes to that item block/fail rather than proceeding
  independently and merging later. A CRDT counter *would* keep accepting writes
  on both sides. That availability difference is exactly the AP-vs-CP trade.
- **Global Tables** add multi-region replication and DynamoDB *does* implement
  conflict resolution for global tables, but the per-item atomic counter
  semantics across regions are not the same construct as a hand-rolled
  G-Counter; treat cross-region concurrent counting as needing care, and consult
  the current docs rather than assuming additive merge.

### 1.6 Metrics, likes, views, ad impressions

A huge fraction of "distributed counter" traffic is *approximate analytics*:
like counts, video views, ad-impression billing, page-view metrics. These almost
never use a strict CRDT. The dominant pattern is:

- **Per-process local counters** (each app instance or each StatsD/Prometheus
  client holds a monotonic integer) that are **summed centrally** by scraping or
  flushing. Convergence is by *re-aggregation*, not by merge — semantically
  similar to a G-Counter where the "actors" are server processes, which is a
  *bounded, named* actor set (see [§2](#2-the-actor-id-explosion-in-the-wild)).
- **Approximate counters** (HyperLogLog for uniques, Count-Min Sketch for
  heavy-hitters) where exactness is deliberately traded for tiny, bounded state.
- **Exactly-once-ish billing counters** (ad impressions, paid views) where the
  business *does* care about double-counting, so a dedupe layer
  (idempotency keys, log-compacted streams) sits in front of the aggregate.

The reason this matters: when someone says "we need a distributed counter," the
*first* question is **how wrong is wrong?** A like count can drift by 0.1% for a
minute and no one is harmed. An ad-billing counter that over-counts by 0.1% is
fraud-adjacent. The acceptable error budget decides whether you reach for a
sketch, a CRDT, or a serialized atomic counter with idempotency.

---

## 2. The actor-id explosion in the wild

The single most common way a CRDT-counter deployment goes wrong at scale is
**state-size blowup from too many actors**. The G-Counter math is `O(actors)` in
storage per counter; the PN-Counter is `O(2 × actors)`. When "actor" is bound to
something ephemeral and numerous — a mobile device, a browser session, a
short-lived serverless invocation — the vector grows without bound and the
*metadata* dwarfs the *value*.

### 2.1 Why the explosion happens

A correct G-Counter needs a **stable, unique actor id per writer** so that two
increments from the same writer are *idempotent on merge* (element-wise `max`
collapses them) while two increments from different writers *both count*. The
naive implementation gives every writer its own slot. If your writers are:

- **Server processes**: a few hundred to a few thousand actors. Manageable.
- **Mobile clients / browser sessions**: millions to hundreds of millions.
  Catastrophic.
- **Serverless invocations (new id per cold start)**: effectively unbounded —
  you mint a *fresh* actor on every cold start and never reuse it. This is the
  worst case and is alarmingly easy to do by accident (e.g.
  `actor_id = uuid4()` at module load).

### 2.2 Sizing math: bytes per slot × actors

A single slot in a G-Counter map is roughly:

```
slot ≈ actor_id (16 B for a UUID, or 8–20 B for a node name)
     + count     (8 B int64, or varint 1–9 B)
     + map/serialization overhead (≈ 8–40 B depending on encoding)
```

Take a conservative **40 bytes per actor slot** for a binary-encoded map (UUID
key + int64 + overhead). For a **PN-Counter**, double it to **80 bytes per
actor** (P and N maps). Now multiply:

| Actors per counter | G-Counter state | PN-Counter state | Verdict |
|---|---|---|---|
| 100 (server processes) | 4 KB | 8 KB | Fine |
| 1,000 | 40 KB | 80 KB | Fine, watch read cost |
| 10,000 | 400 KB | 800 KB | Large value; merges get slow |
| 100,000 | 4 MB | 8 MB | One key now ~ a small file |
| 1,000,000 (mobile fleet) | 40 MB | 80 MB | **One counter = 80 MB. Stop.** |
| 10,000,000 | 400 MB | 800 MB | **OOM territory; do not do this** |

Now consider the *system-wide* cost. If you have **10,000 distinct counters**
each accumulating per-client actors and the typical counter sees 5,000 distinct
clients:

```
per-counter PN state = 5,000 actors × 80 B = 400 KB
total                = 10,000 counters × 400 KB = 4 GB of metadata
```

…for counters whose actual *values* total a few kilobytes. The metadata-to-value
ratio is the number to watch. A healthy CRDT-counter deployment keeps it low; a
diseased one has gigabytes of actor slots backing a handful of integers.

And remember every merge and every read pays this cost: merging two 5,000-actor
PN-Counters is 10,000 `max` operations; a read sums 5,000 entries. At 1,000,000
actors those become 2,000,000-op merges — per replication round.

### 2.3 Mitigation 1 — server-side aggregation tiers (named actors)

The cleanest fix: **clients do not own slots; servers do.** Mobile and browser
clients send increments to an ingest tier; a *bounded, named* set of server
actors (one per ingest node, a few hundred at most) owns the CRDT slots.

```
millions of clients ──HTTP──▶  ingest node A (actor "ingest-A")  ─┐
                            ▶  ingest node B (actor "ingest-B")  ─┼─▶ CRDT counter
                            ▶  ingest node C (actor "ingest-C")  ─┘   (≤ N slots)
```

The actor set is now `O(ingest nodes)` — bounded and stable — regardless of how
many clients exist. The trade-off: the ingest node is a point where a
client-side retry can double-count, so you push **idempotency keys** to the
client→ingest hop (the ingest node dedupes per client request id before applying
the increment). This converts an unbounded-actor problem into a bounded-actor
problem plus a dedupe cache.

### 2.4 Mitigation 2 — handoff counters

A **handoff counter** lets an ephemeral actor *transfer* its accumulated count
into a stable actor's slot and then disappear, so its slot can be reclaimed. The
ephemeral actor accumulates locally, then performs a deterministic, idempotent
"handoff" that moves its contribution to a permanent actor and zeroes/forgets
its own. Done right, the count is preserved (no double-count, no loss) and the
slot is recyclable. This is the academically-studied "handoff counter" design;
it is more complex to implement correctly than server-side aggregation, so reach
for it only when you genuinely need clients to count offline and reconcile later.

### 2.5 Mitigation 3 — slot GC / tombstoning idle actors

If you *must* allow many actors, you need **slot garbage collection**: actors
that have been silent past a threshold and whose contribution has been *durably
absorbed* elsewhere can have their slots removed. This is dangerous because
naive removal can resurrect or lose counts under partition — you must ensure the
removed slot's value is preserved in a surviving actor and that no in-flight
older state can re-introduce the deleted slot (a tombstone with a version
guards against resurrection). GC is the part of CRDT-counter operations most
likely to introduce subtle bugs; budget for property tests
([§7](#7-observability-and-testing)) specifically around GC + partition.

### 2.6 Decision: who is an actor?

| If your writers are… | Make actors… | Because |
|---|---|---|
| A fixed fleet of servers | One per server/process | Bounded, stable, no GC needed |
| Mobile/browser clients | Server ingest nodes (aggregation tier) | Bounds state regardless of client count |
| Serverless functions | A bounded pool of *named* worker ids, not per-invocation | Avoids per-cold-start slot minting |
| Offline-first clients that must count locally | Handoff counters into stable actors | Preserves offline counts, recycles slots |

**Rule of thumb:** if the cardinality of your actor set is not bounded by
something you provision (nodes, shards), you have an explosion waiting to happen.

---

## 3. Hot keys and write contention

The dual of the actor explosion is the **hot key**: a single counter that
receives a firehose of increments. A celebrity posts; a product goes viral; a
breaking-news article is shared. Now one key is the write bottleneck for the
whole cluster.

### 3.1 Why CRDTs don't automatically save you

CRDT counters remove *coordination* (no locks, no consensus per increment), but
they do **not** remove *physical contention* on a single key/partition:

- Every increment still mutates the *same* CRDT object on the *same* replica
  set; that object's storage, lock, and replication path is a hot spot.
- The actor doing the incrementing on that replica still serializes its own
  writes to its own slot.
- Anti-entropy must ship that hot object's deltas constantly.

So the CRDT property buys *availability* and *partition tolerance*, but a viral
counter can still saturate the partition that owns it.

### 3.2 Sharding the counter (the core technique)

The standard fix is **counter sharding**: split one logical counter into `K`
physical sub-counters, increment a *random* (or hashed) shard, and **sum all
shards on read**.

```
logical "likes:post123"  ─┬─ shard 0  (CRDT counter)
                          ├─ shard 1  (CRDT counter)
                          ├─ …
                          └─ shard K-1

increment: pick s = rand(0,K)  →  inc shard s
read:      value = Σ shard i for i in [0,K)
```

This spreads write load across `K` keys (hence `K` partitions/replica sets),
turning one hot key into `K` warm keys. The read cost rises from one lookup to
`K` lookups, so `K` trades write throughput for read latency.

**Sizing K.** Pick `K` from the write rate and per-shard capacity:

```
K ≥ peak_increments_per_sec / per_shard_safe_write_rate
```

If a single CRDT counter key safely sustains ~2,000 increments/sec and a viral
post peaks at 200,000 likes/sec:

```
K ≥ 200,000 / 2,000 = 100 shards
```

…and a read now fans out to 100 sub-counters. If 100-way read fan-out is too
expensive, you either cache the read aggregate with a short TTL (likes can be a
few seconds stale) or maintain a periodically-materialized rollup. Most
like/view systems do exactly this: shard writes, cache the summed read.

| K (shards) | Write spread | Read fan-out | Use when |
|---|---|---|---|
| 1 | none | 1 lookup | cold counters |
| 16 | 16× | 16 lookups | moderately hot |
| 100 | 100× | 100 lookups (cache the sum) | viral |
| 1000 | 1000× | needs materialized rollup | extreme/global |

### 3.3 Batching and write coalescing

Orthogonal to sharding: **don't apply every increment individually.**

- **Client-side / edge coalescing.** Buffer increments for a short window
  (e.g. 100 ms–1 s) and apply the *sum* as one `+N`. A G-Counter slot doesn't
  care whether it went `+1` a hundred times or `+100` once; the slot value is
  the same. This is the single biggest lever for a hot key and it composes with
  sharding. The cost is a small staleness window and the risk of losing the
  buffered delta if the buffering node dies before flush — so buffer only what
  you can afford to lose, or persist the buffer.
- **Server-side coalescing.** The ingest tier accumulates per-actor deltas and
  flushes them to the CRDT store on a timer, dramatically reducing the
  write-op rate against the store.

Coalescing changes the *granularity* of an increment, not its correctness:
`+1 +1 +1` and `+3` are identical to a counter. (This is **only** true for
counters and other commutative-additive structures — do not generalize it.)

### 3.4 Combine the levers

A production "viral like counter" usually stacks all three:

```
edge coalescing (1s window, +N)
        │
        ▼
   K-way sharding (write random shard)
        │
        ▼
CRDT counters in the store (per-shard)
        │
        ▼
read = cached Σ shards (TTL 1–5s)
```

The result: a 200k/s firehose becomes a few thousand store writes per second
across `K` partitions, with reads served from a cached few-second-stale sum.
Nobody is harmed by a like count that's two seconds behind.

---

## 4. PN-Counter pitfalls and bounded counters

The PN-Counter's defining feature — and its defining danger — is that it is
**unbounded in both directions**. Increments and decrements are independent
monotonic streams; the value is their difference and **can go negative**, can be
made negative *concurrently*, and there is no built-in floor.

### 4.1 The unbounded-negative trap

Consider an inventory counter starting at 5 units, replicated across two regions
that partition:

```
Region A: stock = 5, sells 5 units  → 5 decrements → A sees 0
Region B: stock = 5, sells 5 units  → 5 decrements → B sees 0
partition heals → merge:  P = 5 (initial via inits), N = 10
value = 5 − 10 = −5
```

You sold **10 units of a 5-unit stock**. The PN-Counter did exactly what it
promised — it converged to `5 − 10 = −5` — but `−5 units of inventory` means you
oversold and someone is getting a refund and an apology. **A PN-Counter cannot
enforce a non-negativity invariant**, because enforcing "never below zero"
*requires coordination*: to know that a decrement is safe, you must know the
*global* current value, which is exactly the global knowledge an AP CRDT refuses
to require.

This is not a bug to fix; it's a theorem to respect. **Any invariant that
constrains the *combination* of replicas' states (a global lower bound, a global
budget, a balance ≥ 0) is not expressible by an unbounded CRDT counter alone.**

### 4.2 When you actually need a bounded / escrow counter

If the value is **inventory, account balance, rate-limit quota, ticket
availability, or any resource that must not go below (or above) a bound**, a raw
PN-Counter is the wrong tool. You need a **bounded counter** — typically an
**escrow** design (Balegas et al., "Putting Consistency Back into Eventual
Consistency").

The escrow idea:

- The total "right to decrement" (e.g. 100 units of stock) is **partitioned as
  escrow allocations among replicas**: A holds 40, B holds 35, C holds 25.
- Each replica may decrement **locally and without coordination** *as long as it
  has escrow left* — these decrements are safe because A can never spend B's
  escrow. The invariant (sum never below zero) is preserved *by construction*.
- When a replica **runs out of escrow**, it must **coordinate** — beg/borrow
  more from another replica or fall back to a synchronous path. This is the only
  time you pay coordination cost.

```
total decrement-budget = 100
        ├─ A escrow 40   (A spends freely until 0)
        ├─ B escrow 35
        └─ C escrow 25
A hits 0 → A coordinates with B to transfer some escrow, OR rejects locally
```

So the trade is explicit: **bounded counters give safety + mostly-local
operation, at the cost of occasional coordination when a replica's escrow is
exhausted or imbalanced.** That coordination is rare in the common case
(plenty of stock) and frequent near the boundary (last few units), which is
exactly the right place to spend it.

### 4.3 The coordination cost, quantified

| Counter type | Safety bound | Coordination per op | Behaviour at boundary |
|---|---|---|---|
| G-Counter | none (monotonic up only) | never | n/a |
| PN-Counter | **none** | never | silently goes negative |
| Escrow / bounded counter | enforced (≥ 0) | only on escrow exhaustion | local reject or coordinate to rebalance |
| Single-master atomic (DynamoDB/SQL row) | enforced | every op (serialized) | rejects when at floor |

The columns are the design space. A PN-Counter is cheapest and least safe; a
single-master row is safest and least available; the escrow counter is the
middle path that keeps the common case local while preserving the invariant.

### 4.4 Practical guidance

- **Likes, views, reactions, metrics, "people online"** → PN/G-Counter is great;
  negative is impossible-by-usage or harmless.
- **Inventory, balances, quotas, seat/ticket availability** → bounded/escrow
  counter, or accept a single-master serialized counter for those keys.
- **Never** clamp a PN-Counter's read at zero (`max(0, value)`) and call it
  bounded — that hides oversell, it doesn't prevent it. The decrements already
  happened; clamping just stops you from *seeing* the deficit.

---

## 5. Delta propagation and anti-entropy

State-based counters converge by **shipping state and merging**. The naive
state-based approach ships the *entire* counter on every gossip round, which for
a fat actor map is enormous bandwidth. **Delta-state CRDTs** fix this: ship only
the *changed slots* (the deltas) since the last successful exchange, and merge
those.

### 5.1 Why deltas matter for counters specifically

A counter that's incremented constantly but only on *one* actor's slot generates
a tiny delta (one slot) per round, even though the full state has thousands of
slots. Full-state shipping would send all thousands of slots every round just to
communicate one changed integer. The bandwidth difference:

```
full-state gossip:  actors × slot_size  per round
                  = 5,000 × 80 B        = 400 KB / round / peer
delta gossip:       changed_actors × slot_size
                  = ~1–5 × 80 B         ≈ 80–400 B / round / peer
```

Across a 10-node cluster gossiping every second, that's the difference between
~4 MB/s and a few KB/s **per counter**. With thousands of counters, deltas are
not an optimization — they're the difference between a working cluster and a
network meltdown.

### 5.2 Anti-entropy mechanics

Counters use the same anti-entropy machinery as any state CRDT:

- **Delta intervals / delta-buffers.** Each replica buffers the deltas it has
  produced and acknowledges which deltas a peer has seen, so it can re-send
  un-acked deltas (deltas can be lost; the buffer guarantees eventual delivery).
- **Periodic full-state reconciliation.** Because delta buffers can be GC'd and
  a long-partitioned node may have missed deltas that are no longer buffered, you
  fall back to an occasional **full-state merge** (Merkle-tree comparison in
  systems like Riak/Cassandra/Dynamo-style stores) to catch anything the delta
  stream missed. Full-state merge is idempotent for counters (it's just `max`),
  so it's always safe, just expensive.
- **Causal delta-merging caveat.** For *counters* the merge is `max` per slot,
  which is **idempotent and order-independent**, so you do *not* need
  causal-context bookkeeping that some other delta-CRDTs require (sets/maps with
  removals do). This makes delta counters one of the simplest delta-CRDTs to get
  right — a delta is just "slot X is now at least value V."

### 5.3 Bandwidth budgeting

| Variable | Effect on anti-entropy bandwidth |
|---|---|
| Gossip frequency | linear — halving frequency halves steady bandwidth, doubles convergence lag |
| Number of active actors | linear in *changed* slots per round (delta), or *total* slots (full reconcile) |
| Number of counters | linear |
| Fan-out (peers per round) | linear |

Budget: `steady ≈ counters × changed_slots × slot_size × fanout × gossip_hz`.
Tune gossip frequency against your convergence-lag SLO ([§6](#6-read-consistency-a-sum-is-a-snapshot));
faster gossip = tighter convergence but more bandwidth and CPU.

---

## 6. Read consistency: a sum is a snapshot

A counter read at the professional level deserves precise language: **a read
returns the sum of the actor slots *as that replica currently knows them*.** It
is a *local snapshot* of a globally-converging quantity. Three things follow.

### 6.1 Reads are stale by the convergence lag

If region A has applied 1,000 increments that haven't yet gossiped to region B,
a read on B is *low* by up to ~1,000. This is not an error — it's the eventual
in eventual consistency. The **convergence lag** (time from "increment applied
somewhere" to "all replicas reflect it") is bounded by your gossip frequency and
partition duration. Under normal operation it's sub-second to a few seconds;
under partition it's "until the partition heals."

Crucially, a counter read is **never *higher* than the true converged value**
under pure increments (each replica has seen a *subset* of increments, so its
sum is `≤` the converged sum). G-Counter reads are *monotonically
under-counting* approximations that ratchet toward truth. (For PN-Counters this
"always-low" guarantee weakens because a replica might have seen more decrements
than increments relative to another; reason about P and N separately.)

### 6.2 Monotonic-read vs stale-read

Two distinct consistency properties operators conflate:

- **Stale read.** Your read reflects an older converged state than the latest
  write. Inherent and expected for AP counters.
- **Monotonic reads (session guarantee).** *Within a single client/session*,
  successive reads never go *backwards*. A like count showing 1,050 then 1,047
  to the *same user* is jarring even though both are valid stale snapshots.

Pure CRDT counters give you **convergence**, not automatically **monotonic
reads**, if a client can be routed to different replicas with different lag. To
get monotonic reads you add **session stickiness** (pin a session to a replica)
or **read-your-writes tracking** (carry a version/vector and only accept reads
`≥` what you've seen). For a *single* G-Counter, per-replica reads are themselves
monotonic over time (slots only grow), so monotonic reads are mostly a
*routing* problem: don't bounce a session between replicas of differing lag.

### 6.3 Read-your-writes for counters

If a user clicks "like" and then sees the count *not* include their like
(because they read a lagging replica), they think it's broken. Fixes:

- **Sticky routing** to the replica that took the write for the duration of the
  session.
- **Client-side optimistic display**: show "your" increment locally and
  reconcile with the server value when it catches up (the UI shows
  `server_value` but visually adds the user's own pending increment).

### 6.4 The mental model to teach your team

> A distributed counter read is a **lower-bound estimate** (for pure increments)
> of a number that is still being assembled. It is *correct as a snapshot* and
> *converging toward truth*. Build product semantics that tolerate "a little
> behind, never wrong-direction-permanently," and never gate a hard invariant on
> a counter read.

That last clause is the bridge back to [§4](#4-pn-counter-pitfalls-and-bounded-counters):
"only sell if count > 0" is a hard invariant gated on a read, and a CRDT counter
read is a stale lower-bound — so the check can pass on a replica that hasn't seen
the decrements. That's the oversell incident in [§8](#8-incident-vignettes).

---

## 7. Observability and testing

You cannot operate counters you cannot see, and you cannot trust counters you
have not property-tested. This section is the operational backbone.

### 7.1 Metrics to emit (per counter and aggregate)

| Metric | What it tells you | Alert when |
|---|---|---|
| `slot_count` (actors per counter) | Actor-explosion early warning | p99 slot_count grows unbounded / exceeds budget |
| `state_bytes` per counter | Metadata cost | exceeds sizing target (e.g. > 1 MB) |
| `metadata_to_value_ratio` | Health of actor design | ratio climbs steadily |
| `replication_lag` / convergence lag | Staleness of reads | p99 lag > SLO |
| `read_skew` (max replica sum − min replica sum) | Divergence across replicas | skew not shrinking after partition heals |
| `merge_ops_per_sec` & merge duration | Anti-entropy CPU cost | merge time grows with slot_count |
| `delta_bytes_per_sec` | Anti-entropy bandwidth | exceeds budget |
| `hot_key_write_rate` | Hot-key detection | single key > per-shard safe rate |
| `negative_value_events` (PN) | Bound violations | any, if the counter should be ≥ 0 |

`read_skew` is the most *CRDT-specific* metric: read the same logical counter
from all replicas, report `max − min`. It should spike during partition and
**decay to ~0** after heal. A skew that never decays means anti-entropy is
broken (deltas lost and full-reconcile not catching up).

### 7.2 Property-based convergence tests

The non-negotiable test for any CRDT counter is the **convergence property**:
for *any* sequence of operations applied in *any* order to *any* partition of
replicas, after exchanging states all replicas reach the *same* value, and that
value equals the *sum of all increments minus all decrements*. Property-based
testing (generate random op sequences, random partitions, random merge orders)
is the right tool; example-based tests miss the reorderings that break things.
See the runnable test in [§9](#9-realistic-code-sharded-delta-state-pn-counter).

The properties to assert:

1. **Commutativity:** `merge(a, b) == merge(b, a)`.
2. **Associativity:** `merge(merge(a,b),c) == merge(a,merge(b,c))`.
3. **Idempotency:** `merge(a, a) == a`.
4. **Convergence:** any reachable partition + exchange → equal states.
5. **Value correctness:** converged value == Σ inc − Σ dec.
6. **GC safety (if implemented):** removing an absorbed actor's slot does not
   change the value and cannot be undone by a stale state.

### 7.3 Partition / chaos tests

- **Partition + concurrent writes + heal:** verify post-heal convergence and
  that `read_skew → 0`.
- **Message loss:** drop a fraction of deltas; verify full-reconcile recovers.
- **Duplicate delivery:** deliver the same op/delta twice; for a *true* CRDT
  counter this must be a no-op (idempotent). This is the test that would have
  caught the Cassandra-style double-count.
- **Clock skew:** counters don't depend on wall-clock for correctness (no
  timestamps in the merge), so clock skew should *not* affect value — assert it
  doesn't (a good regression guard if someone "improves" the design with
  timestamps).

---

## 8. Incident vignettes

Anonymized, composited from real-shaped failures. Each maps to a section above.

### 8.1 Double-count from non-idempotent delivery

**Symptom.** A billing-adjacent "events processed" counter read ~3% high during
a network-flap window; finance flagged the discrepancy.

**Root cause.** The system used a counter store whose increment was **not
idempotent** (a read-before-write style, Cassandra-counter-class — see
[§1.4](#14-cassandra-counters-not-a-clean-crdt)). The client driver retried
increments on coordinator timeout. During a flap, many increments timed out
*after* being applied and were retried → applied twice.

**Fix.** (a) Stop retrying non-idempotent counter writes blindly. (b) Move
hot, correctness-sensitive counting to a *true* CRDT counter (per-actor slots,
idempotent `max` merge) **or** put an idempotency key in front so a retry is a
no-op. (c) Add the **duplicate-delivery property test** from
[§7.3](#73-partition--chaos-tests) so any future regression is caught in CI.

**Lesson.** "Atomic increment" ≠ "idempotent increment." Retries + non-idempotent
counters = silent double-count. A true CRDT counter is idempotent on merge *by
construction*; that property is the whole reason to pay the actor-id cost.

### 8.2 Metadata OOM from actor explosion

**Symptom.** Replicas began OOM-killing during anti-entropy; one "feature usage"
counter had a serialized state of **~600 MB**.

**Root cause.** The actor id was `uuid4()` minted **per client session**. Over
months the per-counter actor map accumulated **millions** of dead slots (every
session that ever incremented, forever). State size = `actors × 80 B`; at
~7.5 M sessions that's ~600 MB for a single PN-Counter whose *value* was a
7-digit integer. Every merge was a 15-million-op `max` join.

**Fix.** (a) Re-key actors to a **bounded server ingest tier**
([§2.3](#23-mitigation-1--server-side-aggregation-tiers-named-actors)) — a few
hundred named actors instead of millions of session ids. (b) Migrate the live
value by summing the old map once and seeding it into the new bounded-actor
counter. (c) Add `slot_count` and `state_bytes` alerts
([§7.1](#71-metrics-to-emit-per-counter-and-aggregate)) so the next explosion
trips an alert at 10 K slots, not at OOM.

**Lesson.** Per-client/per-session/per-invocation actor ids are the #1 CRDT
counter footgun. Bound the actor set to something you provision.

### 8.3 Negative inventory from PN-Counter misuse

**Symptom.** A flash sale oversold a limited item; the inventory counter read
`−47`. Customers were charged for stock that didn't exist.

**Root cause.** Inventory was modeled as a **PN-Counter** with "sell =
decrement," and availability checked `value > 0` on a *local replica read*.
During a brief partition, multiple regions each saw stock `> 0` (stale,
[§6.1](#61-reads-are-stale-by-the-convergence-lag)), each sold the "remaining"
units, and the converged value went negative
([§4.1](#41-the-unbounded-negative-trap)). The non-negativity invariant was never
enforceable by a PN-Counter.

**Fix.** (a) Replace the PN-Counter with a **bounded/escrow counter**
([§4.2](#42-when-you-actually-need-a-bounded--escrow-counter)): partition the
sellable stock as escrow among regions; a region sells locally only while it has
escrow, and coordinates when exhausted. (b) For the final scarce units, fall back
to a single-master serialized path. (c) Add a `negative_value_events` alert that
pages immediately.

**Lesson.** A hard global invariant (`stock ≥ 0`, `balance ≥ 0`) cannot ride on
an unbounded CRDT counter + a stale read. Use escrow/bounded counters, and never
clamp-at-zero to "fix" it — clamping hides the oversell that already happened.

---

## 9. Realistic code: sharded delta-state PN-Counter

A runnable Python implementation of a **delta-state PN-Counter** with a
**sharded** front for hot keys and **anti-entropy** between replicas, plus a
**property-based convergence test**. The code is dependency-light: the core uses
only the standard library; the property test uses `hypothesis` (a `pytest`-free
fallback driver is included so it also runs with plain `python`).

```python
"""
Sharded delta-state PN-Counter with anti-entropy.

Design:
  - PNCounter: two G-Counters (P, N) keyed by actor id; value = sum(P)-sum(N).
  - Delta-state: inc/dec produce a *delta* (a tiny PNCounter touching one slot);
    merge is element-wise max on both P and N (idempotent, commutative, assoc).
  - ShardedPNCounter: K independent PNCounters; increments hit a chosen shard;
    read sums all shards. Spreads write contention across shards/partitions.
  - Replica: owns one actor id; buffers un-acked deltas for anti-entropy.

All merges are `max` per slot, so deltas need no causal context: a delta simply
asserts "actor a's P (or N) is at least v".
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, Iterable, Tuple
import random


# --------------------------------------------------------------------------
# Core G-Counter and PN-Counter (state-based, with delta production)
# --------------------------------------------------------------------------

@dataclass
class GCounter:
    # actor_id -> monotonically increasing count
    slots: Dict[str, int] = field(default_factory=dict)

    def value(self) -> int:
        return sum(self.slots.values())

    def inc(self, actor: str, n: int = 1) -> "GCounter":
        if n < 0:
            raise ValueError("GCounter increments must be non-negative")
        self.slots[actor] = self.slots.get(actor, 0) + n
        # delta: just this actor's new value
        return GCounter({actor: self.slots[actor]})

    @staticmethod
    def merge(a: "GCounter", b: "GCounter") -> "GCounter":
        out: Dict[str, int] = dict(a.slots)
        for actor, v in b.slots.items():
            if v > out.get(actor, 0):
                out[actor] = v  # element-wise max
        return GCounter(out)

    def slot_count(self) -> int:
        return len(self.slots)


@dataclass
class PNCounter:
    P: GCounter = field(default_factory=GCounter)
    N: GCounter = field(default_factory=GCounter)

    def value(self) -> int:
        return self.P.value() - self.N.value()

    def inc(self, actor: str, n: int = 1) -> "PNCounter":
        dp = self.P.inc(actor, n)
        return PNCounter(P=dp, N=GCounter())

    def dec(self, actor: str, n: int = 1) -> "PNCounter":
        # NOTE: unbounded below by design; see professional.md sec.4
        dn = self.N.inc(actor, n)
        return PNCounter(P=GCounter(), N=dn)

    @staticmethod
    def merge(a: "PNCounter", b: "PNCounter") -> "PNCounter":
        return PNCounter(
            P=GCounter.merge(a.P, b.P),
            N=GCounter.merge(a.N, b.N),
        )

    def slot_count(self) -> int:
        # distinct actors across P and N (state-size proxy)
        return len(set(self.P.slots) | set(self.N.slots))

    def state_bytes(self, bytes_per_slot: int = 80) -> int:
        return self.slot_count() * bytes_per_slot


# --------------------------------------------------------------------------
# Sharded PN-Counter (hot-key mitigation)
# --------------------------------------------------------------------------

@dataclass
class ShardedPNCounter:
    K: int
    shards: list = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.shards:
            self.shards = [PNCounter() for _ in range(self.K)]

    def inc(self, actor: str, n: int = 1, rng: random.Random | None = None):
        s = (rng or random).randrange(self.K)
        delta = self.shards[s].inc(actor, n)
        return s, delta  # caller ships (shard_index, delta) to peers

    def dec(self, actor: str, n: int = 1, rng: random.Random | None = None):
        s = (rng or random).randrange(self.K)
        delta = self.shards[s].dec(actor, n)
        return s, delta

    def value(self) -> int:
        # read = sum across all shards
        return sum(shard.value() for shard in self.shards)

    def merge_shard(self, s: int, delta: PNCounter) -> None:
        self.shards[s] = PNCounter.merge(self.shards[s], delta)

    def total_slot_count(self) -> int:
        return sum(shard.slot_count() for shard in self.shards)


# --------------------------------------------------------------------------
# Replica + anti-entropy
# --------------------------------------------------------------------------

@dataclass
class Replica:
    actor: str
    counter: ShardedPNCounter
    # per-shard un-acked deltas this replica has produced/seen, to gossip:
    delta_buffer: list = field(default_factory=list)  # list[(shard, PNCounter)]
    rng: random.Random = field(default_factory=random.Random)

    def inc(self, n: int = 1) -> None:
        s, delta = self.counter.inc(self.actor, n, self.rng)
        self.delta_buffer.append((s, delta))

    def dec(self, n: int = 1) -> None:
        s, delta = self.counter.dec(self.actor, n, self.rng)
        self.delta_buffer.append((s, delta))

    def value(self) -> int:
        return self.counter.value()

    def export_deltas(self) -> list:
        """Deltas to send to a peer (buffer kept until peer acks)."""
        return list(self.delta_buffer)

    def apply_deltas(self, deltas: Iterable[Tuple[int, PNCounter]]) -> None:
        for s, delta in deltas:
            self.counter.merge_shard(s, delta)

    def full_state(self) -> ShardedPNCounter:
        """Fallback full-state reconcile (always-safe idempotent merge)."""
        return self.counter

    def merge_full(self, other: ShardedPNCounter) -> None:
        for s in range(self.counter.K):
            self.counter.shards[s] = PNCounter.merge(
                self.counter.shards[s], other.shards[s]
            )


def anti_entropy_round(a: Replica, b: Replica) -> None:
    """One bidirectional delta exchange between two replicas."""
    da, db = a.export_deltas(), b.export_deltas()
    b.apply_deltas(da)
    a.apply_deltas(db)
    # (In production: acks let each side GC its buffer once the peer confirms.)


def full_reconcile(a: Replica, b: Replica) -> None:
    """Occasional full-state reconcile to catch lost/expired deltas."""
    a.merge_full(b.full_state())
    b.merge_full(a.full_state())


# --------------------------------------------------------------------------
# Quick self-test (run: python this_file.py)
# --------------------------------------------------------------------------

def _demo() -> None:
    K = 8
    base = ShardedPNCounter(K)
    a = Replica("node-A", ShardedPNCounter(K, [PNCounter.merge(s, PNCounter())
                                               for s in base.shards]))
    b = Replica("node-B", ShardedPNCounter(K))
    c = Replica("node-C", ShardedPNCounter(K))

    # Concurrent activity on three "partitioned" replicas:
    for _ in range(100):
        a.inc()
    for _ in range(40):
        b.inc()
    for _ in range(25):
        c.dec()  # decrements -> value can dip

    # Before reconcile, replicas disagree (stale local snapshots):
    print("pre-merge:", a.value(), b.value(), c.value())

    # Heal: exchange deltas pairwise, then a full reconcile to be safe.
    anti_entropy_round(a, b)
    anti_entropy_round(b, c)
    anti_entropy_round(a, c)
    full_reconcile(a, b)
    full_reconcile(b, c)
    full_reconcile(a, c)

    print("post-merge:", a.value(), b.value(), c.value())
    assert a.value() == b.value() == c.value()
    assert a.value() == 100 + 40 - 25  # == Σinc − Σdec == 115
    print("converged value:", a.value(), "(expected 115)")
    print("total slots:", a.counter.total_slot_count())


if __name__ == "__main__":
    _demo()
```

### 9.1 Property-based convergence test

```python
"""
Property-based convergence test for the sharded delta-state PN-Counter.

Properties asserted:
  - convergence: any partition + arbitrary merge order -> equal states
  - value correctness: converged value == sum(inc) - sum(dec)
  - idempotency: re-applying the same deltas changes nothing
  - commutativity of merge

Run with hypothesis if available:   pytest test_counter.py
Or as a script (built-in fuzz loop): python test_counter.py
"""

import random
from typing import List, Tuple

# import the module above as `counter`
# from counter import PNCounter, GCounter, ShardedPNCounter, Replica, \
#     anti_entropy_round, full_reconcile


def _build_replicas(names: List[str], K: int) -> List["Replica"]:
    return [Replica(name, ShardedPNCounter(K), rng=random.Random(hash(name)))
            for name in names]


def _apply_ops(replicas, ops: List[Tuple[int, int, int]]) -> int:
    """ops = list of (replica_index, kind, amount); kind 0=inc,1=dec.
       Returns expected converged value (Σinc - Σdec)."""
    expected = 0
    for idx, kind, amount in ops:
        r = replicas[idx % len(replicas)]
        if kind == 0:
            r.inc(amount)
            expected += amount
        else:
            r.dec(amount)
            expected -= amount
    return expected


def _reconcile_all(replicas) -> None:
    # gossip every pair both ways, then a full reconcile pass (idempotent).
    for i in range(len(replicas)):
        for j in range(i + 1, len(replicas)):
            anti_entropy_round(replicas[i], replicas[j])
    for i in range(len(replicas)):
        for j in range(i + 1, len(replicas)):
            full_reconcile(replicas[i], replicas[j])


def check_convergence(seed: int) -> None:
    rng = random.Random(seed)
    n_replicas = rng.randint(2, 5)
    K = rng.choice([1, 4, 8, 16])
    names = [f"node-{i}" for i in range(n_replicas)]
    replicas = _build_replicas(names, K)

    n_ops = rng.randint(0, 200)
    ops = [(rng.randrange(n_replicas), rng.randint(0, 1), rng.randint(0, 5))
           for _ in range(n_ops)]
    expected = _apply_ops(replicas, ops)

    _reconcile_all(replicas)

    values = [r.value() for r in replicas]
    # convergence: all equal
    assert len(set(values)) == 1, f"not converged: {values} (seed={seed})"
    # value correctness
    assert values[0] == expected, \
        f"value {values[0]} != expected {expected} (seed={seed})"

    # idempotency: reconciling again changes nothing
    before = [r.value() for r in replicas]
    _reconcile_all(replicas)
    after = [r.value() for r in replicas]
    assert before == after, f"not idempotent (seed={seed})"


# ---- hypothesis variant (preferred when installed) -----------------------
try:
    from hypothesis import given, settings, strategies as st

    @settings(max_examples=300)
    @given(seed=st.integers(min_value=0, max_value=2**31 - 1))
    def test_convergence_property(seed):
        check_convergence(seed)

except ImportError:  # pragma: no cover
    pass


# ---- standalone fuzz driver (no pytest/hypothesis needed) -----------------
if __name__ == "__main__":
    for s in range(2000):
        check_convergence(s)
    print("OK: 2000 random convergence scenarios passed")
```

What the test buys you: it exercises **random replica counts, random shard
counts, random op streams, and full reconcile order**, then asserts every
replica converged to *exactly* `Σinc − Σdec` and that re-merging is a no-op. This
is the test that catches a merge that isn't actually `max`, a delta that loses a
slot, or a non-idempotent path — the exact failure classes behind the incidents
in [§8](#8-incident-vignettes).

> Note the test deliberately allows the value to go negative (decrements can
> exceed increments). That is *correct* for a PN-Counter and is precisely why you
> must **not** model a non-negative invariant on one — see
> [§4](#4-pn-counter-pitfalls-and-bounded-counters).

---

## 10. Sizing, SLOs, and checklists

### 10.1 Capacity / sizing table

Assume **80 bytes per PN-Counter actor slot** (UUID/actor key + two int64s +
overhead). Plan with this table; measure the real `bytes_per_slot` in your
encoding and re-scale.

| Scenario | Actors/counter | Counters | State/counter | Total state | Verdict |
|---|---|---|---|---|---|
| Server-aggregated metrics | 200 | 50,000 | 16 KB | ~800 MB | OK; bounded actors |
| Like counts (sharded, K=16) | 200 × 16 shards | 1,000,000 | 256 KB | huge | shard count drives it — cache reads, GC dead posts |
| Inventory (escrow, bounded) | 50 regions | 100,000 | 4 KB | ~400 MB | OK; bounded + escrow |
| **Per-client actors (anti-pattern)** | 5,000,000 | 10,000 | 400 MB | **4 TB** | **do not** — explosion |

Hot-key write sizing (from [§3](#3-hot-keys-and-write-contention)):

```
K (shards)            ≥ peak_inc_per_sec / per_shard_safe_write_rate
coalesce_window       set so (peak_inc_per_sec × window) is an acceptable
                      loss-on-crash and an acceptable staleness
read_cost             = K lookups (cache the sum if K large)
```

Anti-entropy bandwidth ([§5](#5-delta-propagation-and-anti-entropy)):

```
steady_bps ≈ counters × changed_slots_per_round × slot_size
                       × fanout × gossip_hz
reconcile_cost (periodic) ≈ counters × total_slots × slot_size × fanout
```

### 10.2 Suggested SLOs

| SLO | Target (example) | Rationale |
|---|---|---|
| Convergence lag (steady) | p99 < 2 s | reads "a little behind, never wrong-direction" |
| Convergence lag (post-partition) | p99 < 30 s after heal | bounded recovery |
| `read_skew` decay after heal | → 0 within 60 s | proves anti-entropy works |
| Max actor slots / counter | < 1,000 (alert at 80%) | actor-explosion guardrail |
| Max state bytes / counter | < 1 MB (alert at 80%) | metadata guardrail |
| Negative-value events (bounded counters) | 0 | invariant must hold |
| Double-count rate (billing counters) | 0 (idempotent path) | correctness |

### 10.3 Design checklist (before you ship a counter)

- [ ] **How wrong is wrong?** Decide the error budget (exact / approximate /
      billing-grade). This picks CRDT vs sketch vs serialized.
- [ ] **Who is the actor?** Bounded, provisioned set (servers/shards), *never*
      per-client/per-session/per-invocation. Documented and enforced.
- [ ] **Is there a hard invariant** (≥ 0, ≤ cap, balance)? If yes →
      bounded/escrow counter or single-master, **not** a raw PN-Counter.
- [ ] **Hot-key plan:** sharding `K` sized from peak write rate; coalescing
      window chosen; read fan-out cached if `K` large.
- [ ] **Delta-state + anti-entropy** chosen over full-state gossip; full
      reconcile scheduled as a backstop.
- [ ] **Idempotency**: every write path is idempotent (CRDT merge) or fronted by
      an idempotency key; retries are *known-safe*.
- [ ] **Read semantics** documented: stale lower-bound; session stickiness /
      read-your-writes if users need monotonic reads.

### 10.4 Operational checklist (running counters)

- [ ] Metrics emitting: `slot_count`, `state_bytes`,
      `metadata_to_value_ratio`, `replication_lag`, `read_skew`,
      `merge_ops`, `delta_bytes`, `hot_key_write_rate`,
      `negative_value_events`.
- [ ] Alerts on actor-slot and state-byte growth (catch explosions *before* OOM).
- [ ] Alert on `read_skew` that doesn't decay after a partition heals.
- [ ] **Property test** (convergence/idempotency/value) in CI.
- [ ] **Chaos tests**: partition+heal, message loss, duplicate delivery, clock
      skew — in a recurring suite, not just once.
- [ ] Runbook: actor explosion → re-key to bounded tier + migrate value;
      hot key → bump `K` / widen coalesce window; negative bounded counter →
      page + escrow rebalance / single-master fallback.
- [ ] Slot GC (if used) is property-tested against partition resurrection.

### 10.5 Tool-selection decision table

| Requirement | Reach for |
|---|---|
| Multi-master, additive, no hard bound (likes/views/metrics) | G/PN-Counter CRDT (Riak DT, Redis CRDB) |
| Multi-region active-active counting | Redis Enterprise CRDB counters |
| Hard floor/cap invariant (inventory, balance, quota) | Escrow/bounded counter, or single-master serialized |
| Single-region atomic counter with idempotency layer | DynamoDB `ADD` + idempotency key, or SQL row |
| Approximate uniques / heavy hitters | HyperLogLog / Count-Min Sketch (tiny state) |
| Billing-grade exact count | Idempotent ingest + log-compacted stream + reconciliation |
| Eventual, mostly-right replicated count (caveats OK) | Cassandra `counter` — *with* the no-blind-retry rule |

---

## 11. Cheat sheet

```
GROWTH / SIZING
  G-Counter state  = actors × slot_size            (slot ≈ 40 B encoded)
  PN-Counter state = actors × 2 × slot_size         (slot pair ≈ 80 B)
  metadata:value ratio is the health number — keep it low
  1M per-client actors × 80 B = 80 MB FOR ONE COUNTER → don't

ACTORS
  actor MUST be bounded & provisioned (servers/shards), NEVER per-client/
    per-session/per-invocation
  mitigations: server aggregation tier > handoff counters > slot GC
  uuid4() per session/cold-start = the #1 explosion footgun

HOT KEY
  shard into K sub-counters; inc random shard; read = Σ shards
  K ≥ peak_inc_per_sec / per_shard_safe_rate
  coalesce: +1+1+1 == +3 (counters only); buffer window = staleness budget
  cache the summed read if K is large

PN PITFALL
  unbounded below: value CAN and WILL go negative under concurrency
  hard invariant (≥0, balance, inventory) → NOT a PN-Counter
    → escrow/bounded counter (Balegas) or single-master serialized
  clamping max(0, v) HIDES oversell, doesn't prevent it

ANTI-ENTROPY
  delta-state (ship changed slots) >> full-state gossip
  counter deltas need NO causal context (merge = max, idempotent)
  periodic full reconcile (Merkle) as backstop for lost/expired deltas

READS
  read = LOCAL SNAPSHOT SUM = stale lower-bound (pure inc) of converging value
  convergence > monotonic reads; monotonic needs sticky routing / RYW
  never gate a hard invariant on a stale counter read

NOT-A-CRDT WATCHLIST
  Cassandra counter  = read-before-write, retry => DOUBLE COUNT; not a CRDT
  DynamoDB ADD       = single-master atomic, not idempotent; layer idempotency
  open-source Redis INCR = single-node atomic, async LWW failover; not multi-master CRDT
  TRUE CRDT counters = Riak DT, Redis Enterprise CRDB

TEST
  property: commutative + associative + idempotent + converges to Σinc−Σdec
  chaos: partition+heal, msg loss, DUPLICATE delivery (must be no-op), clock skew
```

---

## 12. Summary

- **Real CRDT counters ship in Riak DT and Redis Enterprise CRDB.** Bet365's use
  of Riak DT for betting totals is the canonical "counters chosen for
  write-availability under partition" reference.
- **Several "counters" are *not* CRDTs.** Cassandra `counter` columns use
  read-before-write and were historically non-idempotent under retry
  (double-count risk); DynamoDB atomic counters are single-master and atomic by
  *serialization*, not commutativity; open-source Redis `INCR` is single-node.
  Know which class you're holding — it determines your failure modes.
- **The actor-id explosion is the #1 operational hazard.** State is
  `O(actors)`; per-client/per-session/per-invocation actors blow it to gigabytes.
  Bind actors to a provisioned set (server aggregation tier), use handoff
  counters for offline-first, and GC slots carefully. Do the bytes math.
- **Hot keys need sharding + coalescing.** Split one counter into `K` summed
  sub-counters, batch increments (`+1+1 == +2` for counters), cache the read.
- **PN-Counters are unbounded below by design.** Any hard invariant (inventory,
  balance, quota) needs a **bounded/escrow counter** (Balegas) or a single-master
  path — and pays coordination only at the boundary. Clamping at zero hides
  oversell; it does not prevent it.
- **Delta-state + anti-entropy** keeps bandwidth sane; counter deltas need no
  causal context because the merge is idempotent `max`.
- **A read is a stale lower-bound snapshot.** Engineer product semantics around
  "a little behind, never permanently wrong-direction," add session stickiness
  for monotonic reads, and never gate an invariant on a counter read.
- **Observe and property-test relentlessly:** `slot_count`, `state_bytes`,
  `read_skew`, `replication_lag`; convergence/idempotency/duplicate-delivery
  tests in CI.

For the algebra and proofs, revisit [CRDT Fundamentals](../01-crdt-fundamentals/professional.md)
and [State vs Op CRDTs](../02-state-vs-operation-based-crdts/professional.md). For
gentler treatments of the same topic see [junior](junior.md), [middle](middle.md),
and [senior](senior.md); for rapid-fire revision, [interview](interview.md).

---

## 13. Further reading

- **Riak DT documentation** — `riak_dt` data types, including
  `riak_dt_gcounter` and `riak_dt_pncounter`; the production reference for
  honest CRDT counters and the actor-id model.
- **Redis Enterprise Active-Active (CRDB) whitepaper / docs** — how counters are
  implemented as CRDTs for multi-region active-active, and the additive-merge vs
  overwrite semantics for counter keys.
- **Apache Cassandra counters — design notes & docs** — the read-before-write
  history, the non-idempotent-retry hazard, and the later (≈2.1) redesign;
  essential reading for *why Cassandra counters are not a clean CRDT*.
- **Shapiro, Preguiça, Baquero, Zawirski — "A Comprehensive Study of Convergent
  and Commutative Replicated Data Types"** (INRIA RR-7506) — the foundational
  CvRDT/CmRDT paper, G/PN-Counter definitions and proofs.
- **Almeida, Shoker, Baquero — "Delta State Replicated Data Types"** — the
  delta-state model used in [§5](#5-delta-propagation-and-anti-entropy) and the
  [§9](#9-realistic-code-sharded-delta-state-pn-counter) code.
- **Balegas et al. — "Putting Consistency Back into Eventual Consistency"** and
  related **bounded counters / escrow** work — the principled answer to PN-Counter
  inventory/balance pitfalls in [§4](#4-pn-counter-pitfalls-and-bounded-counters).
- **DynamoDB developer guide — atomic counters & conditional writes** — the
  single-master, non-idempotent atomic increment, and how to make it safe with
  idempotency/conditional expressions.
- **"Handoff Counters" (Almeida & Baquero)** — the actor-slot-recycling design
  referenced in [§2.4](#24-mitigation-2--handoff-counters).
