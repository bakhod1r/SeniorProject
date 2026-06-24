# Raft-Backed Metadata KV Store

> Build a replicated, strongly-consistent key-value store on top of Raft, then
> make the cost of consensus visible. Find what a quorum round-trip actually
> charges you per write, prove no split-brain survives a partition, and decide —
> with numbers — when linearizability is worth the latency.

| | |
|---|---|
| **Tier** | Staff (distributed consensus) |
| **Primary domain** | Distributed systems / replicated state machines |
| **Skills exercised** | Raft (leader election, log replication, commit safety), linearizable reads (read-index / lease), snapshotting & compaction, joint-consensus membership change, CAP-in-practice, Go concurrency, `hashicorp/raft` or `etcd/raft` |
| **Interview sections** | 13 (distributed systems), 2 (concurrency) |
| **Est. effort** | 5–8 focused days |

---

## 1. Context

You own the **control plane** for a fleet of stateless workers. Every worker
reads the same small, hot pile of metadata: which shards exist, who owns each
one, feature flags, lease ownership for leader-only jobs. Today that metadata
lives in a single Postgres row that everything polls, and when it fails over you
get a 40-second window where two workers each believe they own shard 7. That
window has cost you a duplicate-charge incident already.

You need a store with one property the single node can't give you: **a value,
once written and acknowledged, is never lost and never silently rewinds** — even
when a machine dies mid-write or the network splits. That property is
*linearizable consensus*, and the canonical way to get it is **Raft**.

Your job in this project is to stand up a 3- and 5-node Raft cluster backing a
KV store, drive linearizable writes and reads through it, and then *characterize
the tax*: how much latency and throughput you pay for the guarantee, how fast it
fails over, and exactly how it behaves when the network cuts the cluster in two.
You will produce numbers and a partition proof, not opinions.

You may build on `hashicorp/raft` or `etcd/raft` — but you must be able to draw
the protocol on a whiteboard and explain why each rule exists. Wiring a library
you can't defend is a fail at this tier.

## 2. Goals / Non-goals

**Goals**
- Implement a replicated KV store (`Get/Put/Delete/CAS`) where every accepted
  write is committed by a **majority quorum** before it is acknowledged.
- Demonstrate **leader election** and measure failover time when the leader is
  killed under load.
- Implement **linearizable reads** two ways — through-the-log vs **read-index**
  vs **lease read** — and measure the latency difference.
- Quantify the **consensus throughput ceiling** of a single leader, then raise it
  with **batching and pipelining** of `AppendEntries`.
- Implement **snapshotting + log compaction** and prove the cluster stays healthy
  over millions of committed entries.
- Implement **membership change** (add/remove a node) safely via single-server
  changes or joint consensus, with no lost-leader window.
- Run a **partition test** that proves the minority side cannot commit — no
  split-brain, ever.

**Non-goals**
- Inventing a new consensus protocol. Implement Raft as specified, or use a
  vetted library. (Paxos/EPaxos/Multi-Paxos comparison is a stretch goal.)
- Sharding the keyspace across multiple Raft groups (that's the multi-Raft /
  sharded-platform staff project). One Raft group, one replicated state machine.
- Cross-region / WAN latency tuning (that's multi-region active-active).
- A production-grade gRPC API surface. A small, honest client is enough.

## 3. Functional requirements

1. A **node binary** (`cmd/kvnode`) joins a cluster of N nodes (N ∈ {3, 5}),
   participates in Raft, and applies committed log entries to a local KV state
   machine.
2. The KV state machine supports `Put(k,v)`, `Get(k)`, `Delete(k)`, and
   `CAS(k, expected, new)` (compare-and-swap, which forces the linearizable-write
   path and gives clients a primitive for locks/leases).
3. **Writes** are accepted only by the leader, replicated to a majority, and
   acknowledged only after the entry is committed and applied.
4. **Reads** support a `consistency` flag: `linearizable` (default) and `stale`
   (serve from any node's local state, may be behind). Linearizable reads must
   use **read-index** or **lease**, not a full log round-trip, once the baseline
   works.
5. A **client** (`cmd/kvctl` / Go client lib) discovers the leader, retries on
   `NotLeader` / leader change, and is **idempotent** on retry (a `Put` retried
   after a leader change must not apply twice — carry a client+sequence id).
6. **Snapshotting** triggers automatically past a log-size threshold; a restarted
   or newly-added node catches up from snapshot + tail, not by replaying the
   whole log.
7. **Membership change** (`AddVoter` / `RemoveVoter`) is exposed and safe under
   concurrent writes.
8. A **chaos hook** (`cmd/chaos`) can: kill the leader, kill a follower, pause a
   node (GC/STW simulation), and **partition** the cluster into two groups via
   firewall rules / a proxy.

## 4. Load & data profile

- **Cluster size:** run the full matrix at **3 nodes** and **5 nodes**. Same
  hardware, same client load.
- **Keyspace:** 1M distinct keys, values 256 B–1 KB (metadata, not blobs). Keys
  are **Zipfian** (s≈1.1) so a few keys are hot — this stresses CAS contention on
  the leader.
- **Volume:** drive a single sustained run committing **≥ 10M entries**, and a
  long-running soak that crosses **≥ 50M committed entries** so snapshot/compaction
  behavior and log growth are exercised for real.
- **Write/read mix:** test three profiles — write-heavy (90/10), balanced
  (50/50), and read-heavy (10/90) — because the read-path choice only pays off in
  the last one.
- **Traffic model:** **open-model** client (fixed offered rate, not
  closed-loop), so when the leader saturates you observe the commit queue and p99
  blow up instead of the load auto-throttling and hiding the ceiling.
- **Generator:** `cmd/gen` is deterministic given a seed.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Linearizable write p99 (3 nodes, same-host/LAN, below ceiling) | < 10 ms; **report and explain** the floor (it is ≥ 1 RTT + 1 fsync) |
| Linearizable write p99 vs **single non-replicated node** | Report the multiple (expect ~2–5×); attribute it to quorum RTT + replicated fsync |
| Linearizable read p99 — read-index vs lease | Both reported; lease should approach local-read latency, read-index ≈ ½ write |
| **Leader-failover time** (kill→new leader elected→writes resume) | < 2 × election timeout in the common case; report the full distribution, not the best case |
| Single-leader commit throughput ceiling | Find & report (entries/s); name the bound (fsync? quorum RTT? apply loop? single-core?) |
| Throughput uplift from batching/pipelining | Report ×; expect a large multiple over one-entry-per-round |
| Partition safety | Minority side returns `NotLeader`/no-quorum for **every** write; **zero** committed values diverge |
| Snapshot/compaction effect | Steady-state disk and recovery time stay bounded across 50M entries; restart catch-up time reported |

> The point is not to hit a magic latency. It is to **find** your cluster's
> consensus floor, **explain** every component of it, and **prove** the safety
> properties hold when the network betrays you.

## 6. Architecture constraints & guidance

- N nodes via `docker-compose`, each its own container with its own disk volume
  (so fsync and snapshot I/O are real, not shared page cache). Pin versions.
- Consensus library: **`hashicorp/raft`** (batteries-included: snapshots, stable
  store, transport) or **`etcd/raft`** (lower-level, you own the storage/network
  loop — more to learn). State your choice and what it hides from you.
- The **state machine is deterministic**: applying the same log on every node
  yields the same KV state. No wall-clock, no map-iteration-order, no RNG in
  `Apply`.
- Separate the **Raft log** (replicated, durable, ordered) from the **KV
  snapshot** (a point-in-time materialization). Don't conflate them.
- Persist log entries and metadata (`currentTerm`, `votedFor`) with an **fsync
  before responding** — this is the durability boundary Raft safety depends on.
  A skipped fsync is the single most common way to corrupt a "correct" Raft impl.
- Instrument with Prometheus: commit rate, apply rate, log size, leader id +
  term, election count, `AppendEntries` batch size, follower replication lag,
  read-index round-trips, snapshot duration, p50/p99/p999 for write and each read
  mode.

## 7. Data model

The store is three distinct artifacts. Keep them separate in your head and on
disk.

```
1. REPLICATED LOG  (the source of truth; append-only, ordered, durable)
   entry: { index uint64, term uint64, type {NORMAL|CONFIG|NOOP}, cmd []byte }
   cmd (NORMAL): { op {PUT|DEL|CAS}, key, value, expected, client_id, seq uint64 }
   persisted with fsync; never mutated, only appended/truncated-on-conflict.

2. STATE MACHINE  (deterministic fold of committed entries)
   kv:        map[string]versioned{ value []byte, mod_index uint64 }
   applied_index uint64                 -- highest log index applied
   dedup:     map[client_id]uint64      -- last seq applied, for idempotency

3. SNAPSHOT  (compaction: state machine + metadata at a chosen index)
   { last_included_index, last_included_term, cluster_config, kv_dump, dedup }
   lets the log before last_included_index be discarded.
```

Per-node Raft volatile/persistent state (the parts safety hinges on):
```
persistent (fsync'd): currentTerm, votedFor, log[]
volatile (all):       commitIndex, lastApplied
volatile (leader):    nextIndex[], matchIndex[]
```

**Commit rule:** an entry is committed once it is on a majority of nodes' logs
**and** an entry from the leader's current term is committed (the figure-8 /
§5.4.2 safety rule — never commit a prior-term entry by count alone). The state
machine applies entries strictly in index order up to `commitIndex`.

## 8. Client API + linearizability guarantee

```
Put(key, value, client_id, seq)        -> {committed_index} | NotLeader{leader_hint}
Delete(key, client_id, seq)            -> {committed_index} | NotLeader
CAS(key, expected, new, client_id, seq)-> {ok bool, committed_index} | NotLeader
Get(key, consistency={linearizable|stale}) -> {value, mod_index} | NotLeader(if linearizable)

AddVoter(node_id, addr) / RemoveVoter(node_id) -> {ok} | NotLeader
```

**Linearizability guarantee (the contract you must be able to defend):** every
operation appears to take effect **atomically at a single point** between its
invocation and its response, consistent with real time. Concretely:

- A **write** that returns success is durable on a majority and visible to every
  subsequent linearizable read — including reads served by a *different* node
  after a failover. A write that returns `NotLeader` or times out **may or may
  not** have committed; the client must retry **with the same `(client_id, seq)`**
  so the dedup table makes the retry a no-op if the original landed.
- A **linearizable read** never returns a value older than any write that
  completed before the read began. It is implemented via **read-index** (confirm
  leadership with a quorum heartbeat, then read local state at ≥ that commit
  index) or **lease read** (skip the heartbeat while a leadership lease is valid —
  faster, but correctness now depends on bounded clock drift; state that
  assumption explicitly).
- A **stale read** carries no such guarantee and is labeled as such in the
  response. Offering it is fine; pretending it's linearizable is the bug.

The `mod_index` returned on writes/reads gives clients a linearizable
compare-and-swap primitive (the basis for distributed locks/leases on top of
this store).

## 9. Key technical challenges

- **Safety over partitions (the whole point).** The minority side has a leader
  candidate but no quorum, so it must **reject** writes and stale-out reads. The
  majority side keeps committing. When the partition heals, the minority's
  uncommitted tail is **overwritten** by the majority's log. Getting this wrong =
  split-brain = divergent committed values. You must *prove* it doesn't happen.
- **Linearizable reads without a log round-trip.** Naively, every read goes
  through the log (1 quorum RTT) to be linearizable — correct but expensive.
  Read-index confirms leadership cheaply; lease reads skip even that but trade
  safety for a clock assumption. Implement all three and quantify the
  correctness/latency trade.
- **The single-leader throughput ceiling.** Every write funnels through one
  leader, one fsync, one quorum round-trip. Without batching you're bounded by
  `1 / (fsync + RTT)` per entry. **Batching** (many client ops per
  `AppendEntries`) and **pipelining** (don't wait for entry N's ack before
  sending N+1) amortize both. Measure the lift and find the new bound.
- **Snapshot under live traffic.** Taking a snapshot of a moving state machine
  without stalling `Apply`, then truncating the log and shipping the snapshot to a
  lagging follower (`InstallSnapshot`) — all without violating safety — is where
  toy implementations fall over.
- **Membership change without a window.** Adding/removing a voter changes what
  "majority" means. Do it through single-server changes or joint consensus so the
  old and new quorums always overlap; a naive swap can elect two leaders.
- **Idempotency across leader change (concurrency).** A client retry after a
  leader failover must not double-apply. The `(client_id, seq)` dedup table lives
  *in the replicated state machine* so every replica agrees on what was applied.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each:

1. **Consensus tax vs single node.** Same client load against (a) a single
   non-replicated KV node and (b) the 3-node Raft cluster. Report Δ write p50/p99
   and Δ throughput. Attribute the gap to quorum RTT + replicated fsync.
2. **Batch-size sweep.** Vary max entries per `AppendEntries` (1, 8, 64, 512) and
   max batch delay (0, 1, 5 ms). Plot commit throughput vs write p99. Find the
   knee where batching stops helping and latency starts hurting.
3. **Pipelining on/off.** Disable then enable in-flight `AppendEntries`
   pipelining. Report throughput delta on the write-heavy profile.
4. **Read-path bake-off.** On the read-heavy (10/90) profile, measure
   linearizable read p99 for through-the-log vs read-index vs lease. Report the
   three latencies and state lease's clock assumption.
5. **Leader failover.** Under steady write load, `kill -9` the leader. Measure
   time-to-new-leader and time-to-writes-resume; record the client-visible error
   window. Repeat 20× and report the **distribution** (election timeout is
   randomized — the tail matters).
6. **Partition / split-brain proof.** Partition a 5-node cluster 3|2. Drive
   writes at both sides. Show the 2-side rejects every write (`NotLeader`/no
   quorum) and the 3-side keeps committing. Heal the partition; show the minority
   reconciles and **no committed value diverged** (diff the state machines).
7. **Snapshot / compaction over a long run.** Soak past 50M entries. Plot log
   size and disk with snapshotting on vs off (off should grow unbounded). Kill and
   restart a node; report catch-up time via snapshot+tail vs full-log replay.
8. **3-node vs 5-node trade-off.** Same load on both. Report: write p99 (5-node
   has a larger quorum → higher latency), and failure tolerance (3-node survives 1
   loss, 5-node survives 2). Make the availability-vs-latency trade explicit.
9. **Slow-follower / STW pause.** Pause one follower for 500 ms (simulate GC).
   Show commits continue (majority intact) and the lagging follower catches up
   without a leader change.

## 11. Milestones

1. Compose cluster up; `hashicorp/raft` (or `etcd/raft`) wired to a KV state
   machine; `Put/Get` through the leader; Prometheus + Grafana board for
   commit/apply rate, leader/term, latencies.
2. Linearizable baseline: through-the-log reads, client leader-discovery + retry
   with `(client_id, seq)` idempotency. Experiment 1 (consensus tax) recorded.
3. Throughput work: batching + pipelining; experiments 2–3; ceiling named and
   proven.
4. Read paths: read-index + lease; experiment 4. Failover: experiment 5 with the
   full distribution.
5. Safety: partition proof (experiment 6) with state-machine diff. Snapshot +
   compaction; experiments 7. Membership change verified under load.
6. 3-vs-5 trade-off (8), slow-follower (9); findings note.

## 12. Acceptance criteria (definition of done)

- [ ] A linearizable write committed by a majority quorum, acknowledged only
      after apply; durability proven by killing a node post-ack and reading the
      value back from a survivor.
- [ ] **Partition proof:** 5-node split 3|2 under write load — the minority
      rejects 100% of writes, the majority makes progress, and after heal the
      committed state machines on all nodes are **byte-identical** (show the diff).
- [ ] Failover measured over ≥ 20 leader kills; **distribution** reported (not
      just the best run), with client-visible error window.
- [ ] Consensus tax quantified: Raft write p99 vs single-node p99, with the gap
      attributed to quorum RTT + replicated fsync.
- [ ] Batching/pipelining throughput curve plotted; new ceiling named with
      evidence (pprof / fsync timing / RTT).
- [ ] Read-index vs lease vs through-the-log p99 reported; lease's clock-drift
      assumption stated.
- [ ] Snapshot/compaction keeps log+disk bounded across ≥ 50M entries; restart
      catch-up time reported.
- [ ] Idempotency: a `Put` retried across a forced leader change applies **once**
      (show the dedup ledger).
- [ ] Every number reproducible from a committed command + config + seed.

## 13. Stretch goals

- **Learner / non-voting replicas** that catch up before becoming voters, to
  shrink the membership-change risk window.
- **Witness / flexible quorums** (read-quorum + write-quorum overlap) to cut
  write latency; show it still satisfies the intersection property.
- **Leadership transfer** (graceful step-down) for zero-error-window deploys vs
  the kill-9 failover; compare the error windows.
- **Multi-Raft sketch:** shard the keyspace across two Raft groups and route by
  key; note what cross-shard transactions would now require (link to the sharded
  platform project).
- **Jepsen-style linearizability check:** record a real-time history of
  client ops and verify it linearizes (e.g. with Porcupine). This is the gold
  standard for *proving* the guarantee rather than asserting it.
- **Protocol comparison:** a one-page note on where Multi-Paxos / EPaxos /
  Raft-with-flexible-quorums would change these numbers.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Raft mechanics | Wires a library; writes commit | Explains election, terms, the §5.4.2 commit-safety rule, and *why* each exists; can defend the log-matching property |
| Safety under partition | Knows the minority can't commit | **Proves** no split-brain with a 3\|2 partition + post-heal state-machine diff; explains the CAP trade precisely (this cluster chooses C over A on the minority side) |
| Linearizable reads | Through-the-log reads are correct | Implements read-index *and* lease; states lease's clock assumption; picks one for an SLO with evidence |
| Throughput | Reports a commit ceiling | Names the bound (fsync/RTT/apply/single-core), raises it with batching+pipelining, quantifies the lift |
| Failover | Cluster re-elects after a kill | Reports the failover **distribution**, ties it to randomized election timeout, measures client-visible impact |
| Compaction & membership | Snapshotting works | Snapshots under live load without stalling apply; membership change keeps quorums overlapping with no lost-leader window |
| Idempotency (concurrency) | Happy-path writes don't dup | Retry across forced leader change applies once; dedup lives in the replicated state machine |
| Communication | Clear findings note | Could whiteboard Raft safety and defend every latency/CAP trade-off to a staff panel |

> **Staff bar in one line:** you can explain *precisely* why a write is safe the
> instant it's acknowledged, why the minority side of a partition must refuse to
> serve, and what that refusal costs you in availability — and you have the
> numbers to back all three.

## 15. References

- Ongaro & Ousterhout, **"In Search of an Understandable Consensus Algorithm
  (Extended Version)"** (the Raft paper) — read §5 (election, replication,
  safety), §6 (membership), §7 (snapshotting), and §8 (linearizable client
  interaction) in full. Ongaro's PhD thesis expands the read-index/lease and
  membership-change details.
- *Designing Data-Intensive Applications* — Ch. 9 (consistency & consensus:
  linearizability, total order broadcast, CAP).
- `hashicorp/raft` and `etcd/raft` source + design docs; etcd's "linearizable
  read" (read-index) write-up.
- Jepsen reports on etcd/Consul, and **Porcupine** for linearizability checking.
- See also: `Interview Question/13-distributed-systems/` (consensus, replication,
  CAP, linearizability) and `Interview Question/02-concurrency/` (idempotency,
  shared-state coordination).
