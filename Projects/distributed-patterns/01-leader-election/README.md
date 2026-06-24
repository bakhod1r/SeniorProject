# Leader Election

> Make exactly one node in a fleet do the singleton work — and survive failover
> without ever letting two leaders act at once. A lease tells you who *thinks*
> they're the leader; a fencing token is what makes the work *safe* when that
> belief is wrong.

| | |
|---|---|
| **Tier** | Distributed-patterns (coordination) |
| **Primary domain** | Distributed coordination / high availability |
| **Skills exercised** | Lease-based election (etcd/Consul/Redis), Raft-lease election, split-brain reasoning, fencing tokens, failure detection, graceful handoff, Go (`go.etcd.io/etcd/client/v3/concurrency`, `hashicorp/raft`) |
| **Interview sections** | 13 (distributed systems), 2 (concurrency), 22 (high availability) |
| **Est. effort** | 3–5 focused days |

---

## 1. Context

You run a fleet of identical Go service replicas. Most of the work is
horizontally sharded and stateless — but a few jobs **must run on exactly one
node at a time**: a cron-like scheduler, a monotonic sequence generator, a
compaction/GC loop over a shared store. Run two of them at once and you get
duplicated side effects (double charges, two compactions racing on the same
files, two sequencers handing out the same ID).

The naive answer — "elect a leader with a lock that has a TTL" — is the trap this
project exists to expose. A lease is a *timer-based belief*, and timers lie:
a GC pause, a long syscall, or a network partition can make a healthy leader
*believe* it still holds the lease for seconds after the cluster has already
elected a new one. For a window, **two nodes both think they're the leader and
both act.** That's split-brain, and it is the single most expensive bug in this
problem space.

Your job is to build correct leader election, *measure* its failover behavior,
and then prove that the work the leader does stays correct **even when the lease
abstraction fails you** — by fencing it. You will produce numbers (failover
time, election latency, double-leader incidents) and an argument for why
exactly-one is preserved end to end, not opinions.

## 2. Goals / Non-goals

**Goals**
- Elect exactly one leader across a 3-node fleet using a **lease-based** backend
  (etcd lease + keepalive, Consul session, or Redis `SET NX PX` + renewal) and
  separately using a **consensus-based** backend (Raft leader lease).
- Drive the **singleton work** (a scheduler tick + a monotonic sequencer) only on
  the current leader, and demonstrate graceful handoff of in-flight work on
  demotion.
- Make the work **safe under split-brain** with **fencing tokens**: a
  monotonically increasing number the leader carries, which the protected
  resource uses to reject any write from a stale leader.
- Characterize the **lease-TTL ↔ failover-time** trade-off and pick a defensible
  point for a stated availability SLO.
- Prove **zero double-leader-acting incidents** through a kill, a partition, and a
  GC-pause-induced false lease loss.

**Non-goals**
- Implementing Raft from scratch — use `hashicorp/raft` (the from-scratch version
  is `staff/03-raft-metadata-kv-store`).
- General-purpose mutual exclusion / the Redlock debate — that's the sibling
  project `distributed-patterns/02-distributed-lock-with-fencing`. Here the lock
  *is* leadership; reuse fencing from there.
- Building the failure detector — assume the backend's lease expiry or a SWIM-style
  detector (`internals/03-gossip-swim`) tells you membership changed.
- Multi-leader / sharded-leadership (one leader per partition). Single global
  leader only; note where you'd extend it.

## 3. Functional requirements

1. A **node binary** (`cmd/node`) joins the fleet, campaigns for leadership, and
   exposes its current role (`leader` / `follower` / `candidate`) and the
   **fencing token** it currently holds via `GET /status`.
2. Exactly one node at a time runs the **leader work**:
   - a **scheduler** that fires a tick every `T` and writes a tick record, and
   - a **sequencer** `POST /next` that returns a strictly increasing `(token, seq)`.
3. The election is pluggable behind one interface (`Elector`) with two
   implementations selectable by flag: `-backend=etcd|consul|redis` (lease) and
   `-backend=raft` (consensus lease).
4. On **demotion** (lease lost, lost the Raft term, graceful step-down) the node
   must **stop doing leader work before** the new leader can safely start —
   bounded, observable handoff, not "eventually notices."
5. Every protected write carries the leader's **fencing token**; the protected
   resource (a Postgres row or a small fenced store) **rejects any write whose
   token is ≤ the highest token it has already accepted.**
6. A **chaos hook** (`cmd/chaos`) can: kill the leader process, partition the
   leader from the backend, and inject a stop-the-world pause into the leader to
   simulate a long GC that outlives the lease.

## 4. Load & data profile

- **Fleet size:** 3 nodes (Stage 0) up to 9 nodes with continuous membership
  churn (Stage 2/3). One global leader throughout.
- **Singleton work rate:** scheduler tick every **1 s**; sequencer driven at
  **5k–50k `POST /next`/s** so a demotion mid-flight is observable, not a
  one-in-a-million race.
- **Leader work-set (big-data axis):** the leader owns an in-progress state set —
  e.g. **10M–100M** pending scheduled jobs / a compaction cursor over **100 GB+**
  of segments — so handoff is not free.
- **Election churn (high-RPS axis):** drive membership flaps at up to **1
  election / 5 s** (kill-restart loops) to expose election latency and any
  double-leader window.
- **Clock model:** run nodes with deliberately skewed clocks (±200 ms via a
  configurable offset) and inducible GC pauses, because the whole point is that
  **time is not trustworthy**.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| **Double-leader-acting incidents** | **Exactly 0** — never two tokens accepted out of order, even across partition + GC pause. This is the hard invariant. |
| **Failover time** (old leader dies → new leader doing work) | Measured and bounded; report it. Lease backend ≈ `lease_TTL + election_round` (target < 5 s for a 3 s TTL); Raft ≈ election timeout (target < 1.5 s). |
| **Election latency** (campaign start → won) under churn | p99 < 500 ms with no contender starvation; no thundering-herd retry storm. |
| **Graceful step-down completion** | Leader stops protected writes within **1 lease renewal interval** of losing leadership; report the gap between "old stops" and "new starts." |
| **Sequencer continuity** | `seq` strictly increasing across every failover; **zero** reused or skipped-backward IDs. |
| **Fencing rejection** | 100% of stale-leader writes (post-pause / post-partition) rejected at the resource, with the rejected token logged. |

> The goal isn't a magic failover number — it's to **find** your backend's number,
> explain what bounds it, and prove that even when failover is slow or false,
> **the work stays correct** because it's fenced.

## 6. Architecture constraints & guidance

- **Lease backend:** `etcd` (3 nodes, KRaft-free, pinned version) via
  `go.etcd.io/etcd/client/v3/concurrency.NewElection` — it gives you `Campaign`,
  `Resign`, and an `Observe` channel for free, backed by a real lease+keepalive.
  Consul (`session` + `acquire`) and Redis (`SET NX PX` + a renew loop + a Lua
  compare-and-delete on release) are acceptable alternates — Redis is the
  *instructive wrong default* because a naive Redis lease has **no fencing and no
  consensus**, so use it to demonstrate the failure, then fix it.
- **Consensus backend:** `hashicorp/raft` — leadership is whoever holds the
  current term's leader lease; the **`raft.Raft.LeaderCh()`** transition is your
  election signal. A Raft leader lease is safe *only* if you respect the lease
  bound (don't serve as leader past `now + lease`), so wire that in.
- **Fencing token source of truth:** in the lease world, etcd's **lease/key
  `ModRevision`** (or a dedicated monotonic counter key) is your token; in Raft,
  the **term number** (or a Raft-replicated counter) is your token. The token
  **must increase on every leadership change** and never go backward.
- Keep the node, the chaos tool, and the fenced resource as separate processes so
  you can kill and partition them independently (`iptables`/`pumba`/toxiproxy or a
  compose network).
- Instrument with Prometheus: current role per node, leadership transitions,
  campaign latency, lease renewals/failures, fencing rejections, and a
  **`leaders_acting`** gauge that should be exactly 1 at all times (alert if 2).

## 7. Data model

```
leadership key (etcd):  /election/leader  -> {node_id, lease_id, fence_token}
                        (lease TTL drives expiry; keepalive renews it)

fencing ledger (the safety mechanism, lives WITH the protected resource):
  fenced_resource(name TEXT PK, max_token BIGINT)   -- highest token ever accepted
  -- every protected write does, in ONE transaction:
  --   if incoming_token <= max_token: REJECT (stale leader)
  --   else: max_token = incoming_token; apply the write

sequencer state (handed off on failover):
  sequence(name PK, last_seq BIGINT, owner_token BIGINT)
```

The fencing ledger is the load-bearing idea: it moves correctness **out of the
lease** (which can be wrong) **into the resource** (which can always reject the
past). A stale leader can *believe* anything; it cannot make the resource accept
an old token.

## 8. Interface contract

- `GET /status` → `{ "node_id": "...", "role": "leader|follower|candidate", "fence_token": N, "lease_ttl_remaining_ms": M }`
- `POST /next` (leader only) → `{ "token": N, "seq": M }` — strictly increasing;
  followers return `409` + the current leader's address.
- `GET /metrics` → Prometheus exposition, including the `leaders_acting` gauge.
- Chaos: `cmd/chaos kill-leader`, `cmd/chaos partition-leader --secs=S`,
  `cmd/chaos gc-pause-leader --ms=N` (injects a `runtime`-stalling stop-the-world).
- Backend/timing via flags: `-backend`, `-lease-ttl`, `-renew-interval`,
  `-clock-skew`, `-election-timeout`.

## 9. Key technical challenges

- **A lease alone is not safe.** Expiry is decided by *someone's* clock and a
  renewal that may be delayed by GC, scheduler starvation, or a slow network.
  Between "backend expired my lease" and "my process notices," I can still be
  executing leader code. The fix is not a shorter TTL — it's **fencing**, so the
  resource rejects me regardless of what I believe.
- **TTL ↔ failover trade-off.** Short TTL → fast failover but more false
  positives (a brief GC pause looks like death; you flap leadership and pay
  re-election + handoff cost constantly). Long TTL → stable but slow failover
  (singleton work is dark for `TTL + election` seconds). You must pick a point and
  defend it against an availability SLO.
- **Handoff of in-flight work.** When demoted mid-task, the old leader must
  *stop* (and ideally checkpoint a cursor) before the new leader resumes, or both
  redo/skip work. With a 100 GB compaction cursor, handoff means "publish your
  position durably and stop," not "start over."
- **Thundering herd on election.** When the leader dies, every follower may
  campaign at once, hammering the backend and starving a winner. You need
  randomized backoff / the backend's own queued-campaign primitive (etcd's
  `Campaign` already serializes waiters — Redis-naive does not).
- **Clock skew vs. leader lease.** A Raft/leader-lease optimization that serves
  reads without a round-trip is only safe within the lease bound *and* a bounded
  clock drift. Get the bound wrong and you've reintroduced split-brain on the read
  path.

## 10. Experiments to run (break it / tune it)

Record before/after numbers and the `leaders_acting` timeline for each:

1. **Clean kill.** `kill -9` the leader under steady sequencer load. Measure
   failover time (last old-leader write → first new-leader write) for each
   backend; plot it against `lease_TTL`. Confirm `seq` never goes backward.
2. **TTL sweep.** Lease TTL ∈ {1 s, 3 s, 10 s, 30 s}. For each: failover time
   *and* count of **false** failovers triggered by normal GC under load. Find the
   knee where you trade availability for stability.
3. **Network partition.** Partition the leader from the backend (but keep it
   running and serving). It will keep *believing* it's leader while a new one is
   elected. Show **both** nodes briefly think they lead — then prove the fencing
   ledger **rejects the old leader's writes** (`incoming_token <= max_token`).
   Count rejected writes; `leaders_acting`-by-effect must stay 1.
4. **GC-pause false timeout.** `cmd/chaos gc-pause-leader --ms=(TTL+500)`:
   stall the leader past its lease so the backend expires it and elects a new
   leader, *then* let the old one wake up and try to write with its **stale
   token**. This is the canonical split-brain. Prove the write is fenced out.
   **A passing run here is the whole point of the project.**
5. **Prove fencing is load-bearing.** Disable fencing (accept any token) and
   re-run experiments 3–4: now show double-counts / `seq` reuse appear. Re-enable;
   show they vanish. This is the before/after that demonstrates *why* the token
   matters.
6. **Election churn / thundering herd.** Kill-restart the leader every 5 s for
   10 min across 9 nodes. Measure election-latency p99, backend QPS during the
   storm, and confirm exactly one winner per round (no double-leader, no
   starved-out node).
7. **Graceful step-down.** Trigger `Resign`/leadership transfer (not a crash).
   Measure the gap between "old leader stops protected writes" and "new leader
   starts" — it should be *positive* (a clean baton pass), never negative
   (overlap).

## 11. Milestones

1. `cmd/node` with the `Elector` interface + etcd lease backend; 3 nodes, one
   leader, `leaders_acting=1` on the dashboard; clean-kill failover measured.
2. Scheduler + sequencer leader work; graceful step-down (experiment 7).
3. Fencing ledger wired into every protected write; partition + GC-pause runs
   (experiments 3–4) passing — fenced rejections logged.
4. Raft backend behind the same interface; failover-time comparison vs. lease
   (experiment 1); TTL sweep knee (experiment 2).
5. Churn / thundering-herd run (experiment 6) and the fencing before/after
   (experiment 5); findings note.

## 12. Acceptance criteria (definition of done)

- [ ] Across **all** chaos runs, `leaders_acting`-by-effect is **always 1** and
      double-leader-acting incidents = **0** (show the fencing-rejection log).
- [ ] GC-pause false-timeout run (experiment 4) passes: the awakened stale leader's
      write is **fenced out**, with the rejected token shown.
- [ ] Failover-time numbers reported for both backends, plotted against TTL, with
      the bound named (`TTL + election` for lease; `election_timeout` for Raft).
- [ ] `seq` proven strictly increasing across every failover (show the sequence /
      a SQL `lag()` check finding zero non-increasing steps).
- [ ] Fencing-disabled re-run (experiment 5) **reproduces** the bug, proving the
      token is load-bearing, not decoration.
- [ ] Findings note: the TTL trade-off you chose and the availability SLO it
      serves; what handoff does to the 100 GB cursor.
- [ ] Every number reproducible from a committed command + config + seed.

## 13. Stretch goals

- **Leader leases for fast local reads** (Raft read-lease): serve reads on the
  leader without a quorum round-trip, *within the lease bound + bounded clock
  skew*. Then break it by widening `-clock-skew` and show the read-path
  split-brain — and the bound that prevents it.
- **Lease handoff / leadership transfer** so a planned deploy hands leadership to a
  designated successor (≈0 dark time) instead of waiting for TTL expiry.
- **Sharded leadership:** one leader per partition (consistent-hash the work-set),
  rebalancing on membership change — a step toward `staff/01`.
- **Pre-vote / backoff** to kill election storms during flapping networks; measure
  backend QPS reduction during a churn run.
- **Wire `internals/03-gossip-swim`** as the failure detector feeding the elector,
  and compare its detection latency vs. raw lease expiry.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| **Split-brain safety** | Elects one leader; knows two can briefly coexist | **Knows a lease alone is unsafe and adds fencing**; proves correctness survives a GC-pause false timeout |
| **Fencing** | Implements a monotonic token | Explains *why* the token must live with the resource, not the lease; shows the disabled-fencing run reproduces the bug |
| **TTL trade-off** | Knows shorter TTL = faster failover | Quantifies the false-failover cost; picks a TTL for a stated SLO and defends it |
| **Handoff** | Stops leader work on demotion | Bounds the stop-before-start gap; checkpoints in-flight state so handoff is cheap at 100 GB |
| **Election under churn** | One winner per round | No thundering herd; p99 election latency held under continuous flapping |
| **Backend judgment** | Uses etcd/Raft correctly | Compares lease vs. consensus failover with numbers; knows when Redis-naive is unsafe |
| **Communication** | Clear findings note | Could defend "why exactly-one holds end to end" to a staff panel |

## 15. References

- *Designing Data-Intensive Applications* — Ch. 8 (unreliable clocks, process
  pauses) and Ch. 9 (leases, fencing tokens, the "leader you must fence" example).
- etcd docs: `clientv3/concurrency` election, lease keepalive, leader-lease reads.
- `hashicorp/raft`: leadership, `LeaderCh`, leader-lease safety bound.
- Martin Kleppmann, "How to do distributed locking" — the fencing-token argument
  (read alongside the Redlock rebuttal).
- See also: `distributed-patterns/02-distributed-lock-with-fencing` (reuse the
  fencing token) and `internals/03-gossip-swim` (failure detection).
- See the matching theory in `Interview Question/13-distributed-systems/`
  (leader election, consensus, split-brain) plus sections 2 (concurrency) and
  22 (high availability).
