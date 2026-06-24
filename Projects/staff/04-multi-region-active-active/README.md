# Multi-Region Active-Active Service

> Run one service in two or three regions at once, route every user to the
> nearest one, and accept writes everywhere. Then face the bill: concurrent
> writes to the same key in different regions, and a region that vanishes
> mid-traffic. You will trade strong global consistency for latency and
> survival — deliberately, per data class, and with measured proof.

| | |
|---|---|
| **Tier** | Staff (geo-distributed systems) |
| **Primary domain** | Geo-distributed / replicated systems |
| **Skills exercised** | CAP/PACELC reasoning, async replication, conflict resolution (LWW / CRDT / app-merge), causal consistency, idempotency, geo-routing & data residency, failover/failback, Go |
| **Interview sections** | 13 (distributed systems), 22 (scalability & HA), 20 (cloud) |
| **Est. effort** | 5–8 focused days |

---

## 1. Context

You own a user-facing service — say a profile + preferences + activity-counter
backend — for a product with users on three continents. Today it lives in one
region. European users see 120 ms write latency, and last quarter that region
had a 40-minute control-plane outage that took the whole product down. Leadership
wants two things that pull in opposite directions: **single-digit-millisecond
local latency for every user**, and **survive a full region loss with no manual
DNS surgery and no lost user data.**

The only way to get both is **active-active**: every region accepts reads *and*
writes locally, and regions replicate to each other asynchronously. The instant
you do that, you have given up strong global consistency for most of your data —
two regions can accept conflicting writes to the same key within the replication
window. This lab is about confronting that head-on: deciding *which* data can
tolerate it, choosing a conflict-resolution strategy *per data class*, and
proving the system converges after partitions and survives failover. You will
produce convergence proofs and latency numbers, not architecture diagrams.

## 2. Goals / Non-goals

**Goals**
- Stand up **2–3 simulated regions** with realistic inter-region latency
  (50–150 ms RTT) and accept writes in every region.
- Classify your data into consistency tiers and pick a resolution strategy for
  each: **LWW**, **CRDT**, **application merge**, or **regional ownership**
  (strong-where-it-must-be).
- Demonstrate the failure of naive choices: concurrent conflicting writes
  resolved by **LWW that loses an update**, then the same workload on a **CRDT
  that converges** — with measured results.
- Survive a **region failover under live load** and a **cross-region partition
  (split-brain)**, then prove convergence after heal.
- Measure the real trade: **local read/write p99** vs **cross-region replication
  lag** vs **RPO/RTO on failover**.

**Non-goals**
- Real cloud multi-region spend. Simulate regions as containers/namespaces with
  injected latency (toxiproxy / `tc netem`); the consistency physics are identical.
- A globally-strong database (Spanner/CockroachDB) as a black box. You may *cite*
  it, but the point is to build the conflict logic yourself so you understand it.
- Multi-region Kafka / MirrorMaker (that's the streaming lab). Replication here is
  your own change-shipping layer.

## 3. Functional requirements

1. A **regional service binary** (`cmd/region`) runs N instances, one per
   simulated region (`-region=us`, `eu`, `ap`), each with its own local store.
   Every instance accepts the full read+write API locally.
2. A **replicator** ships local writes to peer regions asynchronously
   (`cmd/replicator`, or an internal goroutine), applying conflict resolution on
   receipt. Replication is **at-least-once** and must be **idempotent** on apply.
3. The service handles at least **four data classes**, each with its declared
   consistency model (see §7/§8):
   - **Profile fields** (LWW register) — last writer wins, lost-update risk owned.
   - **Activity counter** (CRDT PN-Counter) — increments from all regions merge.
   - **Tag set / followers** (CRDT OR-Set) — add/remove converge without coordination.
   - **Username / unique handle** (strongly consistent via **regional ownership**)
     — exactly one region owns the keyspace shard; others forward.
4. A **geo-router** (`cmd/router` or client logic) sends each request to its
   nearest healthy region (latency-based) and **fails over** to the next when a
   region is down.
5. A **chaos hook** (`cmd/chaos`) can: kill a region, partition two regions from
   each other (heal later), and inject/raise inter-region latency.

## 4. Load & data profile

- **Regions:** 2 minimum, 3 target (`us`, `eu`, `ap`). Inter-region RTT injected:
  ~80 ms us↔eu, ~150 ms us↔ap, ~120 ms eu↔ap (use toxiproxy `latency` or
  `tc qdisc ... netem delay`). Jitter ±10 ms.
- **Volume:** ≥ **50M total writes** across runs; one sustained run ≥ 30 min at
  target rate (start ~2–5k writes/s aggregate, find your ceiling).
- **Key distribution:** **Zipfian** (s≈1.1) over 10M keys so some keys are hot —
  hot keys are exactly where cross-region conflicts cluster. The generator
  deliberately drives **concurrent writes to the same key from two regions**.
- **Conflict workload:** a dedicated mode fires `write(key=K, region=us)` and
  `write(key=K, region=eu)` within the replication window (sub-RTT apart) so
  conflicts are guaranteed, not incidental.
- **Generator:** `cmd/gen` is deterministic given a seed; conflict pairs are
  reproducible so LWW-vs-CRDT runs compare like-for-like.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Local read p99 (request served by nearest region) | < 10 ms |
| Local write p99 (committed locally, not awaiting peers) | < 15 ms |
| Cross-region replication lag p50 / p99 (steady state) | < 1 s p50, < 3 s p99; **bounded & flat**, not rising |
| Read-your-writes **within** a region (sticky session) | 100% — a client pinned to its region always sees its own write |
| Convergence after partition heal | 100% of conflicting keys converge to one agreed value; report time-to-converge |
| **RPO on region failover** (data lost) | CRDT/OR-Set/counter: **0**. LWW: ≤ replication lag at failure (state it). Strong/owned data: **0** |
| **RTO on region failover** (time to serve from peer) | < 10 s automatic (geo-router health-check + reroute); no manual DNS edit |
| Duplicate-apply rate after failover replay | **0** observable effect (idempotent apply) |

> The lab's deliverable is not one number — it's a **per-data-class consistency
> ledger**: for each class, the model chosen, the RPO it implies, and the
> measured local latency win that justifies it.

## 6. Architecture constraints & guidance

- Each region = its own process + own datastore (Postgres or embedded KV per
  region; **no shared database** — that would defeat the point). Run via
  `docker-compose`, one stack per region, pinned versions.
- **Latency simulation is mandatory and explicit:** put inter-region links behind
  **toxiproxy** (per-link latency toxics) or `tc netem`. Local intra-region calls
  stay fast. Commit the latency matrix.
- **Replication is async and causal-aware:** ship writes with a logical clock
  (**version vector** / Lamport timestamp + region id). Apply must be idempotent
  (keyed by `(region, seq)` or by CRDT merge being naturally idempotent).
- Go service. Recommended: standard `net/http`, a per-region store interface, and
  a CRDT package you write (PN-Counter, OR-Set, LWW-Register) so the merge logic
  is *yours* — relate it to the DSA CRDT material
  (`Roadmap/.../26-distributed-data-structures`).
- Instrument with Prometheus: local p50/p99 read+write, per-link replication lag,
  conflict count, conflict-resolution outcome (LWW-overwrite vs CRDT-merge),
  failover detection time.

## 7. Data model (consistency tiers)

Each key carries metadata for resolution. Pick the **minimum** model per class —
strong consistency is a cost, not a default.

```
# Class A — Profile (LWW-Register): last write wins; CONCEDES lost updates
profile(key, value, ts_hlc, origin_region)
  resolve(a, b) = a if a.ts_hlc > b.ts_hlc else b      # ties broken by region id
  # DANGER: two regions edit different fields of the "same" blob -> one is lost

# Class B — Activity counter (PN-Counter CRDT): all increments survive
counter(key) = { P: map[region]uint64, N: map[region]uint64 }
  value      = sum(P) - sum(N)
  merge(a,b) = elementwise-max(P), elementwise-max(N)   # commutative, idempotent

# Class C — Tags / followers (OR-Set CRDT): concurrent add/remove converge
orset(key)  = { adds: set[(elem, tag)], removes: set[tag] }
  add(e)    -> adds += (e, unique_tag())
  remove(e) -> removes += {tags of e seen so far}        # add-wins on concurrency
  merge     = union(adds), union(removes)

# Class D — Username / handle (STRONG, regional ownership): no CRDT, no LWW
owner(shard) = region        # one region owns each handle-shard
  writes to a handle are ROUTED to its owner region (forward if not local)
  -> linearizable per handle; cost = cross-region RTT on those writes only
```

Causal metadata shared by replication: **version vector** `vv[region]uint64` so
the receiver can detect concurrent-vs-causally-after and so reads honor causal
consistency (don't show effect before its cause).

## 8. Interface contract (guarantee per data class)

- `GET /profile/{key}` → LWW value. Guarantee: **eventual**; **read-your-writes**
  if the client stays pinned to its region.
- `PUT /profile/{key}` → accepted locally, p99 < 15 ms; replicated async; **may
  lose a concurrent field edit** (documented LWW behavior).
- `POST /counter/{key}/incr` (and `/decr`) → CRDT increment. Guarantee:
  **eventual + no lost updates**; all regions' increments survive any partition.
- `GET /counter/{key}` → merged value; monotonic per region.
- `POST /tags/{key}` `{add|remove}` → OR-Set op. Guarantee: **eventual,
  add-wins**, converges after heal.
- `PUT /handle/{name}` → **strongly consistent**; forwarded to owner region;
  returns `409` if taken. Cross-region RTT on contended handles is the price.
- `GET /metrics` → Prometheus exposition. `GET /healthz` → drives geo-router failover.
- Every write returns its `version_vector` so a client can prove read-your-writes
  and so tooling can detect convergence.

## 9. Key technical challenges

- **Choosing the model per class, not globally.** The staff move is recognizing
  that a counter wants a CRDT, a username wants strong ownership, and a bio field
  can survive LWW — and *defending* each. One global choice is wrong for someone.
- **LWW's silent lost update.** With wall-clock timestamps and clock skew, LWW can
  drop the *newer* write. You must show this happening (two regions, same key) and
  show the CRDT not doing it — measured, same workload.
- **Idempotent + causal apply.** Async at-least-once replication will redeliver.
  Apply must be idempotent, and reads must not surface an effect before its cause
  (causal consistency via version vectors).
- **Replication lag under load.** Lag must stay bounded as write rate climbs;
  find the rate where the replication channel can't keep up and lag grows
  unbounded — that's a real ceiling.
- **Failover without data loss or split-brain damage.** When a region dies,
  reroute fast (RTO) and lose nothing the model promised (RPO). When two regions
  partition but both keep serving, you have intentional split-brain — the whole
  bet is that **convergence after heal** cleans it up. Prove it.
- **Failback.** The recovered/healed region must catch up (replay the backlog,
  merge) without double-applying and without serving stale reads first.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each:

1. **Local vs cross-region write latency.** Measure write p99 served locally vs a
   write that must reach the owner region (Class D handle). Quantify the RTT tax
   you pay *only* for strongly-consistent data.
2. **LWW lost update (the cautionary tale).** Fire `write(K, "A", us)` and
   `write(K, "B", eu)` within the replication window. Show LWW converges to **one
   value, the other is gone** — and that with clock skew it can be the *older*
   one. Report how many of N conflict pairs lost data.
3. **CRDT convergence (the fix).** Same conflict workload on the PN-Counter and
   OR-Set. Show **both writes survive** and all regions converge to the identical
   value. Compare against experiment 2 on the same seed.
4. **Replication lag under load.** Ramp aggregate write rate; plot per-link
   replication lag vs rate. Find the knee where lag stops being flat and grows.
5. **Region failover under live load.** Mid-run, kill region `eu`. Measure: RTO
   (router reroute time), any writes lost (RPO per class), and any
   double-applied writes after the backlog replays. Prove counters/sets lost **0**.
6. **Partition / split-brain + heal.** Cut the us↔eu link; keep both serving
   conflicting writes for 60 s; heal. Measure **time-to-converge** and prove every
   conflicting key reaches one agreed value (CRDT: provably; LWW: one survivor).
7. **Read-your-writes within a region.** Pin a client to `us`; after every write,
   immediately read. Assert 100% see their own write. Then break the guarantee on
   purpose by letting the client hop regions mid-session and show the stale read.
8. **Failback.** Bring the killed region back; measure backlog drain time and
   confirm idempotent apply (no double counts, no resurrected deletes).

## 11. Milestones

1. Two regions up with injected inter-region latency (toxiproxy/`tc`); local
   read/write API; Prometheus + a Grafana board for local p99 + per-link lag.
2. Async idempotent replication with version vectors; LWW profile class working;
   conflict generator (`cmd/gen`) producing reproducible same-key write pairs.
3. CRDT package (PN-Counter, OR-Set, LWW-Register); experiments 2 & 3
   (LWW-loses vs CRDT-converges) with measured results.
4. Regional ownership for the strong class (handles) + geo-router failover;
   experiments 1, 5 (latency tax, failover RPO/RTO).
5. Partition/heal + failback (experiments 6, 8); third region added;
   per-data-class **consistency ledger** written and defended.

## 12. Acceptance criteria (definition of done)

- [ ] ≥ 30-min sustained run across 2–3 regions with **flat** replication lag;
      dashboard screenshot attached (local p99 + per-link lag).
- [ ] **LWW lost-update demonstrated** and quantified (N conflict pairs, M lost),
      including a clock-skew case where the older write wins.
- [ ] **CRDT convergence proven** on the same workload: all regions reach the
      identical value, zero lost increments / lost set-members (show the diff).
- [ ] **Failover:** kill a region under load; report RTO < 10 s automatic, RPO per
      class (0 for CRDT/strong), and zero observable double-apply after replay.
- [ ] **Partition + heal:** both regions serve during split-brain; after heal every
      conflicting key converges; report time-to-converge.
- [ ] **Read-your-writes** holds 100% for a region-pinned client; the cross-region
      stale-read counterexample is shown deliberately.
- [ ] A **consistency ledger**: each data class → model, RPO implied, local
      latency win that justifies it. Every number reproducible from a committed
      command + the committed latency matrix.

## 13. Stretch goals

- **HLC (Hybrid Logical Clocks)** instead of wall-clock for LWW; show it shrinks
  but does not eliminate the lost-update window — and why CRDTs still win.
- **Data residency:** pin a `gdpr` keyspace so EU-origin records never replicate
  out of `eu`; prove the constraint holds under the failover path.
- **Anycast/latency-DNS geo-routing** model: replace the static router with
  health-checked latency-based routing and measure reroute time vs the static one.
- **Causal+ (convergent causal) reads:** enforce no effect-before-cause across
  regions using version vectors; build a test that would fail under plain eventual.
- **Sequence/text CRDT (RGA)** for a collaborative field, relating to the DSA
  sequence-CRDT material; show concurrent inserts converge.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Consistency choice | Picks one model and applies it everywhere | **Picks the right model per data class and defends each** — counter→CRDT, handle→strong-ownership, bio→LWW — tied to RPO and latency |
| CAP/PACELC reasoning | States "active-active is eventual" | Names *which* data concedes consistency, *what* it loses (lost update / RPO), and *what* it buys (local latency) |
| Conflict resolution | Implements LWW | Shows LWW's lost update, implements CRDTs, **proves convergence** on the same workload |
| Replication | Replicates asynchronously | Idempotent + causal apply; lag bounded under load with the ceiling found |
| Failover/failback | Reroutes on region death | Hits RTO/RPO targets, no split-brain damage, failback replays without double-apply |
| Partition behavior | Knows both regions keep serving | **Proves convergence after heal** with a measured time-to-converge |
| Communication | Has a findings note | Could defend the per-class consistency ledger to a staff panel and justify every concession |

## 15. References

- Brewer, *CAP twelve years later*; Abadi, *PACELC*.
- Shapiro et al., *Conflict-free Replicated Data Types* (CRDT foundational paper).
- *Designing Data-Intensive Applications* — Ch. 5 (replication), Ch. 9
  (consistency & consensus, linearizability vs causality).
- DynamoDB / Cassandra multi-region & LWW; Riak CRDTs; CockroachDB/Spanner for
  the strong-consistency contrast (cite, don't copy).
- toxiproxy (latency toxics) and `tc netem` for inter-region latency simulation.
- See also: `Interview Question/13-distributed-systems/` (replication,
  consistency models, CAP/PACELC, idempotency, causal consistency) and
  `Interview Question/22-scalability-and-high-availability/` (failover, RPO/RTO,
  multi-region HA).
- Relate to DSA CRDT material:
  `Roadmap/.../26-distributed-data-structures/` (PN-counters, OR-Set/LWW,
  sequence/text CRDTs, convergence proofs).
