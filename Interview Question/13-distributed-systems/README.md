# Distributed Systems

> Senior Go backend interview Q&A covering consistency, consensus, idempotency, sagas, the outbox pattern, and failure-resilient design for Kafka + PostgreSQL event-driven systems.

**55 questions** across **16 topics** · Level: senior

## Topics

- [CAP & PACELC](#cap-pacelc) (3)
- [Consistency Models](#consistency-models) (3)
- [Consensus & Raft](#consensus-raft) (4)
- [Leader Election & Split-Brain](#leader-election-split-brain) (2)
- [Idempotency](#idempotency) (2)
- [Saga Pattern](#saga-pattern) (3)
- [Outbox & CDC](#outbox-cdc) (3)
- [CQRS & Event Sourcing](#cqrs-event-sourcing) (3)
- [Distributed Time & Clocks](#distributed-time-clocks) (3)
- [Distributed Locks](#distributed-locks) (2)
- [Designing for Failure](#designing-for-failure) (6)
- [Consistent Hashing, Partitioning & Quorums](#consistent-hashing-partitioning-quorums) (3)
- [Latency, Timeouts, Retries & Backoff](#latency-timeouts-retries-backoff) (8)
- [Replication & Quorum Reads/Writes](#replication-quorum-readswrites) (4)
- [Membership, Gossip & Failure Detection](#membership-gossip-failure-detection) (3)
- [Backpressure & Flow Control](#backpressure-flow-control) (3)

---

## CAP & PACELC

#### 1. State the CAP theorem precisely, and explain why 'CA' is not a real operating mode for a distributed system.

*Difficulty:* 🟢 warm-up  ·  *Tags:* `cap`, `consistency`, `availability`, `theory`

CAP says that when a network **partition (P)** occurs, a distributed system must sacrifice either **consistency (C, linearizability)** or **availability (A, every non-failing node answers)**. The mistake is reading it as 'pick 2 of 3.' Partitions are not something you choose — networks drop packets, links die, GC pauses look like partitions. So P is a given for any system that talks over a network. The real choice is what you do *during* a partition: refuse to answer on the minority side to stay consistent (CP), or answer anyway and risk divergence (AP). 'CA' only describes a single node or a system that assumes the network never fails — i.e., not a distributed system at all. The trade-off only bites during partitions; when healthy, you can have both C and A.

**Key points**
- C = linearizability, A = every non-failed node responds, P = tolerate dropped messages
- Partitions are imposed by reality, not chosen
- The actual decision is the partition behavior: reject (CP) or diverge (AP)
- CA = non-distributed / assumes a perfect network

**Follow-ups**
- Is a single-leader Postgres with sync replication CP or AP?
- How does a long GC pause manifest as a partition?

---

#### 2. Give a concrete AP system and a concrete CP system, and explain the user-visible consequence of each during a partition.

*Difficulty:* 🟡 medium  ·  *Tags:* `cap`, `cassandra`, `etcd`, `kafka`

**CP example:** a system built on Raft/ZooKeeper/etcd, or Postgres with synchronous-commit replication requiring a quorum ack. During a partition the minority side cannot reach a quorum, so writes (and linearizable reads) on that side **fail or block** — the user sees errors/timeouts but never stale or conflicting data. **AP example:** Cassandra or DynamoDB with low quorum, or a Kafka consumer serving from a local materialized view. During a partition both sides keep accepting reads/writes; the user always gets an answer, but two clients may see **different or stale values**, and writes on both sides must later be reconciled (last-write-wins, vector clocks, CRDTs). The consequence is the trade you accept: CP gives correctness with reduced availability (some requests rejected); AP gives availability with temporary incorrectness (divergence + conflict resolution). For payments you usually want CP on the ledger; for a shopping cart or feed, AP is fine.

**Key points**
- CP: etcd/ZK/Raft, sync-replicated Postgres — minority blocks, errors not staleness
- AP: Cassandra/Dynamo low-quorum — always answers, may be stale/divergent
- Choose per data: ledger CP, cart/feed AP
- AP pushes the cost onto conflict resolution

**Follow-ups**
- How would you make a cart AP without losing items the user added?
- Where does Kafka itself sit on CAP?

---

#### 3. What does PACELC add over CAP, and why does the 'else latency vs consistency' half matter more day-to-day?

*Difficulty:* 🟠 hard  ·  *Tags:* `pacelc`, `latency`, `spanner`, `consistency`

PACELC: **if Partition, choose Availability or Consistency; Else (normal operation), choose Latency or Consistency.** CAP only describes the rare partition case. PACELC's contribution is the *else* branch: even with a perfectly healthy network, strong consistency costs latency. To be linearizable you must coordinate — wait for a quorum to ack a write, route reads through the leader, or run consensus — and every coordination round-trip adds latency, especially cross-AZ or cross-region. So a system like Dynamo is 'PA/EL' (available under partition, low-latency otherwise, both at the cost of consistency), while a system like Spanner is 'PC/EC' (consistent always, paying latency via TrueTime waits). This matters more day-to-day because partitions are rare but *every single request* pays the latency-vs-consistency tax. The practical lever is: which reads can tolerate a slightly stale replica (fast, EL) versus which must hit the leader/quorum (slow, EC).

**Key points**
- PACELC = CAP plus the no-partition latency/consistency trade
- Strong consistency requires coordination = round-trips = latency on every request
- Dynamo ≈ PA/EL, Spanner ≈ PC/EC
- Else-branch dominates because partitions are rare; latency is paid constantly

**Follow-ups**
- How does Spanner's TrueTime trade latency for consistency?
- Which of your read paths could safely serve from a follower?

---

## Consistency Models

#### 4. Rank linearizable, sequential, causal, and eventual consistency from strongest to weakest, and give a one-line distinction for each.

*Difficulty:* 🟡 medium  ·  *Tags:* `consistency-models`, `linearizability`, `causal`, `eventual`

**Linearizable (strongest):** every operation appears to take effect atomically at a single point between its call and return, consistent with real-time order — there is one global, wall-clock-respecting history. **Sequential:** all clients agree on *some* single total order of operations, and each client's own operations keep their program order, but that order need not match real time — a write you finished may appear 'after' another client's later write. **Causal:** operations that are causally related (A happened-before B) are seen in that order by everyone; concurrent operations may be seen in different orders by different clients. **Eventual (weakest):** with no new writes, all replicas eventually converge to the same value; says nothing about ordering or what you read in the meantime. Each step down removes a guarantee in exchange for less coordination and lower latency/higher availability.

**Key points**
- Linearizable: single real-time-respecting global order
- Sequential: one agreed order + per-client program order, but not real-time
- Causal: preserves happened-before; concurrent ops unordered
- Eventual: only guarantees convergence, no ordering

**Follow-ups**
- Why is causal consistency the strongest you can have while staying available under partition?
- Is Postgres read-committed linearizable?

---

#### 5. A user updates their profile, the response says 200, then they reload and see the OLD value. What guarantee is missing and how do you provide it cheaply?

*Difficulty:* 🟡 medium  ·  *Tags:* `read-your-writes`, `session-guarantees`, `replication-lag`, `postgres`

The missing guarantee is **read-your-writes (read-your-own-writes) consistency**, a session guarantee. It happens because the write went to the leader/primary but the reload was served by a **lagging follower** that hadn't replicated yet. Cheap fixes, roughly in order of cost: (1) **Read from the leader for a short window** after a write (e.g., pin the session to the primary for N seconds, or for that entity). (2) **Write-token / LSN tracking:** the write returns the replication position (Postgres LSN / Kafka offset); subsequent reads carry it and the router picks a replica that has caught up to that LSN, else falls back to the leader. (3) **Sticky routing** by user/session so the same user keeps hitting a replica that has seen their writes. (4) Serve the just-written value from a **local cache** keyed by user. The token approach is the most precise — it gives read-your-writes without forcing *all* reads to the leader, so you keep follower-read scalability.

**Key points**
- Symptom = read-your-writes violation from follower lag
- Pin reads to leader briefly after a write (simple, blunt)
- Carry the write's LSN/offset and route to a caught-up replica (precise)
- Sticky session routing or write-through cache as alternatives

**Follow-ups**
- How do you implement LSN-based routing with Postgres read replicas?
- What's the difference between read-your-writes and monotonic reads?

---

#### 6. Define monotonic reads and give a failure scenario where its absence confuses a user.

*Difficulty:* 🟡 medium  ·  *Tags:* `monotonic-reads`, `session-guarantees`, `replication`, `consistency-models`

**Monotonic reads** guarantees that once a client has read a value, it will never later read an *older* value — reads only move forward in time for that session, never backward. Without it, time appears to 'go backwards.' Scenario: a user posts a comment, refreshes and sees it (read served by an up-to-date replica), then refreshes again and the comment **disappears** because the second read landed on a more-lagged replica. Or in messaging: you see 50 unread, refresh, see 53, refresh again, back to 50. The usual cause is reads being load-balanced across replicas with different lag. The standard cure is **session stickiness** — route a session's reads to the same replica (or to replicas guaranteed to be at least as fresh as the last one it read, tracked via an LSN high-water mark). Note monotonic reads is weaker than read-your-writes: it constrains the sequence of *reads*, not whether you see your own *writes*.

**Key points**
- Once seen, never see an older value — no backward time travel
- Caused by reads bouncing between replicas of differing lag
- Fix: sticky session or per-session LSN high-water mark
- Weaker than and orthogonal to read-your-writes

**Follow-ups**
- How do you track a per-session freshness high-water mark across stateless app servers?
- Which is easier to violate accidentally behind a round-robin LB, monotonic reads or read-your-writes?

---

## Consensus & Raft

#### 7. Walk through Raft leader election: terms, who can vote for whom, and what prevents two leaders in the same term.

*Difficulty:* 🟠 hard  ·  *Tags:* `raft`, `leader-election`, `consensus`, `quorum`

Raft divides time into **terms**, monotonically increasing numbers acting as a logical clock. Each term has at most one leader. A follower that hears nothing from a leader within its randomized **election timeout** becomes a **candidate**, increments the term, votes for itself, and requests votes. A node grants its vote only if (a) it hasn't already voted in that term and (b) the candidate's log is **at least as up-to-date** as its own (compared by last log term, then index). A candidate that collects a **majority** of votes becomes leader. Two leaders in the same term are impossible because winning requires a majority, and any two majorities overlap in at least one node — that node can vote only once per term, so only one candidate can reach a majority. Randomized timeouts make simultaneous candidacies (split votes) rare; a split vote just means no one wins, terms advance, and a new election runs. The leader then sends periodic heartbeats (empty AppendEntries) to suppress new elections.

**Key points**
- Terms are a logical clock; ≤1 leader per term
- Vote requires unused vote + candidate log at least as up-to-date
- Majority quorum + overlap + one-vote-per-term = single leader
- Randomized timeouts reduce split votes; heartbeats suppress elections

**Follow-ups**
- Why must the up-to-date check compare last log term before index?
- What happens to a stale leader that comes back after a partition?

---

#### 8. In Raft, explain log replication, the commit index, and the rule about when a leader may consider an entry committed.

*Difficulty:* 🔴 staff  ·  *Tags:* `raft`, `log-replication`, `commit-index`, `consensus`

The leader appends a client command to its log and sends **AppendEntries** to followers, including the index/term of the entry *preceding* the new ones so each follower can verify continuity (the **log matching** property: if two logs share an entry at the same index+term, all prior entries match). A follower that fails the consistency check rejects, and the leader backs up and retries until logs align, overwriting any conflicting follower suffix. An entry is **committed** once it is stored on a **majority** of nodes — at which point the leader advances its **commitIndex** and applies the entry to the state machine, then informs followers so they apply too. Crucial subtlety: **a leader may only mark an entry committed by counting replicas if that entry is from the leader's *current* term.** Entries from prior terms are committed indirectly, once a current-term entry above them reaches majority. This rule prevents a subtle bug where a replicated-but-uncommitted entry from an old term could otherwise be overwritten after appearing 'safe.'

**Key points**
- AppendEntries carries prev index/term → log matching property
- Conflicting follower entries are overwritten to match leader
- Committed = on a majority; then apply to state machine
- Leader counts replicas to commit only for current-term entries (Figure 8 safety rule)

**Follow-ups**
- Walk through the Raft Figure 8 scenario this rule prevents.
- How does commitIndex differ from lastApplied?

---

#### 9. Paxos vs Raft: why did the industry mostly standardize on Raft despite Paxos coming first?

*Difficulty:* 🟠 hard  ·  *Tags:* `paxos`, `raft`, `consensus`, `etcd`

Both solve consensus and have equivalent safety guarantees and the same majority-quorum core; the difference is **understandability and operational shape**, which is exactly what Raft optimized for. Classic (single-decree) Paxos decides one value; turning it into **Multi-Paxos** for a replicated log requires extra machinery (leader leases, choosing instances, filling gaps) that the original papers left underspecified, so every real implementation diverged. Raft instead bakes in a **strong leader** (all writes flow through it), an explicit **election protocol with terms**, and a **log that is never reordered** (followers' logs are forced to match the leader's), which makes the algorithm easier to reason about, teach, and verify. That clarity translated into solid, reusable libraries (etcd/raft, HashiCorp raft) powering etcd, Consul, CockroachDB, TiKV. Paxos still wins where you want **leaderless / multi-writer** behavior or specific variants (EPaxos for low-latency geo, Flexible Paxos for tuning quorums). In practice: pick Raft for a replicated log you have to operate and debug; reach for Paxos variants for specialized topologies.

**Key points**
- Same safety + majority quorum; Raft optimizes for understandability
- Multi-Paxos underspecified → divergent implementations
- Raft: strong leader, terms, non-reordered log → easier to verify/operate
- Paxos variants (EPaxos, Flexible Paxos) win for leaderless/geo cases

**Follow-ups**
- What does EPaxos buy you over Raft in a multi-region deployment?
- What is Flexible Paxos's insight about quorum intersection?

---

#### 10. Why is a majority quorum (N/2 + 1) the magic number for consensus, and what does it guarantee?

*Difficulty:* 🟡 medium  ·  *Tags:* `quorum`, `consensus`, `fault-tolerance`, `split-brain`

A majority quorum guarantees that **any two quorums intersect in at least one node**. That single overlapping node is what prevents inconsistency: it cannot simultaneously vote for two different leaders in one term, nor acknowledge two conflicting committed values, so decisions can't fork. It also bounds fault tolerance: with N nodes you tolerate the failure of **floor((N-1)/2)** — 1 of 3, 2 of 5 — while the surviving majority keeps making progress. The minority side of a partition, lacking a majority, *cannot* elect a leader or commit, which is precisely how Raft/Paxos avoid split-brain. This is why consensus clusters are sized at **odd** numbers: 3 and 4 both tolerate only 1 failure, but 4 needs 3 for a quorum (more nodes to coordinate, no extra safety), so the 4th node only adds cost. The deeper guarantee comes from the quorum-intersection property; consensus is fundamentally 'build sets that always share a member.'

**Key points**
- Any two majorities share ≥1 node → no forked decisions
- Tolerates floor((N-1)/2) failures; minority can't make progress
- Minority-can't-commit is the anti-split-brain mechanism
- Use odd N: 4 tolerates same failures as 3 but costs more

**Follow-ups**
- How do read/write quorums R+W>N generalize this idea to Dynamo-style stores?
- Why might you run 5 nodes instead of 3 for a critical control plane?

---

## Leader Election & Split-Brain

#### 11. What is split-brain, and exactly how does majority quorum prevent it?

*Difficulty:* 🟡 medium  ·  *Tags:* `split-brain`, `quorum`, `leader-election`, `leases`

**Split-brain** is when a partition leaves two (or more) sides each believing it is the active leader/primary, so both accept writes independently and the data diverges — the classic 'two primaries, one ledger' disaster. Majority quorum prevents it by making leadership require votes from **more than half** the cluster. During a partition, at most one side can contain a majority; the minority side(s) cannot gather enough votes to elect or retain a leader, so they stop accepting writes (they fail/step down). Because two majorities must overlap, you can never have two leaders simultaneously legitimized. The subtlety: a *previously elected* leader on the minority side may not immediately know it lost quorum. That's why robust systems pair quorum with **leader leases** (the leader must keep renewing a time-bounded lease via the majority; once it can't, it must self-demote before serving) — and with **fencing** at the resource, so even a confused old leader's writes are rejected downstream.

**Key points**
- Split-brain = multiple primaries accepting conflicting writes
- Only one partition side can hold a majority → only one leader
- Minority stops accepting writes (loses quorum)
- Quorum alone isn't enough: add leases + fencing for a lagging old leader

**Follow-ups**
- Why isn't winning the election enough — what's the lease for?
- How does fencing protect a resource the old leader still talks to?

---

#### 12. Explain fencing tokens. Why is a lock alone insufficient to prevent a stale leader from corrupting shared state?

*Difficulty:* 🟠 hard  ·  *Tags:* `fencing-tokens`, `distributed-locks`, `split-brain`, `gc-pause`

A lock alone fails because of **process pauses and clock skew**. Client A acquires the lock, then suffers a long stop-the-world GC pause (or gets paused by the scheduler). During the pause its lock lease expires, the lock service grants the lock to client B, and B starts writing. A then wakes up, still 'holding' (in its own mind) the lock, and writes too — now both write, corrupting state. The lock service did nothing wrong; the assumption 'I hold the lock therefore I'm exclusive' is simply unsafe across pauses. **Fencing tokens** fix this: the lock service hands out a **monotonically increasing token** with each grant (A gets 33, B gets 34). Every write to the protected resource must include its token, and the resource **rejects any write with a token lower than the highest it has seen**. So when paused-A finally writes with token 33, the storage (which already saw 34 from B) rejects it. The key insight: the *resource itself* must enforce ordering — the lock service can't, because it can't control when paused clients wake up.

**Key points**
- GC/scheduler pauses can outlast a lock lease → two holders write
- Lock service can't enforce exclusivity across client pauses
- Fencing token = monotonically increasing per grant
- Resource rejects any write with token < max seen (enforced at storage)


```go
// storage-side check
func (s *Store) Write(token uint64, key, val string) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    if token < s.maxSeenToken[key] {
        return ErrStaleFencingToken // a newer holder already wrote
    }
    s.maxSeenToken[key] = token
    s.data[key] = val
    return nil
}
```

**Follow-ups**
- Where do you get a reliably increasing token (etcd revision, ZK zxid)?
- How does this relate to the Redlock critique?

---

## Idempotency

#### 13. Why is idempotency described as the backbone of reliable distributed systems? Frame it around retries and at-least-once delivery.

*Difficulty:* 🟡 medium  ·  *Tags:* `idempotency`, `at-least-once`, `retries`, `exactly-once`

Because in distributed systems you can almost never get **exactly-once execution** — you get **at-least-once** plus deduplication, and idempotency is the deduplication. The root cause is the **two generals / ambiguous-failure problem**: when a request times out, you cannot tell whether it (a) never arrived, (b) executed but the ack was lost, or (c) is still in flight. Your only safe move is to **retry** — but if the original actually succeeded, a naive retry double-charges, double-ships, double-publishes. Kafka redelivers on consumer restart/rebalance; HTTP clients retry on 5xx/timeout; sagas retry steps. So every effectful operation that can be retried must be **idempotent**: applying it once or N times yields the same result and the same side effects. Idempotency is what lets you turn the messy, unavoidable at-least-once world into effectively-once *outcomes*. Without it, retries — the very mechanism that makes systems reliable — become the thing that corrupts them.

**Key points**
- Exactly-once delivery is unattainable; you get at-least-once + dedup
- Ambiguous failure (lost ack vs lost request) forces retries
- Retries are required for reliability but cause duplicates
- Idempotency converts at-least-once delivery into effectively-once outcomes

**Follow-ups**
- Which Kafka events cause a consumer to reprocess a message?
- Is a naive 'INSERT a payment' idempotent? Why not?

---

#### 14. Design idempotency keys for a payment 'charge' API. Cover storage, the race between concurrent duplicates, and what you return on replay.

*Difficulty:* 🔴 staff  ·  *Tags:* `idempotency`, `payments`, `unique-constraint`, `postgres`, `api-design`

The client generates a unique **Idempotency-Key** (UUID) per logical charge and sends it as a header; it must stay stable across that client's retries. Server side: an `idempotency_keys` table keyed by `(merchant_id, idempotency_key)` with a **UNIQUE constraint**, holding status (in-progress | succeeded | failed), a hash of the request body, the stored response, and a TTL. Flow: in one DB transaction, `INSERT ... ON CONFLICT DO NOTHING`. If you won the insert, you're the first request — proceed to charge, then persist the response and flip status. If the insert **conflicts**, this is a duplicate: (a) if the stored request-body hash differs, reject with 422 (same key, different payload = client bug); (b) if it's still `in-progress`, the original is racing you — return 409/425 'retry shortly' rather than charging again; (c) if it's `succeeded`, **replay the exact stored response** (same body, same status) so the retry is invisible. The UNIQUE constraint is what makes the concurrent-duplicate race safe — the database, not the application, serializes the two requests. Critically, the charge and the key write must commit **atomically** with the side effect; if the actual money-movement is at a PSP, store the PSP's idempotency reference so even that downstream call dedups.

**Key points**
- Client-generated stable UUID; (merchant, key) UNIQUE constraint serializes duplicates
- INSERT ON CONFLICT DO NOTHING decides winner vs duplicate atomically
- Same key + different body hash = 422; in-progress = retry-later 409
- On succeeded, replay the stored response byte-for-byte; pass an idempotency ref to the PSP


```go
// pseudo-Go, single tx
func Charge(ctx context.Context, tx *sql.Tx, key, merchant string, req ChargeReq) (Resp, error) {
    bodyHash := sha256Hex(req)
    row := tx.QueryRowContext(ctx, `
        INSERT INTO idempotency_keys (merchant_id, key, body_hash, status)
        VALUES ($1,$2,$3,'in_progress')
        ON CONFLICT (merchant_id, key) DO NOTHING
        RETURNING id`, merchant, key, bodyHash)
    var id int64
    if err := row.Scan(&id); err == sql.ErrNoRows {
        // duplicate: load existing record
        ex := loadKey(ctx, tx, merchant, key)
        switch {
        case ex.BodyHash != bodyHash:
            return Resp{}, ErrKeyReuseMismatch // 422
        case ex.Status == "in_progress":
            return Resp{}, ErrInProgress       // 409, tell client to retry
        default:
            return ex.StoredResponse, nil       // replay succeeded result
        }
    }
    resp := doCharge(ctx, req) // include a PSP-side idempotency ref too
    persistResult(ctx, tx, id, resp)
    return resp, nil
}
```

**Follow-ups**
- What TTL is safe for the key, and what breaks if it's too short?
- How do you handle a crash after the charge but before persisting the response?

---

## Saga Pattern

#### 15. What problem does the Saga pattern solve, and what is a compensating transaction?

*Difficulty:* 🟡 medium  ·  *Tags:* `saga`, `compensating-transaction`, `2pc`, `distributed-transactions`

Sagas solve the problem of a **business transaction that spans multiple services/databases** where a distributed ACID transaction (2PC) is undesirable or impossible — because 2PC holds locks across services, blocks on coordinator failure, and few modern stores/brokers (Kafka, most microservice DBs) support it well. A saga replaces one atomic transaction with a **sequence of local transactions**, each in a single service committing to its own DB and emitting an event/command to trigger the next step. There's no global rollback, so if step 4 of 6 fails, you can't 'undo' steps 1–3 with a rollback — they already committed. Instead each step defines a **compensating transaction**: a *new* local transaction that semantically reverses its effect (refund the payment, release the reserved inventory, cancel the booking). On failure, the saga runs the compensations for already-completed steps in reverse order. The crucial property: sagas give **atomicity (all-or-nothing outcome) but NOT isolation** — intermediate states are visible to other transactions, so you must design for the 'dirty' middle (e.g., 'pending' states, semantic locks).

**Key points**
- For multi-service business transactions where 2PC is too costly/unsupported
- Sequence of local commits, each triggering the next via events/commands
- Compensation = new transaction that semantically undoes a committed step
- Gives atomicity but not isolation — intermediate states are visible

**Follow-ups**
- Why can't you just roll back instead of compensating?
- How do you handle the lack of isolation between concurrent sagas?

---

#### 16. Orchestration vs choreography sagas — contrast them and state when you'd pick each.

*Difficulty:* 🟠 hard  ·  *Tags:* `saga`, `orchestration`, `choreography`, `temporal`, `kafka`

**Choreography:** no central coordinator. Each service listens for events and reacts by doing its local work and emitting the next event (OrderCreated → PaymentReserved → InventoryReserved → OrderConfirmed). Pros: maximally decoupled, no single bottleneck, easy to add a new reactive consumer. Cons: the workflow is **implicit and emergent** — no one place describes it, making it hard to understand, debug, and reason about; cyclic event dependencies sneak in; compensation logic is scattered across services. **Orchestration:** a central **saga orchestrator** (a state machine) explicitly drives the flow, sending commands to each service and reacting to replies, and it owns the compensation sequence. Pros: the workflow lives in one auditable place, easier to visualize, monitor, and evolve; compensation is centralized. Cons: the orchestrator is a new component to build/operate and can become a complexity magnet; risk of re-centralizing logic. **Rule of thumb:** few steps, simple linear flow, true autonomy → choreography. Many steps, complex branching/compensation, need for observability and explicit timeouts → orchestration (often via a durable workflow engine like Temporal). Most mature teams trend toward orchestration as flows grow because debuggability wins.

**Key points**
- Choreography: event-reactive, decoupled, but workflow is implicit/hard to debug
- Orchestration: central state machine, explicit + observable, but a new component
- Compensation scattered (choreography) vs centralized (orchestration)
- Simple/few-step → choreography; complex/branching → orchestration (Temporal-style)

**Follow-ups**
- How does Temporal/Cadence change this trade-off?
- How do you prevent infinite event cycles in a choreographed saga?

---

#### 17. Sagas lack isolation. What concrete anomalies arise, and how do you mitigate them?

*Difficulty:* 🔴 staff  ·  *Tags:* `saga`, `isolation`, `semantic-lock`, `concurrency`, `anomalies`

Because each saga step commits independently, the intermediate states are visible to concurrent transactions, producing ACD-without-I anomalies: **(1) Lost updates** — two sagas read and overwrite the same record. **(2) Dirty reads** — another transaction reads a value the saga will later compensate away (e.g., it reads a balance that hasn't been refunded yet). **(3) Fuzzy/non-repeatable reads** — a saga reads a value, another saga mutates it mid-flight, breaking the first saga's assumptions. Mitigations (from Garcia-Molina/Richardson countermeasures): **Semantic lock** — mark the record with a pending/in-flight flag (e.g., `status='PENDING_REVIEW'`) so others know it's mid-saga and either wait or skip it; the lock is released by the completing or compensating step. **Commutative updates** — design operations so order doesn't matter (incrementing a balance by a delta rather than setting an absolute value), which makes concurrent application safe. **Reread value / version check** — before acting, re-read and verify a version (optimistic concurrency) to detect mid-flight changes. **By-value / risk-based routing** — route low-risk transactions through the saga and high-risk ones through a stricter path. And always make steps **idempotent + commutative** so retries and out-of-order events converge.

**Key points**
- Anomalies: lost updates, dirty reads, fuzzy/non-repeatable reads
- Semantic lock: PENDING flag marks in-flight records
- Commutative updates (deltas not absolutes) make concurrency safe
- Optimistic version checks + idempotent steps; route by risk

**Follow-ups**
- How does a PENDING state interact with read-your-writes for the end user?
- Why are commutative operations easier to compensate?

---

## Outbox & CDC

#### 18. Explain the dual-write problem: why can't you just write to Postgres and then publish to Kafka in the same handler?

*Difficulty:* 🟠 hard  ·  *Tags:* `dual-write`, `outbox`, `kafka`, `postgres`, `atomicity`

Because the DB write and the Kafka publish are **two independent systems with no shared transaction**, and any interleaving of failures leaves them inconsistent. Consider: you `COMMIT` the order to Postgres, then call `producer.Send(orderCreated)` — but the process crashes, or Kafka is momentarily unavailable, or the network drops the ack. Now the DB says the order exists but **no event was published**: downstream consumers never react (lost event). Flip the order — publish first, then commit — and a commit failure leaves an event for an order that **doesn't exist** (phantom event). You cannot make the two atomic: 2PC over Postgres+Kafka is impractical (Kafka's XA story is poor, and 2PC reintroduces coordinator blocking and lock-holding you were trying to avoid). Even 'publish then update a flag' just moves the same race. The dual-write problem is fundamental: **two non-transactional sinks cannot be updated atomically by best-effort sequencing.** The fix is to make the event part of the *same* local DB transaction as the state change — i.e., the **outbox pattern** — so there's only one commit, and a separate relay propagates it to Kafka.

**Key points**
- DB write + Kafka publish span two systems with no shared transaction
- Crash between them → lost event (DB ok, no event) or phantom event
- 2PC over Postgres+Kafka is impractical and reintroduces blocking
- Best-effort sequencing can't be atomic → need outbox (single commit)

**Follow-ups**
- Why doesn't 'publish, then set published=true' close the gap?
- How does the outbox reduce two writes to one atomic write?

---

#### 19. Walk through the transactional Outbox pattern end to end, including how the event reaches Kafka and the delivery guarantee it provides.

*Difficulty:* 🔴 staff  ·  *Tags:* `outbox`, `cdc`, `debezium`, `kafka`, `postgres`, `at-least-once`

**Write side:** in the **same Postgres transaction** that mutates business state, also `INSERT` a row into an `outbox` table (aggregate id, event type, JSON payload, created_at, maybe a partition key). One commit, both succeed or both fail — the dual-write problem is gone because there's only one write target. **Relay side, two flavors:** (1) **Polling publisher** — a background worker `SELECT`s unpublished outbox rows (often `FOR UPDATE SKIP LOCKED` so multiple workers don't collide), publishes each to Kafka, then marks/deletes the row. (2) **CDC / log-tailing** (preferred at scale) — **Debezium** reads Postgres's **write-ahead log (WAL)** via logical replication, turns each outbox insert into a Kafka message, with no polling load on the DB. **Guarantee:** this is **at-least-once** delivery — the relay may publish a row, crash before marking it published, and republish on restart; or Kafka may redeliver. So consumers **must be idempotent** (dedupe on the event id). It does *not* give exactly-once, but combined with idempotent consumers it gives effectively-once processing. Bonus: ordering per aggregate is preserved if you key Kafka messages by aggregate id (and CDC reads the WAL in commit order).

**Key points**
- Business write + outbox INSERT in one tx = single atomic commit
- Relay via polling (FOR UPDATE SKIP LOCKED) or CDC/Debezium tailing the WAL
- Guarantee is at-least-once → consumers MUST be idempotent
- Key Kafka by aggregate id to preserve per-aggregate ordering


```sql
-- inside one tx with the business write
INSERT INTO orders (id, status, total) VALUES ($1,'CREATED',$2);
INSERT INTO outbox (id, aggregate_id, type, payload, created_at)
VALUES (gen_random_uuid(), $1, 'OrderCreated', $3, now());
COMMIT;

-- polling relay (one worker among many)
SELECT id, type, payload FROM outbox
WHERE published_at IS NULL
ORDER BY created_at
FOR UPDATE SKIP LOCKED
LIMIT 100;
-- publish each to Kafka keyed by aggregate_id, then:
UPDATE outbox SET published_at = now() WHERE id = ANY($1);
```

**Follow-ups**
- Why prefer Debezium WAL-tailing over polling at high write volume?
- How do you stop the outbox table from growing unbounded?

---

#### 20. How does Debezium / CDC actually capture changes, and what operational pitfalls bite teams in production?

*Difficulty:* 🟠 hard  ·  *Tags:* `cdc`, `debezium`, `wal`, `replication-slot`, `postgres`, `kafka`

Debezium does **log-based CDC**: it registers as a logical-replication consumer on Postgres, reading the **WAL** through a **replication slot** and a logical decoding plugin (pgoutput). Every committed insert/update/delete becomes a change event published to Kafka, **in commit order**, without querying the tables (so no extra load or missed in-between states the way query-based polling has). Pitfalls: **(1) Replication slot retention** — if Debezium falls behind or stops, Postgres *cannot recycle WAL* for that slot, so `pg_wal` grows until the disk fills and the primary goes down. You must monitor slot lag and alert. **(2) Snapshot on first start** — an initial consistent snapshot of large tables can be slow and heavy; plan for it. **(3) Schema changes / DDL** — column renames and type changes must be handled by schema evolution and a registry, or consumers break. **(4) Exactly-once illusion** — CDC is at-least-once; on connector restart you can get duplicate events, so consumers dedupe. **(5) TOAST'd large columns** may arrive as 'unchanged' placeholders unless replica identity is set to FULL. **(6) Failover** — slots aren't always replicated to the new primary, so a Postgres failover can break or rewind CDC unless you use slot-syncing/operator support.

**Key points**
- Log-based: reads WAL via a replication slot + pgoutput, in commit order, no table load
- Replication slot retains WAL — lagging connector can fill the disk and kill the primary
- Initial snapshot of big tables is heavy; plan capacity
- At-least-once (dedupe), schema evolution required, TOAST/replica-identity and failover gotchas

**Follow-ups**
- How do you monitor and bound replication slot lag?
- What does REPLICA IDENTITY FULL change and what does it cost?

---

## CQRS & Event Sourcing

#### 21. What is CQRS, and when is splitting the read and write models actually worth the cost?

*Difficulty:* 🟡 medium  ·  *Tags:* `cqrs`, `read-model`, `write-model`, `eventual-consistency`

**CQRS (Command Query Responsibility Segregation)** separates the **write model** (commands that mutate state, optimized for consistency and business invariants) from the **read model(s)** (queries, optimized for fast, denormalized reads). They can be different schemas, different stores, even different databases, kept in sync asynchronously (often via events). It's worth it when: **(1)** read and write workloads are **very asymmetric** (e.g., 1000:1 reads:writes) and you want to scale or shape them independently; **(2)** queries need **denormalized/materialized views** that would be expensive to compute from a normalized write schema on every read; **(3)** you have **many different read shapes** of the same data (a dashboard, a search index, an export) better served by purpose-built projections; **(4)** it pairs naturally with **event sourcing**. It is NOT worth it for simple CRUD: CQRS adds **eventual consistency** between write and read sides (the read model lags), extra moving parts, and projection-rebuild complexity. The cost is real — most domains need it only in a few hot aggregates, not system-wide. Apply it surgically.

**Key points**
- Separate write model (invariants) from read model(s) (query-optimized, denormalized)
- Worth it: extreme read/write asymmetry, many read shapes, expensive views, with event sourcing
- Cost: read side is eventually consistent + lags; more components; rebuild complexity
- Overkill for plain CRUD — apply per-aggregate, not globally

**Follow-ups**
- How do you give users read-your-writes when the read model lags?
- Does CQRS require event sourcing?

---

#### 22. In Event Sourcing, what exactly do you store, and how do you rebuild current state? Why are snapshots needed?

*Difficulty:* 🟠 hard  ·  *Tags:* `event-sourcing`, `snapshots`, `projections`, `optimistic-concurrency`

In event sourcing the **source of truth is an append-only, immutable log of events** — facts about what happened (OrderPlaced, ItemAdded, OrderShipped) — not the current state. You never `UPDATE` a row; you append a new event. **Current state is derived** by replaying the events for an aggregate in order through a fold/reducer: `state = events.reduce(apply, initialState)`. This gives you a perfect audit trail, time-travel/debugging ('what did this look like last Tuesday?'), and the ability to build *new* projections retroactively by replaying history with new logic. The problem: an aggregate with tens of thousands of events is slow to rebuild from scratch on every load. **Snapshots** solve this — periodically you persist the materialized state at version N, so loading becomes 'load snapshot at N, then replay only events N+1..current.' Snapshots are a pure performance optimization (a cache), never the source of truth: you can always discard them and rebuild from events. You also need an **optimistic concurrency** check on append (expected version) so two concurrent commands don't both write event N+1.

**Key points**
- Store an append-only immutable log of events; never mutate rows
- Current state = fold/replay events through an apply function
- Snapshots = cached state at version N to bound replay cost (not source of truth)
- Append with expected-version optimistic concurrency to prevent conflicting writes

**Follow-ups**
- How do you choose a snapshot interval?
- What goes wrong if you treat the snapshot as authoritative?

---

#### 23. Schema evolution is called the hard part of event sourcing. Why, and what strategies handle it?

*Difficulty:* 🔴 staff  ·  *Tags:* `event-sourcing`, `schema-evolution`, `upcasting`, `avro`, `schema-registry`

It's hard because events are **immutable and kept forever**, so you can't migrate them with an `ALTER TABLE`. Years of old-format events must still be replayable by today's code, and your apply/fold logic has to understand every version that ever existed. You cannot 'just change the struct.' Strategies: **(1) Additive-only / weak schema** — only add optional fields, never rename or remove or repurpose; consumers tolerate unknown fields (favor JSON/Avro/Protobuf with forward-backward compatibility, enforced by a **schema registry**). **(2) Upcasting** — keep events as written but transform old versions to the new shape *on read*, in a pipeline of upcasters (V1→V2→V3) before they reach the apply function, so business logic only ever sees the latest version. **(3) Versioned event types** — `OrderPlaced.v1`, `OrderPlaced.v2` as distinct types with explicit handlers. **(4) Copy-and-transform / new stream** — for breaking changes, replay the old stream through a converter into a new stream (rarely needed, expensive, breaks immutability purity). The discipline: treat your event schema as a **published, versioned API contract** that you can only extend compatibly. Get this wrong early and you accumulate a swamp of conditional parsing.

**Key points**
- Events are immutable + retained forever → no in-place migration
- Additive-only changes; never rename/remove/repurpose fields
- Upcasting transforms old versions to latest on read before apply
- Versioned event types or copy-transform for true breaking changes; treat schema as a versioned contract

**Follow-ups**
- Avro vs Protobuf vs JSON for event payloads — trade-offs?
- How does a schema registry enforce backward/forward compatibility?

---

## Distributed Time & Clocks

#### 24. Why can't you trust wall-clock timestamps to order events across machines in a distributed system?

*Difficulty:* 🟡 medium  ·  *Tags:* `clocks`, `ntp`, `wall-clock`, `ordering`, `lww`

Because physical wall clocks on different machines **disagree and drift**, and even on one machine they can jump. NTP synchronizes them only to within milliseconds-to-tens-of-milliseconds, and that error is larger than the gap between many events you care about ordering. Clocks drift between syncs (quartz inaccuracy, temperature), and worse, **wall-clock time is non-monotonic**: an NTP correction or a leap-second smear can make `time.Now()` go *backwards*, so an event that happened later can get an earlier timestamp. Concretely: machine A's clock is 30ms ahead of B's; A handles request1 then B handles request2 that causally depends on it, but B stamps an earlier time — now timestamp order contradicts causal order. Comparing timestamps from different hosts to decide 'which happened first' is therefore unsafe and silently produces wrong orderings (and last-write-wins data loss). The fix is to use **logical clocks** (Lamport, vector clocks) that track causality directly rather than relying on physical time — or specialized hardware (Spanner TrueTime) that bounds and exposes the uncertainty.

**Key points**
- NTP error (ms–tens of ms) often exceeds the inter-event gap
- Clocks drift and can jump backward (NTP correction, leap-second smear) — non-monotonic
- Cross-host timestamp comparison can contradict causal order
- Use logical clocks (Lamport/vector) or bounded-uncertainty hardware (TrueTime)

**Follow-ups**
- Why use time.Now() vs a monotonic clock reading in Go for measuring durations?
- How does last-write-wins lose data when clocks disagree?

---

#### 25. Explain Lamport timestamps: the rule, what they guarantee, and their fundamental limitation.

*Difficulty:* 🟠 hard  ·  *Tags:* `lamport-clock`, `logical-clocks`, `causality`, `happened-before`

A **Lamport timestamp** is a single integer counter per node maintaining logical time. Rules: (1) increment your counter before each local event/send; (2) attach the counter to every message sent; (3) on receive, set `local = max(local, received) + 1`. This produces the **clock-consistency property**: if event A happened-before B (causally), then `L(A) < L(B)`. That gives you a total order (break ties by node id) that **respects causality** — useful for, e.g., deciding a consistent order in a replicated log. The fundamental limitation: it's a **one-way implication**. `L(A) < L(B)` does NOT mean A happened-before B — they might be **concurrent** (causally independent). A single counter collapses the partial order of causality into a total order, *losing the information about which events were concurrent*. So Lamport timestamps can *order* events consistently but **cannot detect concurrency or conflicts**. When you need to know whether two updates are concurrent (e.g., to flag a write conflict in an AP store), you need **vector clocks**, which preserve the full happened-before partial order.

**Key points**
- Counter rule: increment locally; send with counter; on recv = max(local,recv)+1
- Guarantees A→B implies L(A)<L(B) (causality-consistent total order via tiebreak)
- Limitation: L(A)<L(B) does NOT imply A→B — can't distinguish concurrent events
- Single counter flattens the partial order; use vector clocks to detect concurrency

**Follow-ups**
- How would you use Lamport timestamps to order writes in a replicated log?
- What is a hybrid logical clock (HLC) and what does it add?

---

#### 26. How do vector clocks work, and how do you use them to detect a concurrent-write conflict?

*Difficulty:* 🔴 staff  ·  *Tags:* `vector-clocks`, `causality`, `conflict-detection`, `dynamo`, `siblings`

A **vector clock** is a vector of counters, one per node: `VC = [n1, n2, n3]`. Rules: a node increments **its own** entry on each local event; on send it ships the whole vector; on receive it takes the **element-wise max** of its own vector and the received one, then increments its own entry. To compare two vectors VC(A) and VC(B): **A happened-before B** iff every element of VC(A) ≤ the corresponding element of VC(B) and at least one is strictly less. If neither dominates the other (each has some element greater than the other's), the events are **concurrent** — that's exactly the conflict signal. Example in a Dynamo-style store: a key has value with VC `[A:2, B:1]`. Two clients update independently: one produces `[A:3, B:1]`, the other `[A:2, B:2]`. Neither dominates → concurrent writes → the store keeps **both versions as siblings** and surfaces them for resolution (application merge, CRDT, or last-write-wins). The cost: vector size grows with the number of writers, so long-lived or many-node systems prune or use **dotted version vectors** to bound it. Vector clocks give you what Lamport can't: the ability to *tell* when two updates conflicted versus when one truly superseded the other.

**Key points**
- Vector of per-node counters; bump own entry, element-wise max on receive
- A→B iff VC(A) ≤ VC(B) componentwise and strictly less somewhere
- Neither dominates = concurrent = conflict → keep sibling versions
- Vectors grow with writer count; prune or use dotted version vectors


```go
// concurrent if neither dominates the other
func relation(a, b map[string]int) string {
    aLeq, bLeq := true, true
    for _, n := range nodes(a, b) {
        if a[n] > b[n] { aLeq = false }
        if b[n] > a[n] { bLeq = false }
    }
    switch {
    case aLeq && bLeq: return "equal"
    case aLeq:         return "a-before-b"
    case bLeq:         return "b-before-a"
    default:           return "concurrent" // conflict — keep both siblings
    }
}
```

**Follow-ups**
- How do dotted version vectors keep the size bounded?
- Once you detect siblings, what are your resolution options?

---

## Distributed Locks

#### 27. When do you genuinely need a distributed lock, and when are people reaching for one by mistake?

*Difficulty:* 🟡 medium  ·  *Tags:* `distributed-locks`, `idempotency`, `leader-election`, `partitioning`

You genuinely need a distributed lock when you must guarantee that **at most one process performs an action at a time across machines**, and there's no other coordination point — e.g., **leader election** (one active scheduler), ensuring a **singleton cron job** doesn't run on every replica, or serializing access to an external resource that itself has no concurrency control. Even then, locks split into two purposes: **efficiency** (avoid duplicate work — occasional double-run is merely wasteful, a weak lock is fine) versus **correctness** (double-run corrupts data — you need fencing, not just a lock). People reach for distributed locks by mistake when the underlying store can already enforce the invariant: a **database UNIQUE constraint** or a conditional/optimistic-concurrency update (`UPDATE ... WHERE version = $n`) serializes contending writers without any lock service; **idempotency keys** make double-processing harmless so you don't need to *prevent* it; **partitioning by key** (Kafka partition, consistent hashing) routes all work for an entity to one consumer so there's no contention. Rule: prefer making the operation **idempotent or guarded by a DB constraint** over introducing a lock — locks add a new failure mode (the lock service) and the pause/fencing dangers.

**Key points**
- Real need: leader election, singleton job, serialize an uncontrolled external resource
- Distinguish efficiency locks (occasional double-run OK) from correctness locks (need fencing)
- Often avoidable: UNIQUE constraints, optimistic concurrency, idempotency keys, key-partitioning
- Locks add a failure mode — prefer idempotency/DB guarantees first

**Follow-ups**
- How does Kafka partitioning remove the need for a lock per entity?
- Efficiency vs correctness lock — how does fencing relate?

---

#### 28. Summarize the Redlock controversy. What's the core disagreement, and what's the practical takeaway?

*Difficulty:* 🔴 staff  ·  *Tags:* `redlock`, `redis`, `fencing-tokens`, `distributed-locks`, `etcd`

**Redlock** is Redis's algorithm for distributed locking across N independent Redis masters: acquire the lock on a **majority** of nodes within a time bound, and you 'hold' it. **Martin Kleppmann's critique:** Redlock is unsafe for **correctness** because it relies on **timing assumptions** — bounded clocks, bounded network delay, bounded process pauses. But a **GC pause, scheduler preemption, or VM stall** can exceed the lock's TTL: a client thinks it still holds the lock while it has actually expired and been granted to another client → two holders → corruption. No amount of majority-acquisition fixes this, because the fault is on the *client* timeline, not the lock service. The only real fix is a **fencing token** enforced by the protected resource, which Redlock doesn't provide. **Antirez (Redis author) rebutted** that Redlock targets *efficiency* locks (where rare double-acquire is tolerable) and that fencing isn't always available; he also disputed some clock assumptions. **Practical takeaway:** for *efficiency* (don't usually do duplicate work), Redlock or even a single-Redis `SET NX PX` lock is fine. For *correctness* (double-execution corrupts data), do not rely on any TTL-based lock alone — use a **monotonic fencing token** validated at the resource, ideally backed by a consensus store (etcd/ZooKeeper revision/zxid) rather than Redis. When in doubt, design the operation to be **idempotent** so the lock's correctness stops mattering.

**Key points**
- Redlock = acquire on a majority of independent Redis nodes within a time bound
- Kleppmann: timing assumptions break under GC/scheduler/VM pauses → two holders
- Real fix is a fencing token enforced by the resource, which Redlock lacks
- Efficiency locks: fine. Correctness: use fencing + consensus store, or make ops idempotent

**Follow-ups**
- Why does etcd/ZooKeeper give you a better fencing token than Redis?
- How would you make the protected operation idempotent so the lock matters less?

---

## Designing for Failure

#### 29. Why must every remote call have a timeout, and what goes wrong with a naive fixed-delay retry?

*Difficulty:* 🟡 medium  ·  *Tags:* `timeouts`, `retries`, `context`, `cascading-failure`, `go`

**Timeouts** are mandatory because a remote call has no natural upper bound — without one, a slow or hung dependency makes your goroutine/connection wait indefinitely, and under load these waiting requests **pile up**, exhausting connection pools, goroutines, and memory until your service itself falls over (resource exhaustion cascading from the dependency). A timeout converts an unbounded wait into a fast, bounded failure you can handle (in Go, propagate a `context.WithTimeout` through the whole call chain so cancellation flows). **Naive fixed retries** make failure worse in two ways: (1) **No backoff** — immediately retrying a struggling dependency adds load exactly when it's already overloaded, deepening the outage. (2) **Synchronized retries (retry storms / thundering herd)** — when one dependency blips, *thousands* of clients time out at the same instant and retry in lockstep, hammering the recovering service in waves and preventing recovery. (3) Retrying **non-idempotent** operations duplicates side effects. The fix is **exponential backoff with jitter**, a retry **budget/cap**, retrying only **idempotent or idempotency-keyed** operations, and only on **retryable** errors (timeouts/503, not 400/validation).

**Key points**
- No timeout → unbounded waits → pool/goroutine exhaustion → cascading failure
- Propagate context deadlines through the whole chain (Go)
- Fixed retries: no backoff adds load; synchronized retries = thundering herd
- Retry only idempotent ops, on retryable errors, with a budget

**Follow-ups**
- How do you choose a timeout value relative to p99 latency?
- Which HTTP status codes should you retry vs not?

---

#### 30. Explain exponential backoff with jitter. Why is jitter not optional, and which jitter variant do you pick?

*Difficulty:* 🟠 hard  ·  *Tags:* `backoff`, `jitter`, `retries`, `thundering-herd`, `go`

**Exponential backoff** grows the wait between retries multiplicatively — base × 2^attempt, capped at a max — so a struggling dependency gets exponentially more breathing room instead of being hammered. **Jitter** randomizes that delay. It is **not optional** because without it, all clients that failed at the same moment compute the *same* backoff and retry at the *same* future instant, recreating the **thundering herd** at each retry round — you've just moved the synchronized spike, not removed it. Jitter spreads retries uniformly over the window, smoothing load so the dependency can recover. Variants (from the AWS Architecture Blog analysis): **'Full jitter'** — `sleep = random(0, min(cap, base*2^attempt))` — is usually the best choice: it gives the widest spread and the lowest server contention, at the cost of occasionally retrying very soon. **'Equal jitter'** keeps half the backoff fixed plus half random (less variance, slightly more clustering). **'Decorrelated jitter'** — `sleep = min(cap, random(base, prev*3))` — is also excellent and self-adapting. Default to **full jitter** unless you need a guaranteed minimum spacing. Always pair with a **max attempts / time budget** and a cap so you don't back off into eternity.

**Key points**
- Exponential growth (base*2^attempt, capped) backs off a struggling dependency
- Without jitter, synchronized clients re-cluster each round → repeated herd
- Full jitter = random(0, capped exp): widest spread, lowest contention — good default
- Always bound with max attempts / total time budget


```go
func backoff(attempt int, base, max time.Duration) time.Duration {
    exp := base << attempt            // base * 2^attempt
    if exp > max || exp <= 0 {
        exp = max
    }
    return time.Duration(rand.Int63n(int64(exp))) // full jitter: random(0, exp)
}
```

**Follow-ups**
- When would equal or decorrelated jitter be preferable?
- How do retry budgets interact with circuit breakers?

---

#### 31. Explain the circuit breaker pattern: its three states, what each transition does, and the problem it solves that retries don't.

*Difficulty:* 🟠 hard  ·  *Tags:* `circuit-breaker`, `resilience`, `cascading-failure`, `graceful-degradation`

A **circuit breaker** wraps calls to a dependency and tracks failures to **stop calling a service that is already failing**, preventing wasted work and cascading failure. Three states: **Closed** (normal) — calls pass through; failures are counted (by rate or consecutive count). When failures cross a threshold, it **trips to Open**. **Open** — calls **fail fast immediately** without touching the dependency (return an error or fallback), giving the struggling service time to recover and freeing the caller's resources (no piling-up timeouts). After a cool-down timer, it moves to **Half-Open** — it lets a **limited number of trial requests** through; if they succeed, it **closes** (recovered); if they fail, it trips back to **Open**. The problem it solves that retries/backoff don't: retries assume the failure is *transient* and worth re-attempting; a circuit breaker handles **sustained** failure by *not even trying*, which (a) stops you from amplifying load on a downed dependency, (b) gives callers fast failures instead of slow timeouts (preserving *their* capacity and preventing the outage from cascading upstream), and (c) enables **graceful degradation** via the fallback path. Retries and breakers are complementary: retry the transient blip, trip the breaker on sustained outage.

**Key points**
- Closed → count failures; trip Open at threshold
- Open → fail fast / fallback, no calls, let dependency recover
- Half-Open → limited trial calls; success closes, failure re-opens
- Handles sustained failure (stop trying) where retries handle transient; prevents cascade + enables fallback

**Follow-ups**
- How do you tune the failure threshold and cool-down window?
- How does a half-open breaker avoid re-overloading the recovering service?

---

#### 32. What are bulkheads, and how do they differ from a circuit breaker? Give a Go-flavored example.

*Difficulty:* 🟠 hard  ·  *Tags:* `bulkhead`, `resilience`, `isolation`, `go`, `semaphore`

The **bulkhead** pattern **isolates resources** so a failure in one part can't sink the whole ship — named after a ship's watertight compartments: one floods, the rest stay dry. You partition resources (connection pools, goroutine/worker limits, thread pools, even separate service instances) **per dependency or per tenant**, capping how much of each one workload can consume. So if dependency X hangs, only X's bounded pool gets saturated; calls to dependencies Y and Z still have their own capacity and keep working. Without bulkheads, a single slow dependency consumes *all* shared connections/goroutines and takes down endpoints that don't even use it. **Difference from a circuit breaker:** a breaker is **temporal** (stop calling a failing dependency *for a while* based on its error rate); a bulkhead is **spatial** (cap and isolate *how much resource* any one dependency can ever grab, regardless of errors). They compose: bulkhead limits the blast radius, breaker reacts to sustained failure. In Go, a simple bulkhead is a **bounded semaphore** (buffered channel) per dependency that limits concurrent in-flight calls, plus a separate, sized `http.Client`/DB pool per downstream so one can't starve the others.

**Key points**
- Isolate resources per dependency/tenant (pools, goroutine caps) — watertight compartments
- One hung dependency saturates only its own pool; others stay healthy
- Bulkhead = spatial isolation; circuit breaker = temporal stop-calling — they compose
- Go: bounded semaphore (buffered channel) + per-downstream sized pools


```go
type Bulkhead struct{ sem chan struct{} }

func NewBulkhead(max int) *Bulkhead { return &Bulkhead{sem: make(chan struct{}, max)} }

func (b *Bulkhead) Do(ctx context.Context, fn func() error) error {
    select {
    case b.sem <- struct{}{}:           // acquired a slot
        defer func() { <-b.sem }()
        return fn()
    case <-ctx.Done():
        return ctx.Err()                // pool full: shed load fast, isolate the blast radius
    }
}
```

**Follow-ups**
- How do you size each bulkhead's concurrency limit?
- How does load shedding relate to bulkheading?

---

#### 33. What is graceful degradation, and how do you design a service to degrade rather than fail outright?

*Difficulty:* 🟡 medium  ·  *Tags:* `graceful-degradation`, `fallback`, `load-shedding`, `resilience`

**Graceful degradation** means that when a dependency fails or is slow, the service **drops to a reduced but still useful level of function** instead of returning an error or going down entirely — partial availability beats total outage. Design techniques: **(1) Fallbacks** — when the live source fails, serve a **cached/stale** value, a default, or a degraded computation (e.g., personalization service down → show non-personalized but valid content). **(2) Prioritize core over optional** — protect the critical path; shed or disable non-essential features first (recommendations, related-items, analytics enrichment) so the checkout still works when the recommender is down. **(3) Circuit breakers with fallback handlers** so a tripped breaker routes to the degraded path instead of erroring. **(4) Load shedding** — under overload, reject low-priority traffic early (return 429) to keep high-priority requests healthy, rather than letting everything degrade equally. **(5) Timeouts + defaults** so a slow optional call returns a sensible default fast. The mindset: explicitly classify each dependency as **critical vs. optional** at design time and decide, per dependency, what 'degraded' looks like — degradation that isn't designed in advance becomes a hard failure in production.

**Key points**
- Reduced-but-useful service instead of total failure (partial > none)
- Fallbacks: serve stale/cached/default when the live source fails
- Protect the critical path; shed/disable optional features first
- Combine with breakers (fallback path) and load shedding; classify deps critical vs optional upfront

**Follow-ups**
- How do you decide what stale data is acceptable to serve?
- How does load shedding decide which requests to drop?

---

#### 34. Why must retries be idempotent, and how do you make a Kafka consumer safely retryable end to end?

*Difficulty:* 🔴 staff  ·  *Tags:* `idempotency`, `kafka`, `at-least-once`, `inbox-pattern`, `effectively-once`

Retries must be idempotent because retrying re-executes side effects: a non-idempotent 'charge card' or 'send email' or 'INSERT order' retried after an ambiguous failure **double-applies** the effect. Since you can't avoid retries (timeouts hide whether the first attempt succeeded), the only safe stance is to make re-application a no-op. **For a Kafka consumer specifically:** Kafka is **at-least-once** by default — on rebalance, consumer crash, or a commit that lands after processing, the same offset (message) gets **redelivered**, so the consumer *will* reprocess. Make it safe end to end: **(1) Dedupe by a business/event id** — record processed event ids (a `processed_events` table with a UNIQUE constraint, or the inbox pattern) and skip ones you've already handled. **(2) Make the side effect itself idempotent** — `INSERT ... ON CONFLICT DO NOTHING`, conditional/upsert updates, or carry an idempotency key into downstream calls (e.g., the PSP). **(3) Commit the offset only *after* the side effect is durably committed**, and ideally write the dedupe/inbox record in the **same DB transaction** as the side effect, so 'processed' and 'effect applied' are atomic — otherwise you can mark-processed-then-crash (lost work) or apply-then-fail-to-commit (reprocess). With idempotent handling, at-least-once redelivery becomes **effectively-once** processing without needing fragile exactly-once semantics.

**Key points**
- Retries re-run side effects; non-idempotent ops double-apply on ambiguous failure
- Kafka is at-least-once: rebalance/crash/late-commit cause redelivery
- Dedupe on event id (inbox/UNIQUE) AND make the side effect idempotent
- Write dedupe record + side effect in one tx; commit the offset only after durable commit → effectively-once


```go
// inbox dedupe + side effect in ONE tx, commit offset after
func handle(ctx context.Context, db *sql.DB, e Event) error {
    tx, _ := db.BeginTx(ctx, nil)
    defer tx.Rollback()
    res, _ := tx.ExecContext(ctx,
        `INSERT INTO processed_events(event_id) VALUES($1)
         ON CONFLICT DO NOTHING`, e.ID)
    if n, _ := res.RowsAffected(); n == 0 {
        return tx.Commit() // already processed → no-op, safe to ack
    }
    if err := applyEffect(ctx, tx, e); err != nil { return err }
    return tx.Commit() // only now commit the Kafka offset upstream
}
```

**Follow-ups**
- Where exactly does at-most-once vs at-least-once come from in the offset-commit order?
- What does Kafka's transactional/exactly-once-semantics actually cover, and its limits?

---

## Consistent Hashing, Partitioning & Quorums

#### 35. Why is consistent hashing used for partitioning instead of plain hash-mod-N, and what do virtual nodes fix?

*Difficulty:* 🟠 hard  ·  *Tags:* `consistent-hashing`, `partitioning`, `virtual-nodes`, `cassandra`, `dynamo`

Plain `hash(key) % N` distributes keys evenly across N nodes, but the moment N changes — add or remove a node — **almost every key remaps** to a different node (because the modulus changed), forcing a massive reshuffle/cache-miss storm. That's catastrophic for caches and stateful stores. **Consistent hashing** instead maps both nodes and keys onto a fixed **hash ring**; a key is owned by the next node clockwise. Adding or removing a node only reassigns the keys in **that node's arc** — on average **K/N keys move**, not all of them — so scaling is incremental and cheap. The remaining problem: with few nodes, random placement on the ring creates **uneven arc sizes**, so load (and the impact of a node leaving) is lopsided. **Virtual nodes (vnodes)** fix this: each physical node is placed at **many points** on the ring (e.g., 100–200 tokens), so the arcs interleave and average out — load is balanced, and when a node dies its keys are spread across *many* remaining nodes instead of dumping entirely onto one neighbor. Vnodes also make **heterogeneous capacity** easy (give bigger machines more tokens). This is the partitioning backbone of Dynamo, Cassandra, and Riak.

**Key points**
- hash % N remaps nearly all keys when N changes → full reshuffle
- Consistent hashing: ring + next-clockwise owner → only ~K/N keys move on change
- Few nodes → uneven arcs; load imbalance
- Virtual nodes (many tokens/node) balance load, spread a failed node's keys, allow weighting

**Follow-ups**
- How many vnodes per physical node and what trade-off does that set?
- How does the ring decide replica placement for replication factor 3?

---

#### 36. Explain quorum reads/writes and the R + W > N rule. What does it guarantee, and what does it NOT guarantee?

*Difficulty:* 🔴 staff  ·  *Tags:* `quorum`, `replication`, `rwn`, `dynamo`, `eventual-consistency`

In a Dynamo-style store, each key is replicated to **N** nodes. A **write** succeeds once **W** replicas ack it; a **read** queries and waits for **R** replicas to respond. The rule **R + W > N** guarantees that the read set and the latest write set **overlap in at least one node** — so any successful read sees at least one replica that has the most recent write, letting it return the freshest version (resolved by version/vector clock). That gives **strong-ish (quorum) consistency** while tolerating some node failures. Tuning shifts the trade: **W=N, R=1** = fast reads, slow/fragile writes; **R=N, W=1** = fast writes, slow reads; **R=W=⌈(N+1)/2⌉** (e.g., N=3, R=W=2) balances both and tolerates one node down. What it does **NOT** guarantee: (1) it is **not linearizable** — quorums alone don't prevent stale reads under concurrent writes, read-repair races, or the sloppy-quorum/hinted-handoff case where writes land on the 'wrong' nodes during a partition; (2) it doesn't prevent **conflicting concurrent writes** — overlap means a read *sees* the latest acked version, but two concurrent writes still create siblings you must resolve; (3) with `R+W ≤ N` you get pure eventual consistency (possible stale reads). Quorums buy tunable consistency, not free linearizability.

**Key points**
- N replicas; write waits for W acks, read for R responses
- R + W > N → read and write sets overlap → read sees the latest acked write
- Tune R/W for read-heavy vs write-heavy; R=W=2,N=3 is the common balanced choice
- NOT linearizable: sloppy quorums/hinted handoff, concurrent writes still create siblings

**Follow-ups**
- What is a sloppy quorum + hinted handoff, and how does it weaken the guarantee?
- How does read-repair fit into quorum reads?

---

#### 37. Contrast partitioning and replication. Why do real systems combine them, and what trade-off does each address?

*Difficulty:* 🟡 medium  ·  *Tags:* `partitioning`, `replication`, `sharding`, `kafka`, `scalability`

**Partitioning (sharding)** splits the dataset into disjoint pieces placed on different nodes so the whole thing doesn't have to fit (or be served) on one machine — it addresses **scale**: more data and more throughput than a single node can handle, by spreading load. But partitioning alone gives **no fault tolerance**: if the node owning partition 7 dies, partition 7 is unavailable and possibly lost. **Replication** keeps **copies of the same data** on multiple nodes — it addresses **availability and durability** (survive node failure) and can add **read scalability** (serve reads from replicas) and **lower latency** (read from a nearby copy). But replication alone doesn't help capacity — every node still holds the full dataset. So real systems (Cassandra, Kafka, sharded Postgres, MongoDB) **combine** them: partition the data for scale, then replicate **each partition** (replication factor, e.g., 3) for fault tolerance. Kafka is the clean example: a topic is split into **partitions** (parallelism/scale), and each partition has a **leader + follower replicas** (durability/availability) with one acting as leader for writes. The trade-offs you then manage are partition-key/hot-spot balance (partitioning) and replication lag/consistency-vs-latency (replication).

**Key points**
- Partitioning splits data for scale (capacity + throughput) but no fault tolerance alone
- Replication copies data for availability/durability/read-scaling but doesn't add capacity
- Real systems combine: partition for scale, replicate each partition for resilience
- Kafka: partitions (parallelism) × replica leader/followers (durability); watch hot keys + lag

**Follow-ups**
- How does a hot partition key undermine the scaling benefit, and how do you fix it?
- How does Kafka's ISR (in-sync replicas) relate to durability vs availability?

---

## Latency, Timeouts, Retries & Backoff

#### 38. Why must every remote call have a timeout, and how do you pick the value?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `timeout`, `latency`, `resilience`, `context`

A call without a timeout doesn't fail — it *hangs*, holding a goroutine, a connection, and often a lock, until something upstream gives up. Under load those held resources are the actual outage: the slow dependency doesn't return errors you can shed, it silently consumes your concurrency until you run out and fall over. So the default is: **no unbounded waits, ever** — set a timeout (in Go, a `context` deadline) on every network/DB/cache call. Picking the value is an SLO decision, not a guess: base it on the dependency's measured **p99 (or p999) plus headroom**, not its average. A timeout set at the mean cuts off half your legitimate slow-but-fine requests; a timeout of 30s is the same as no timeout under load. The timeout should also be **smaller than the caller's own deadline** (see deadline propagation) so you have time to react (retry, fallback, return a clean error) before *your* caller times out on *you*.

**Key points**
- Unbounded wait = held goroutine/connection/lock; that exhaustion is the outage
- Set a context deadline on every remote call; no infinite waits
- Base the value on the dependency's p99/p999 + headroom, not the mean
- Must be shorter than your own caller's deadline so you can react first

**Follow-ups**
- What's the difference between a connection timeout, a request timeout, and an idle timeout?
- Why is a timeout at the average latency actively harmful?

---

#### 39. Which operations are safe to retry, and which are not? How do you make an unsafe one retryable?

*Difficulty:* 🟡 medium  ·  *Tags:* `retry`, `idempotency`, `exactly-once`, `error-handling`

Retry is only safe when the operation is **idempotent** — doing it twice has the same effect as doing it once. Reads (`GET`), and naturally-idempotent writes (`PUT` to an absolute value, `DELETE`) are safe. The danger is **non-idempotent writes** (charge a card, append a row, send a message): a retry after a *timeout* is the worst case, because a timeout means **you don't know whether it succeeded** — the request may have completed and only the response was lost. Blindly retrying double-charges. You make such an operation retryable by giving it an **idempotency key**: the client sends a unique key, the server records the key + result on first execution, and on a retry with the same key it returns the stored result instead of re-executing. That converts 'at-least-once delivery' into 'effectively-once' at the application layer. Also distinguish error classes: retry **transient** failures (timeouts, `503`, connection resets); do **not** retry deterministic ones (`400`, `401`, `404`, validation) — they'll fail identically and just waste capacity.

**Key points**
- Retry is safe only for idempotent operations
- A timeout is ambiguous: the write may have succeeded, response lost — blind retry double-applies
- Idempotency key (store key→result, return stored result on replay) makes non-idempotent ops retryable
- Retry transient errors (timeout/503/reset); never retry 4xx deterministic failures

**Follow-ups**
- Where do you store idempotency keys and how long do you keep them?
- Is HTTP POST idempotent? How do you make a POST safely retryable?

---

#### 40. Explain exponential backoff with jitter. Why is jitter essential, and what does 'full jitter' mean?

*Difficulty:* 🟡 medium  ·  *Tags:* `backoff`, `jitter`, `retry`, `thundering-herd`

Exponential backoff means each retry waits longer than the last — `base * 2^attempt`, capped at a max — so a struggling dependency gets exponentially more breathing room instead of being hammered at a fixed interval. The problem with *pure* exponential backoff is **synchronization**: if 10,000 clients all hit an error at the same instant (a deploy, a brief outage), they all back off by the same amount and **retry in lockstep**, recreating the spike at every retry boundary — a self-inflicted thundering herd. **Jitter** breaks the synchronization by randomizing the delay. 'Full jitter' (per the AWS architecture guidance) is `sleep = random_between(0, base * 2^attempt)` — the delay is a *uniform random* draw up to the exponential cap, not the cap itself. This spreads retries smoothly over the window and gives the best recovery in practice. 'Equal jitter' (`half the cap + random(0, half)`) is a milder variant. The point is: **backoff controls the rate of decay; jitter de-correlates the clients.** You need both.

**Key points**
- Backoff: delay = base * 2^attempt, capped — exponentially more room for a struggling dep
- Pure backoff synchronizes clients → lockstep retry spikes (self-inflicted herd)
- Jitter randomizes delay to de-correlate clients
- Full jitter = random(0, cap); spreads retries best (AWS guidance)

**Follow-ups**
- What max cap and total retry deadline would you set, and why?
- How does jitter interact with a retry budget?

---

#### 41. What is a retry storm (retry amplification), and how do retry budgets prevent it?

*Difficulty:* 🟠 hard  ·  *Tags:* `retry-storm`, `retry-budget`, `amplification`, `resilience`

A retry storm is when retries **amplify** load on an already-struggling system and push it from slow into dead. Two mechanisms: (1) **Per-hop multiplication.** If every layer retries 3× and you have 3 layers, one client request becomes up to 3×3×3 = 27 requests at the bottom — the deepest, most-loaded service sees the largest amplification exactly when it can least afford it. (2) **Correlated triggering.** A dependency hiccup makes *everyone* retry at once, so the retry traffic alone exceeds the dependency's capacity and it never recovers — the retries *are* the outage. Mitigations: **retry only at one layer** (usually the edge or the layer closest to the user), not every layer — deeper layers return the error and let the chosen layer decide. Add backoff + jitter. And cap retries with a **retry budget**: allow retries only while they're a small fraction of total traffic (e.g. a token bucket that permits retries up to 10% of requests, or gRPC's `retryThrottling` with a token balance). When the budget is exhausted, fail fast instead of retrying — so retries can help with *isolated* failures but can't snowball during a *systemic* one. Circuit breakers complement this by stopping calls to a dependency that's clearly down.

**Key points**
- Per-hop retries multiply (3 layers × 3 retries = 27× at the bottom)
- Correlated retries during an outage become the outage — dependency can't recover
- Retry at ONE layer only; deeper layers propagate the error up
- Retry budget / token-bucket throttle caps retries to a small % of traffic; fail fast when exhausted
- Pair with circuit breaker for a dependency that's down

**Follow-ups**
- How does gRPC's retryThrottling token balance work?
- Which single layer should own retries in a gateway → service → DB chain, and why?

---

#### 42. Why is the tail latency of a fan-out request worse than any single dependency's tail, and how do hedged requests help?

*Difficulty:* 🟠 hard  ·  *Tags:* `tail-latency`, `fan-out`, `hedged-requests`, `p99`

If a request fans out to N services in parallel and must wait for **all** of them, its latency is the **maximum** of N samples — and the max of many samples is dominated by the tail. Concretely, if each dependency has a 1% chance of being slower than its p99, then a fan-out to 100 of them has roughly `1 - 0.99^100 ≈ 63%` chance that *at least one* is in its slow tail. So a service composed of many fast dependencies can be reliably slow even though each part is usually fast — this is why **tail latency, not average, governs user-visible latency** at scale (Dean & Barroso, 'The Tail at Scale'). Mitigations: (1) **Hedged / backup requests** — send the request, and if no response by, say, the p95 deadline, send a *second* copy to another replica and take whichever returns first; cancel the loser. This converts a rare bad-replica tail into a near-best-case latency at the cost of a few % extra traffic (cap hedging to a small budget). (2) **Tied requests** (send to two, each cancels the other on start). (3) Reduce fan-out, or make the wait depend on a *quorum* / 'good enough' subset rather than all N.

**Key points**
- Wait-for-all fan-out latency = max of N samples → dominated by the tail
- 100 deps each 1% slow → ~63% chance one is in its tail (1 - 0.99^100)
- Tail latency, not average, governs user-visible latency at scale (Tail at Scale)
- Hedged requests: send a backup after p95, take the first response, cancel the rest (bounded budget)
- Also: tied requests, smaller fan-out, quorum/'good enough' subset

**Follow-ups**
- Why must hedging be budget-capped, and what does uncapped hedging do under load?
- When is hedging unsafe (non-idempotent work) and how do you handle it?

---

#### 43. What is deadline (timeout budget) propagation across a call chain, and why does each hop need a shrinking budget?

*Difficulty:* 🟠 hard  ·  *Tags:* `deadline-propagation`, `context`, `timeout`, `grpc`

When a request flows edge → service A → service B → DB, the **deadline should travel with it** and shrink at every hop, so no downstream wastes work the client will never wait for. The client sets an overall deadline (say 1s); the edge passes the *remaining* time to A; A, having spent 100ms, passes ~900ms to B; and so on. In Go this is exactly `context.WithTimeout` / `context.WithDeadline` carried through every call and across RPC boundaries (gRPC propagates the deadline in metadata automatically). Two failure modes it prevents: (1) **Wasted work** — without propagation, B happily spends 2s on a query for a request the client abandoned after 1s; that work consumes capacity and produces nothing. (2) **Inverted timeouts** — if a downstream's timeout is *longer* than the caller's, the caller times out and retries while the original call is still running, multiplying load. Each hop must also reserve a little budget for *itself* to do something useful on timeout (return a partial result, a fallback, or a clean error) rather than letting the deadline expire mid-flight. The rule: **downstream deadline < my remaining deadline < my caller's deadline**, always shrinking.

**Key points**
- Propagate the *remaining* deadline at every hop; it shrinks as time is spent
- Go: context.WithDeadline carried through calls; gRPC propagates it in metadata
- Prevents wasted downstream work on requests the client already abandoned
- Prevents inverted timeouts (downstream longer than caller → caller retries while call still runs)
- Reserve headroom per hop to return a fallback/clean error before expiry

**Follow-ups**
- How does gRPC propagate and enforce deadlines across services?
- What should a service do the moment its context is cancelled mid-query?

---

#### 44. How do timeouts, retries, and circuit breakers interact? Why isn't retrying enough on its own?

*Difficulty:* 🟡 medium  ·  *Tags:* `circuit-breaker`, `retry`, `timeout`, `resilience`

They form a layered defense and each covers a different failure shape. A **timeout** bounds a *single* slow call so it can't hang. **Retries (with backoff + jitter)** recover from *transient, isolated* failures — a dropped packet, one bad replica, a brief blip. But retries are exactly the wrong response to a *sustained* failure: if a dependency is down or overloaded, every call times out, then every call retries, and the retries pile more load on the thing that's already failing (the retry storm). That's what the **circuit breaker** is for: it watches the recent error/timeout rate, and once it crosses a threshold it **opens** — calls fail fast (no waiting on the timeout, no retry) for a cooldown, giving the dependency room to recover. After the cooldown it goes **half-open**, lets a trial trickle through, and closes again if they succeed. So the composition is: timeout bounds each attempt → retry/backoff handles blips → breaker stops the bleeding when blips become an outage → (optionally) a fallback serves a degraded response while open. Retrying alone handles the small stuff but *amplifies* the big stuff; the breaker is what makes the whole thing safe under sustained failure.

**Key points**
- Timeout bounds one call; retry/backoff handles transient blips; breaker handles sustained failure
- Retrying a down dependency amplifies load — wrong tool for systemic failure
- Breaker opens on high error rate → fail fast, no timeout wait, no retry → dependency recovers
- Half-open trial probes recovery before fully closing
- Add a fallback for a degraded response while open

**Follow-ups**
- What metrics drive the breaker's open/close decision and over what window?
- Should the breaker live in the caller, a sidecar, or the gateway?

---

#### 45. Using Little's Law, explain why latency explodes as a service approaches saturation — and what 'coordinated omission' hides in your latency numbers.

*Difficulty:* 🔴 staff  ·  *Tags:* `littles-law`, `queueing`, `saturation`, `coordinated-omission`, `load-testing`

**Little's Law:** `L = λ × W` — the average number of in-flight requests (L) equals arrival rate (λ) times average time in system (W). Rearranged, `W = L / λ`, and since a service has finite concurrency (L is capped by threads/goroutines/connections), as arrival rate λ climbs toward the service's capacity μ, the wait time W doesn't rise linearly — it goes to infinity. Queueing theory makes this sharp: for an M/M/1 queue, mean response time scales as `1/(μ - λ)`, so at 80% utilization latency is ~5× the unloaded service time, at 90% it's ~10×, at 95% ~20×. That's the 'hockey stick': latency is flat and fine, then a few percent more load tips it vertical. This is *why* you run services well below 100% utilization and why load-shedding/admission control beats letting the queue grow unbounded. **Coordinated omission** is the measurement trap that hides this: a closed-loop load tester (send request, wait for response, then send the next) *stops sending* while the system is slow, so it never records the requests that *would* have arrived during the stall — it only measures the lucky ones and reports a beautiful p99 while real users behind a fixed arrival rate are seeing seconds of latency. The fixes: use an **open-model** generator (fixed arrival rate regardless of responses), or correct for omission (e.g. HdrHistogram's coordinated-omission correction). The senior tell is reporting latency under load with the load model stated and coordinated omission accounted for — an uncorrected p99 from a closed-loop test is often off by orders of magnitude.

**Key points**
- Little's Law: L = λ×W; finite concurrency means W → ∞ as λ → capacity
- M/M/1: response time ~ 1/(μ-λ); ~5× at 80% util, ~10× at 90%, ~20× at 95% (the hockey stick)
- Run below saturation; shed load rather than grow an unbounded queue
- Coordinated omission: closed-loop testers stop sending during stalls → miss the slow requests → fake-good p99
- Fix: open-model load (fixed arrival rate) or HdrHistogram CO correction; always state the load model

**Follow-ups**
- Why does a closed-loop test under-report tail latency by orders of magnitude?
- How would you set a concurrency limit / admission control using these numbers?

---

## Replication & Quorum Reads/Writes

#### 46. Contrast synchronous and asynchronous replication. What does each cost you, and when do you pick which?

*Difficulty:* 🟡 medium  ·  *Tags:* `replication`, `durability`, `availability`, `failover`

With **synchronous replication** the leader doesn't acknowledge a write until at least one (or a quorum of) follower(s) has durably received it. You get **no data loss on leader failure** (the acked write survives), but you pay **latency** (every write waits for a network round-trip to a replica) and **availability**: if the synchronous follower is down or slow, writes stall. With **asynchronous replication** the leader acks immediately and ships the change to followers in the background. Writes are **fast and stay available** even if followers lag, but a leader crash can **lose** any writes not yet shipped — and worse, if you fail over to a follower that was behind, those acknowledged writes silently vanish (and may resurface as conflicts if the old leader returns). The pragmatic middle ground is **semi-synchronous**: one synchronous replica (durability floor) plus several async ones (read scaling), so you survive a single-node loss without paying a quorum round-trip on every write. Pick sync (or quorum) when losing an acked write is unacceptable — payments, ledgers; pick async when low write latency and availability matter more than the last few milliseconds of data — analytics, feeds, caches.

**Key points**
- Sync: no data loss on failover, but adds round-trip latency and couples availability to the replica
- Async: fast + available, but a leader crash loses un-shipped acked writes
- Failing over to a lagging async replica silently drops acknowledged writes
- Semi-sync (one sync + N async) is the common compromise
- Choose by cost of losing an acked write vs. write-latency/availability needs

**Follow-ups**
- How does Postgres synchronous_commit / synchronous_standby_names express this?
- What is the split-brain risk if the old async leader rejoins after failover?

---

#### 47. Derive the quorum condition R + W > N and explain what it does and does NOT guarantee.

*Difficulty:* 🟠 hard  ·  *Tags:* `quorum`, `leaderless`, `dynamo`, `consistency`

In a leaderless (Dynamo-style) system a value is stored on **N** replicas; a write waits for **W** acks and a read queries **R** replicas, returning the freshest version it sees. If **R + W > N**, the read set and the latest write set must **overlap in at least one replica**, so a read is guaranteed to see at least one copy of the most recent successful write — that's quorum 'strong-ish' consistency. Common choices: N=3, W=2, R=2 (overlap of 1). Tuning the knobs trades latency for guarantees: **W=N** gives durable writes but no write availability if any replica is down; **R=1, W=N** makes reads cheap and writes expensive (read-heavy); **W=1, R=N** the reverse. What R+W>N does **not** give you: it is **not** linearizability. It doesn't prevent **concurrent writes** from conflicting (you still need version vectors / last-writer-wins / CRDTs to reconcile), it doesn't stop **stale reads during in-flight writes** (the overlapping replica may not have applied the write yet), and **sloppy quorums + hinted handoff** (writing to *any* N healthy nodes during a partition) break the overlap guarantee entirely. Quorum gives you a *probabilistic recency floor*, not a total order.

**Key points**
- R+W>N forces read and write sets to overlap ≥1 replica → read sees latest acked write
- Tune W/R to trade write vs read availability/latency (W=N durable but fragile; R=1 cheap reads)
- NOT linearizability; concurrent writes still need vector clocks / LWW / CRDTs
- Sloppy quorum + hinted handoff sacrifices the overlap guarantee for availability
- It's a recency floor, not a total order

**Follow-ups**
- Why is last-writer-wins dangerous under clock skew?
- How does read-repair fix the replica that was behind?

---

#### 48. What are read-repair, anti-entropy, and hinted handoff, and what failure does each address?

*Difficulty:* 🟡 medium  ·  *Tags:* `read-repair`, `anti-entropy`, `merkle-tree`, `hinted-handoff`

These are the three convergence mechanisms a leaderless store (Cassandra, Dynamo, Riak) uses to heal divergence between replicas. **Read-repair** is *opportunistic*: when a read queries R replicas and notices one returned a stale value, it writes the newest version back to the laggard inline (or just after responding). It's cheap and fixes exactly the keys you actually read — but cold keys never get repaired this way. **Anti-entropy** is the *background sweep* that catches the cold keys: replicas periodically compare their datasets using **Merkle trees** (hash trees over key ranges) so they exchange only the ranges that differ instead of shipping everything, then reconcile. **Hinted handoff** addresses *writes during a transient outage*: if a target replica is down, a healthy coordinator stores the write plus a **hint** ('this belongs to node X') and replays it to X when it comes back — so a brief node failure doesn't reduce durability or reject the write. Together: hinted handoff keeps writes flowing during blips, read-repair heals hot keys on access, anti-entropy guarantees eventual convergence of everything. They're why 'eventually consistent' eventually actually converges.

**Key points**
- Read-repair: fix stale replicas inline on read; only touches keys you read
- Anti-entropy: background Merkle-tree comparison repairs cold keys, exchanges only differing ranges
- Hinted handoff: store+replay writes for a temporarily-down replica so writes stay durable/available
- Together they make 'eventual consistency' actually converge

**Follow-ups**
- Why Merkle trees instead of comparing every key?
- What happens to hints if the down node never returns?

---

#### 49. Replication lag: what concrete anomalies does it cause, and how do you give a user read-your-writes without making every read hit the leader?

*Difficulty:* 🟠 hard  ·  *Tags:* `replication-lag`, `read-your-writes`, `monotonic-reads`, `causal-consistency`

Async replicas lag the leader by anywhere from milliseconds to (under load) seconds. Routing reads to a lagging replica produces three classic anomalies: **read-your-writes violation** (a user updates their profile, the next read hits a stale replica and shows the old value — looks like the write was lost); **monotonic-reads violation** (successive reads bounce between replicas at different lag, so data appears to go *backwards* in time); and **causal anomalies** (you see a reply before the comment it answers). Fixes that avoid pinning everything to the leader: (1) **Read-your-writes** — after a user writes, route *that user's* reads to the leader (or to a replica known to be caught up) for a short window, e.g. by remembering the write's log position (LSN/offset) and only reading from a replica whose applied position ≥ it. (2) **Monotonic reads** — sticky-route a given user to the *same* replica so they never see an older one. (3) **Causal consistency** — attach version/dependency tokens so a read waits until the replica has applied the causally-prior writes. The general tool is **passing the write's position back to the client** and using it as a read freshness bound — strong where it matters, cheap everywhere else.

**Key points**
- Lag → read-your-writes, monotonic-reads, and causal anomalies (replies before comments)
- Read-your-writes: route the writer's reads to leader/caught-up replica for a window, or gate by LSN
- Monotonic reads: sticky a user to one replica
- Causal: dependency tokens; read waits for prior writes to apply
- General pattern: return the write position, use it as a per-read freshness bound

**Follow-ups**
- How would you implement the LSN/offset freshness check in practice?
- What does monitoring replication lag well look like (and why is max, not avg, the metric)?

---

## Membership, Gossip & Failure Detection

#### 50. Why is perfect failure detection impossible in an asynchronous network, and what does that force you to trade off?

*Difficulty:* 🟠 hard  ·  *Tags:* `failure-detection`, `flp`, `asynchrony`, `timeout`

In an **asynchronous** system you cannot distinguish a **crashed** node from a **slow** node or a **dropped/ delayed message** — there's no bound on message delay or processing time, so 'no response yet' could mean dead or could mean 'reply is still in flight.' This is the core of the **FLP impossibility** result: no deterministic failure detector can be both **complete** (always eventually suspects a truly dead node) and **accurate** (never wrongly suspects a live one). So every real detector picks a point on a trade-off curve governed by its **timeout**: a short timeout detects failures fast but produces **false positives** (healthy-but-slow nodes get declared dead → unnecessary failovers, data movement, flapping); a long timeout avoids false positives but is **slow to react** (a truly dead node keeps getting traffic for seconds). Practical systems lean toward *eventual* accuracy and add hysteresis: require N consecutive misses, use **adaptive** thresholds that learn the normal latency distribution (phi-accrual), or escalate from 'suspect' to 'confirmed dead' only after corroboration from other members. You can't eliminate the trade-off — you can only tune where you sit on it and make the consequences of a false positive cheap.

**Key points**
- Async network: can't tell crashed from slow from delayed message
- FLP / detector theory: can't be both complete and accurate deterministically
- Short timeout → fast detection but false positives (flapping, needless failover)
- Long timeout → no false positives but slow reaction (dead node still served)
- Mitigate with consecutive-miss thresholds, adaptive (phi-accrual), and corroboration before 'dead'

**Follow-ups**
- What real damage does a false-positive 'node dead' cause in a sharded store?
- How does a 'suspect' state (vs binary alive/dead) help?

---

#### 51. Explain how the SWIM gossip protocol detects failures and disseminates membership, and why it scales better than all-to-all heartbeats.

*Difficulty:* 🟠 hard  ·  *Tags:* `swim`, `gossip`, `membership`, `epidemic`

Naive membership has every node heartbeat every other node — **O(N²)** messages, and a hot spot as N grows. **SWIM** (Scalable Weakly-consistent Infection-style Membership) decouples *detection* from *dissemination* and makes both roughly **O(1) per node per period**. **Detection:** each period a node picks **one random** member and pings it. If no ack, it doesn't immediately declare death — it asks **k other random members to ping that target on its behalf** (indirect probing), which routes around a single bad network path and slashes false positives. Only if the direct and all indirect probes fail does it mark the target **suspect**, then **dead** after a timeout. **Dissemination:** membership changes (join/leave/suspect/dead) **piggyback** on the normal ping/ack messages and spread **epidemically** (gossip) — each node that learns a fact retells it to a few others, so the whole cluster converges in **O(log N)** rounds without a broadcast storm. The result: per-node load is constant regardless of cluster size, detection time is bounded and tunable, and there's no central coordinator. SWIM (and its hardened variant in HashiCorp's **memberlist/Serf**) is why systems like Consul scale membership to thousands of nodes.

**Key points**
- All-to-all heartbeats are O(N²) and hot-spot; SWIM is ~O(1) per node per period
- Detection: random direct ping → k indirect pings (route around bad paths, cut false positives) → suspect → dead
- Dissemination: piggyback membership updates on pings, spread epidemically in O(log N) rounds
- No central coordinator; per-node cost independent of N
- Used by HashiCorp memberlist/Serf/Consul

**Follow-ups**
- What does the 'suspect' subprotocol with refutation add over a binary dead flag?
- How do you bound how stale membership can be?

---

#### 52. What is a phi-accrual failure detector and why is an 'accrual' (continuous) suspicion level better than a binary alive/dead flag?

*Difficulty:* 🟡 medium  ·  *Tags:* `phi-accrual`, `failure-detection`, `adaptive`, `cassandra`

A binary detector forces a single hard timeout: below it the node is 'alive,' above it 'dead' — one threshold for all consumers, and it can't adapt to changing network conditions. A **phi-accrual** detector instead outputs a **continuous suspicion value φ** that rises the longer it's been since the last heartbeat, *relative to the recently observed heartbeat-interval distribution*. Concretely it tracks the inter-arrival times of heartbeats, fits a distribution (often normal over a sliding window), and computes φ = −log10(probability that a heartbeat *this late* is still normal). φ≈1 means ~10% chance it's a real failure, φ≈8 means ~99.999999%. Two big wins: (1) **Adaptivity** — if the network is normally jittery, the learned distribution widens and φ rises more slowly, so you don't false-positive on a slow-but-fine link; on a normally-tight link φ spikes fast. (2) **Per-consumer thresholds** — a cheap operation can act at φ=1 (react fast, tolerate some false positives), while an expensive irreversible one (trigger a failover, move shards) waits for φ=8. You decouple 'how suspicious' from 'what action,' which a binary flag can't express. It's used in **Akka** and **Cassandra**.

**Key points**
- Outputs continuous φ (suspicion level), not alive/dead
- φ = −log10(P(heartbeat this late is still normal)) over the observed interval distribution
- Adaptive: learns normal jitter, so it doesn't false-positive on a normally-slow link
- Per-consumer thresholds: cheap actions at low φ, irreversible ones at high φ
- Used in Cassandra and Akka

**Follow-ups**
- What window/decay would you use so a brief GC pause doesn't poison the distribution?
- How would you pick the φ threshold for triggering a shard rebalance?

---

## Backpressure & Flow Control

#### 53. What is backpressure, and why is unbounded buffering the most common way distributed pipelines fall over?

*Difficulty:* 🟡 medium  ·  *Tags:* `backpressure`, `buffering`, `queueing`, `overload`

**Backpressure** is a fast producer being *slowed down* by a slow consumer — the downstream signals 'I'm full, stop sending' and that signal propagates upstream until the source itself eases off. The failure mode it prevents is **unbounded buffering**: when a stage can't keep up, the naive reaction is to queue the overflow 'temporarily.' But if the producer is persistently faster than the consumer, that queue grows without bound and you get the worst outcome in stages: first **latency explodes** (every item now waits behind a huge backlog — a queue that's always full adds pure delay, per Little's Law), then you **exhaust memory** and the process **OOM-crashes**, dropping not just the overflow but *everything in flight*, often cascading as the crash makes you even slower on restart. Unbounded queues turn a manageable overload into a hard outage and convert a throughput problem into a reliability one. The discipline is: **bound every queue**, and when the bound is hit, make an explicit choice — block the producer (propagate backpressure), shed load (drop/reject with 429/503), or sample — rather than silently buffering. A bounded queue that rejects is honest; an unbounded one that grows is a time bomb.

**Key points**
- Backpressure = slow consumer throttles fast producer; signal propagates to the source
- Unbounded buffering: latency explodes (always-full queue = pure added delay), then OOM
- An OOM crash drops everything in flight and can cascade on restart
- Bound every queue; on full, choose explicitly: block, shed (429/503), or sample
- Bounded-and-reject is honest; unbounded-and-grow is a time bomb

**Follow-ups**
- Why does an always-full bounded queue still hurt latency even though it doesn't OOM?
- Where would you rather drop load: at the edge or deep in the pipeline?

---

#### 54. When a bounded queue fills, your options are block, drop, or shed. How do you choose, and what does each do to the caller?

*Difficulty:* 🟠 hard  ·  *Tags:* `load-shedding`, `backpressure`, `bounded-queue`, `overload`

All three are valid; the right one depends on whether the work is **droppable** and whether the producer can be **slowed**. **Block (propagate backpressure):** the producer waits until space frees up. Correct when the producer *can* slow down and every item *must* be processed — e.g. a Kafka consumer pipeline, an ETL job. The risk is that blocking propagates: if you block a request handler, you tie up its goroutine/connection and the backpressure reaches the *client*, which is fine for internal pipelines but bad for a user-facing API (you've turned 'slow' into 'hung'). **Drop / sample:** discard items when full. Correct when work is **loss-tolerant** and freshness beats completeness — metrics, traces, logs, live telemetry (a dropped 1% of metrics is fine; a hung metrics pipeline is not). **Shed (reject):** actively return `429`/`503` *fast* to the caller so *they* decide (retry with backoff, degrade, give up). Correct for **user-facing** request paths — failing fast keeps latency bounded and lets the client apply its own policy, far better than queueing a request the user already abandoned. The senior framing: at the **edge**, shed (fail fast, protect latency); inside a **must-not-lose pipeline**, block (propagate backpressure to the source); for **loss-tolerant telemetry**, drop/sample. And always prefer shedding *early* (cheap reject before expensive work) over shedding late.

**Key points**
- Block: producer waits; for slow-able producers + must-process work (pipelines/ETL); risk: hangs a user-facing path
- Drop/sample: for loss-tolerant work where freshness > completeness (metrics/logs/traces)
- Shed (429/503 fast): for user-facing requests; caller decides retry/degrade; keeps latency bounded
- Rule of thumb: edge → shed, must-not-lose pipeline → block, telemetry → drop
- Shed early (cheap reject before expensive work)

**Follow-ups**
- Why is shedding a request better than queueing one the user has already timed out on?
- How does load shedding interact with a client's retry policy (and how do you avoid amplification)?

---

#### 55. How do Go channels and context cancellation express backpressure, and how do you get end-to-end backpressure across a multi-stage pipeline?

*Difficulty:* 🟠 hard  ·  *Tags:* `go`, `channels`, `context`, `backpressure`

A **buffered channel of bounded capacity is itself a backpressure primitive**: a sender blocks on `ch <- v` once the buffer is full, so a slow downstream stage automatically throttles the upstream one — the block *is* the backpressure signal, no extra protocol needed. An **unbuffered** channel is maximal backpressure (sender waits for a receiver). The classic mistake is an *unbounded* buffer (e.g. spawning a goroutine per item, or appending to a slice) which removes the block and reintroduces unbounded buffering. For an **end-to-end** pipeline (stage A → B → C via channels), you chain bounded channels so a stall in C fills B's input, which makes B stop reading from A's output, which blocks A, which slows the source — backpressure propagates all the way back by construction. **`context`** carries the *cancellation* side: when a consumer gives up (deadline, client disconnect), cancelling the context lets every stage `select { case <-ctx.Done(): return ... }` and stop producing work nobody will read — so backpressure (slow down) and cancellation (stop entirely) together bound both memory and wasted work. Two rules keep it honest: (1) **never spawn an unbounded number of goroutines** to 'absorb' load — that's unbounded buffering in disguise; use a fixed worker pool reading from a bounded channel. (2) Always `select` on `ctx.Done()` alongside channel ops so a stuck send/receive can't leak a goroutine forever.

**Key points**
- A bounded buffered channel IS backpressure: a full buffer blocks the sender
- Unbuffered = max backpressure; unbounded buffer (goroutine-per-item) destroys it
- Chain bounded channels → a downstream stall propagates blocking back to the source
- context cancellation = the 'stop entirely' signal; select on ctx.Done() in every stage
- Fixed worker pool over a bounded channel; never spawn unbounded goroutines to absorb load

**Follow-ups**
- How does goroutine-per-request without a bound become an OOM under load?
- How would you add a timeout so a stuck stage sheds instead of blocking forever?

---
