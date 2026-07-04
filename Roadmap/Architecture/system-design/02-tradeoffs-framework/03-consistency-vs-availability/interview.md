# Consistency vs Availability — Interview Questions

A focused question bank on the consistency/availability trade-off: the spectrum
from strong to weak consistency, what eventual consistency actually promises,
the session guarantees that hide replication lag from a single user, replication
modes and how they set your RPO, leader failover and split-brain prevention,
conflict resolution, quorums, the formal consistency models, and — most
importantly — how to pick a consistency level per feature using a staleness
budget rather than a slogan.

Each question is followed by a model answer in a blockquote. Interviewers are
not looking for the textbook definition of CAP; they are looking for whether you
can map a business requirement to a concrete replication and read/write policy,
and whether you understand the failure modes that bite in production.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Staff / Judgment Questions](#staff--judgment-questions)

---

## Junior Questions

**Q1: Define strong, eventual, and weak consistency.**

> These three points sit on a single spectrum that describes *what a read can
> observe relative to recent writes*.
>
> - **Strong consistency**: once a write commits, every subsequent read — from
>   any client, on any replica — returns that write (or a newer one). There is
>   no observable window where the old value is still visible. The system
>   behaves as if there were a single copy of the data. Reading your bank
>   balance after a withdrawal must reflect the withdrawal.
> - **Eventual consistency**: if writes stop, all replicas *converge* to the
>   same value after some unspecified delay. Before convergence, different
>   replicas may return different (stale) values. There is no bound on how stale
>   a read can be, only the promise that staleness does not last forever.
> - **Weak consistency**: the system makes *no* convergence promise at all in
>   the general case — a read may never reflect a particular write, and the
>   application is responsible for tolerating or repairing divergence. In
>   practice "weak" is often used loosely for "best-effort, no guarantees."
>
> A common framing: strong consistency trades latency and availability for
> correctness; eventual consistency trades freshness for latency and
> availability. The right choice depends on what a stale read costs the
> business.

**Q2: What does eventual consistency guarantee — and what does it *not*?**

> **It guarantees** convergence: in the absence of new writes, all replicas will
> eventually agree on the same value, and that value will be one of the values
> actually written (the system does not invent data).
>
> **It does not guarantee:**
> - **Freshness** — a read may return arbitrarily old data. There is no time
>   bound unless you add one (e.g., "bounded staleness").
> - **Read-your-own-writes** — you can write, then immediately read a replica
>   that has not yet received your write, and see the old value.
> - **Monotonic reads** — two consecutive reads can go *backwards* in time if
>   they hit different replicas at different lag.
> - **Ordering across keys** — updates to different keys may become visible in
>   different orders on different replicas, unless the model also provides
>   causal consistency.
>
> The classic interview trap is to assume eventual consistency means "consistent
> after a short delay." It means "consistent *eventually*, with no promise about
> when," and the gaps above are exactly the bugs juniors ship.

**Q3: Give a concrete example where strong consistency is required and one where eventual is fine.**

> **Strong required — moving money.** If I transfer $100 from account A to B, the
> debit and credit must be atomic and globally visible. A stale read that lets me
> spend the same balance twice is a double-spend; that is a correctness bug with
> direct financial and legal consequences. Inventory decrement for a
> last-unit-in-stock purchase is the same shape.
>
> **Eventual is fine — a like counter.** If a photo has 10,402 likes and you
> briefly see 10,400 because your read hit a lagging replica, nothing is harmed.
> The number converges within seconds, no user can tell, and the cost of making
> it strongly consistent (cross-region coordination on every like) would be
> absurd relative to the value.
>
> The judgment skill is recognizing which bucket a feature falls into, and that
> most features in a real product are the second kind.

**Q4: What is replication and why do we replicate data at all?**

> Replication means keeping copies of the same data on multiple nodes. We do it
> for three independent reasons:
>
> - **Availability / fault tolerance** — if one node dies, another copy can
>   serve the data, so a single hardware failure does not cause an outage or
>   data loss.
> - **Read scalability** — read traffic can be spread across replicas, which is
>   how read-heavy systems scale beyond one machine's throughput.
> - **Latency** — placing a replica near the user (same region) cuts the
>   round-trip time for reads.
>
> Replication is also the *source* of the consistency problem: the moment you
> have more than one copy, you must decide what happens when a client reads a
> copy that has not yet received the latest write. That decision is the
> consistency model.

**Q5: What is replication lag, and what user-visible bug does it cause?**

> Replication lag is the delay between a write committing on the leader and that
> write becoming visible on a follower replica. Under normal load it might be a
> few milliseconds; under heavy write load, a slow network, or a long-running
> follower query, it can spike to seconds or worse.
>
> The canonical user-visible bug: a user posts a comment (write goes to the
> leader), the page reloads and reads from a follower that is 200 ms behind, and
> the comment they *just submitted* is not there. The user thinks the action
> failed and re-submits, creating a duplicate. This is precisely the bug that the
> **read-your-writes** session guarantee exists to fix.

---

## Middle Questions

**Q6: Explain the session guarantees: read-your-writes and monotonic reads. What bug does each fix?**

> Session guarantees are *per-client* consistency promises that are much cheaper
> than global strong consistency, because they only need to hold within one
> user's session — they hide replication lag from that user without coordinating
> all replicas.
>
> | Guarantee | Promise | Bug it fixes |
> |-----------|---------|--------------|
> | **Read-your-writes** (read-after-write) | After a client writes value X, that client's later reads return X or newer | "I posted a comment but it vanished on reload" |
> | **Monotonic reads** | If a client reads X, later reads never return a value *older* than X | Refresh shows a comment, refresh again shows it gone (time travels backward) |
> | **Monotonic writes** | A client's writes are applied in the order it issued them | Edit A then edit B; replicas apply B then A |
> | **Writes-follow-reads** | A write that depends on a read is ordered after the value it read | Reply to a comment becomes visible before the comment it replies to |
>
> **How to implement them cheaply:**
> - *Read-your-writes*: route a user's reads to the leader for a short window
>   after they write, or pin them to a replica known to have their write (track
>   the write's log position / timestamp and only read from replicas caught up
>   past it).
> - *Monotonic reads*: pin each user to the same replica (sticky routing by
>   user/session id), so they never jump to a less-advanced replica.
>
> The key insight: these solve the *most common* lag complaints without paying
> for global linearizability, which is why almost every read-replica setup
> implements them.

**Q7: Compare synchronous and asynchronous replication across consistency, latency, and durability.**

> The choice is about *when the leader acknowledges the write to the client*
> relative to *when followers have it*.
>
> | Property | Synchronous | Asynchronous |
> |----------|-------------|--------------|
> | Leader acks after | follower(s) confirm the write | leader's own commit only |
> | Write latency | higher (waits for slowest acked follower + RTT) | low (no follower wait) |
> | Durability on leader failure | strong — acked write exists on a follower | weak — recent acked writes can be lost |
> | Data loss window (RPO) | ~zero for acked writes | up to the replication lag |
> | Availability of writes | a slow/down sync follower can block writes | writes proceed regardless of follower health |
>
> **Semi-synchronous** is the common middle ground: one follower is synchronous
> (guarantees one durable copy and a small RPO) while the rest are asynchronous
> (so reads still scale and one slow follower doesn't stall writes). If the sync
> follower fails, another is promoted to sync.
>
> The trade in one sentence: synchronous buys you durability and zero-loss
> failover at the cost of write latency and write availability; asynchronous
> buys you low latency and write availability at the cost of a non-zero
> data-loss window.

**Q8: What are RPO and RTO, and how does replication mode set RPO?**

> - **RPO (Recovery Point Objective)** — the maximum amount of *data* you can
>   afford to lose, expressed as a time window. "RPO = 5 minutes" means after a
>   disaster you may lose up to the last 5 minutes of writes.
> - **RTO (Recovery Time Objective)** — the maximum *downtime* you can tolerate
>   before service is restored. "RTO = 2 minutes" means failover must complete
>   within 2 minutes.
>
> RPO is set almost directly by replication mode:
> - **Synchronous replication → RPO ≈ 0** for acknowledged writes, because every
>   acked write already lives on a second node before the client is told it
>   succeeded.
> - **Asynchronous replication → RPO ≈ current replication lag** at the moment
>   of failure. If the follower is 8 seconds behind when the leader's disk dies,
>   you lose up to 8 seconds of writes.
> - **Periodic backup / log shipping → RPO ≈ backup interval** (e.g., snapshot
>   every 15 min → RPO up to 15 min, plus any unshipped WAL).
>
> RTO, by contrast, is set by *failover machinery* — how fast you detect the
> failure, elect/promote a new leader, and redirect traffic — not by replication
> mode. A common mistake is conflating them: you can have RPO = 0 (sync rep) but
> RTO = 10 minutes (slow manual failover), or vice versa.

**Q9: Walk through a leader failover. What can go wrong?**

> A typical leader-based failover has three steps:
>
> 1. **Detect** the leader is dead (heartbeat timeout from followers or an
>    external coordinator).
> 2. **Elect/choose** a new leader — usually the follower with the most
>    up-to-date log.
> 3. **Reconfigure** — point writes at the new leader and tell other followers to
>    replicate from it.
>
> What goes wrong:
> - **Lost writes (RPO)**: with async replication, writes that reached the old
>   leader but not the new one are lost when the new leader takes over. If those
>   writes generated side effects elsewhere (e.g., an autoincrement id reused),
>   you get corruption.
> - **Split-brain**: the old leader wasn't actually dead (just unreachable) and
>   keeps accepting writes while the new leader also accepts writes — two
>   leaders, diverging data.
> - **Bad timeout tuning**: too short → unnecessary failovers (flapping) during
>   transient load; too long → extended outage (bad RTO).
> - **Cascading load**: the promoted node and a cold cache get hit by full
>   traffic and fall over.
>
> Split-brain is the dangerous one because it silently corrupts data rather than
> just causing downtime.

**Q10: What is split-brain and how do you prevent two leaders?**

> Split-brain is when a network partition (or a falsely-suspected-dead leader)
> results in two nodes each believing they are the leader and both accepting
> writes. The two histories diverge and must later be merged, often with
> unrecoverable loss.
>
> Prevention mechanisms, usually combined:
>
> - **Quorum / majority for election**: a node may only become leader if a
>   *majority* of nodes vote for it. With an odd cluster size, the minority side
>   of a partition cannot form a majority, so it cannot elect a leader — only one
>   side can have a leader. This is the foundation of Raft/Paxos-style systems.
> - **Leases**: a leader holds a time-bounded lease; it must renew before
>   expiry. If it can't renew (partitioned), it must *stop serving* writes before
>   the lease expires, and only after expiry can a new leader be granted.
> - **Fencing tokens / epochs**: every leadership term gets a monotonically
>   increasing number (epoch). Storage and downstream systems reject any write
>   tagged with an epoch lower than the highest they've seen. So even if a
>   zombie old leader tries to write, its stale epoch is fenced out.
> - **STONITH** ("shoot the other node in the head"): physically/forcibly power
>   off the suspected old leader before promoting, common in HA pairs.
>
> The robust pattern is *majority election + leases + fencing tokens*: majority
> ensures at most one leader is granted, leases bound how long a partitioned old
> leader can linger, and fencing tokens make sure a delayed write from a deposed
> leader is rejected even if it arrives late.

**Q11: What is a quorum, and what does W + R > N give you?**

> In a system with **N** replicas per key, where each write must be acknowledged
> by **W** replicas and each read must collect responses from **R** replicas:
>
> - The condition **W + R > N** guarantees that the set of replicas a read
>   contacts *overlaps* with the set that acknowledged the latest write by at
>   least one node. That overlapping node holds the newest value, so a quorum
>   read can find it (using version numbers/timestamps to pick the freshest).
> - This gives **read-after-write consistency** for a single key even without a
>   single leader, which is why Dynamo-style systems use it.
>
> Worked example, N = 3:
> - W = 2, R = 2 → 2 + 2 = 4 > 3 ✅ overlap guaranteed; tolerates 1 node down for
>   both reads and writes. This is the standard balanced choice.
> - W = 3, R = 1 → 4 > 3 ✅ fast reads, but writes need *all* nodes — a single
>   slow/down node blocks writes (poor write availability).
> - W = 1, R = 1 → 2 < 3 ❌ no overlap guarantee — fast and available but you can
>   read stale data (this is essentially eventual consistency).
>
> So W and R are *tunable knobs* that slide the same cluster along the
> consistency/availability spectrum without changing the data model. Caveats:
> quorum overlap protects a *single key*; it does not give you transactions
> across keys or linearizability in the presence of concurrent writes and
> failures (read-repair and sloppy quorums complicate the simple picture).

---

## Senior Questions

**Q12: Distinguish linearizability, serializability, and causal consistency.**

> These are three different "consistency" words that interviewers love to see
> conflated.
>
> | Model | Scope | Promise | Cost |
> |-------|-------|---------|------|
> | **Linearizability** | single object, real-time | every operation appears to take effect atomically at some point between its call and return; reads see the latest completed write (recency) | requires coordination (consensus / leader), latency, reduced availability under partition |
> | **Serializability** | multi-object transactions | concurrent transactions produce a result equal to *some* serial order of them | isolation-level concern; doesn't by itself promise real-time recency |
> | **Causal consistency** | operations with happens-before relationships | causally related operations are seen in the same order by everyone; concurrent ops may be seen in any order | achievable while staying available under partition (no global coordination) |
>
> Key distinctions:
> - **Linearizability** is about *recency and a single up-to-date copy* — a
>   single-object guarantee. **Serializability** is about *transaction
>   isolation* — a multi-object guarantee. They are orthogonal; "strict
>   serializability" is the combination (serializable *and* respecting real-time
>   order).
> - **Causal consistency** is the strongest model that can be provided while
>   remaining available during a network partition (it doesn't require seeing the
>   single latest write, only respecting cause→effect). That makes it the
>   sweet-spot model for many geo-distributed systems: it kills the most
>   confusing anomalies (reply-before-comment) without paying for global
>   coordination.

**Q13: How do you choose a consistency level for: a bank balance, a like count, and a shopping cart?**

> I map each to a *staleness cost* and pick the cheapest model that keeps that
> cost acceptable.
>
> | Feature | Cost of a stale/wrong read | Chosen model | Rationale |
> |---------|---------------------------|--------------|-----------|
> | **Bank balance / transfer** | double-spend, real money, regulatory | strong / linearizable (single leader or consensus, often with serializable transactions for the transfer) | correctness is non-negotiable; coordination cost is justified |
> | **Like count** | user sees a slightly off number for seconds | eventual; often an approximate/CRDT counter | nobody is harmed by ±2 for a moment; coordinating every like is wasteful |
> | **Shopping cart** | items briefly disappear/reappear across devices | eventual + conflict resolution that **merges** (union of items), e.g. an add-wins CRDT | availability matters (never block "add to cart"); losing an item is worse than keeping a removed one, so merge by union, then reconcile at checkout |
>
> The shopping cart is the interesting one: it's the Dynamo case. You want high
> availability (always accept "add to cart"), so you allow concurrent writes from
> multiple replicas/devices and resolve conflicts by *merging* rather than
> picking a winner — Amazon's classic example, where the worst outcome is a
> previously-removed item reappearing, which is recoverable at checkout, versus
> dropping an item the user wanted to buy.

**Q14: Critique last-write-wins. When is it dangerous?**

> Last-write-wins (LWW) resolves concurrent writes by keeping the one with the
> highest timestamp and discarding the rest. It's attractive because it's simple
> and stateless — but it has two serious failure modes:
>
> - **Silent data loss**: when two clients write concurrently, LWW *throws away*
>   one of them with no error. If both writes were meaningful (two users editing
>   different fields of the same record), one user's change just vanishes. LWW is
>   only safe when losing a concurrent write is genuinely acceptable.
> - **Clock dependence**: "highest timestamp" relies on wall-clock time across
>   machines, which suffers from skew. A node with a fast clock can have its
>   writes always win, or a delayed write with a future timestamp can mask later
>   legitimate writes. NTP skew of even tens of milliseconds is enough to lose
>   data under contention.
>
> LWW is appropriate for immutable/append-only data, or fields where the latest
> value is genuinely the only one that matters (e.g., "last seen at"). It is
> dangerous for anything where concurrent writes carry independent intent.
> Mitigations: use a logical clock (Lamport/hybrid logical clock) instead of wall
> time to make the ordering deterministic and skew-resistant, or — better — use a
> conflict-resolution scheme that *preserves* both writes (vector clocks to
> detect concurrency, or a CRDT to merge).

**Q15: At a high level, how do vector clocks and CRDTs help with conflict resolution?**

> Both attack the same problem — concurrent writes to the same key on different
> replicas — but at different layers.
>
> - **Vector clocks** *detect* concurrency. Each replica keeps a per-replica
>   counter; a write carries the vector of counters it saw. Comparing two
>   versions' vectors tells you whether one *causally precedes* the other (safe
>   to overwrite) or whether they are *concurrent* (a true conflict). Vector
>   clocks don't resolve the conflict — they hand the application a set of
>   "sibling" versions and say "you decide." That's strictly more honest than
>   LWW, because no write is silently dropped; the cost is the application must
>   handle siblings.
> - **CRDTs (Conflict-free Replicated Data Types)** *resolve* concurrency
>   automatically by construction. They define a merge operation that is
>   commutative, associative, and idempotent, so replicas applying the same set
>   of updates in any order converge to the same state with no coordination.
>   Examples: a G-Counter (grow-only counter that sums per-replica counts), a
>   PN-Counter (increments + decrements), an OR-Set (add-wins set, great for a
>   shopping cart), and sequence CRDTs for collaborative text.
>
> The mental model: vector clocks give you *detect-then-let-the-app-merge*; CRDTs
> give you *the merge is already proven correct, just apply it*. CRDTs are the
> right tool when you can express your data in one of their algebras; vector
> clocks (or application-specific merge) are the fallback when you can't.

**Q16: Use a staged diagram to explain how a quorum read finds the latest write when one replica is stale.**

> Consider N = 3, W = 2, R = 2. A write commits on two replicas; the third lags.
> A read then contacts a quorum of two and reconciles by version.
>
> **Stage 1 — write reaches a write-quorum (2 of 3):**
>
> ```mermaid
> flowchart LR
>   C[Client write v5] --> A[(Replica A: v5)]
>   C --> B[(Replica B: v5)]
>   C -. lagging .-> D[(Replica D: v4)]
> ```
>
> **Stage 2 — read contacts a read-quorum that overlaps the write set:**
>
> ```mermaid
> flowchart LR
>   R[Client read] --> B2[(Replica B: v5)]
>   R --> D2[(Replica D: v4)]
>   B2 -- v5 --> M{Compare versions}
>   D2 -- v4 --> M
>   M -- pick highest --> Ans[Return v5]
> ```
>
> **Stage 3 — read-repair propagates the fresh value back to the stale node:**
>
> ```mermaid
> flowchart LR
>   Ans2[Coordinator saw v5] -- repair --> D3[(Replica D: v4 -> v5)]
> ```
>
> Because W + R = 4 > N = 3, the read quorum {B, D} is guaranteed to include at
> least one node from the write quorum {A, B} — here, B — so v5 is always present
> in the read set. Version numbers let the coordinator pick v5 over v4, and
> read-repair lazily heals the stale replica D. This is how a leaderless system
> delivers read-after-write on a single key without a single leader.

**Q17: What is bounded staleness, and when do you choose it over strong or eventual?**

> Bounded staleness is a consistency model that puts a *cap* on how stale a read
> can be — either by time ("reads are at most 5 seconds behind the latest write")
> or by version ("at most K versions behind"). It sits between strong and
> eventual: weaker than strong (you can read slightly old data) but stronger than
> eventual (the staleness is *bounded*, not arbitrary).
>
> You choose it when:
> - Strong consistency's coordination latency is too expensive for the read
>   volume, **but**
> - Unbounded staleness is unacceptable to the business — e.g., a stock-price
>   ticker where "a few seconds old" is fine but "two minutes old" misleads
>   traders, or a leaderboard where you want eventual-ish performance with a
>   freshness SLA.
>
> Operationally, bounded staleness gives you a concrete number to monitor and
> alert on (replication lag vs. the bound), which turns a fuzzy "eventually" into
> an SLO. Azure Cosmos DB exposes exactly this as a first-class level, which is
> why it shows up in interviews.

**Q18: How can a multi-leader / active-active topology stay available, and what's the catch?**

> In a multi-leader setup, more than one node accepts writes — typically one
> leader per region. Each leader applies writes locally and asynchronously
> replicates to the others. The win is **write availability and low write
> latency everywhere**: a region keeps accepting writes even if it's partitioned
> from the others, and users write to their nearest leader.
>
> The catch is **write conflicts**: because two regions can write the same key
> concurrently, you *will* get conflicting versions, and there is no single
> authority to order them. So multi-leader inherently requires a conflict
> strategy — LWW (lossy), application merge, vector-clock siblings, or CRDTs.
> Multi-leader also makes it easy to violate causal ordering across keys unless
> you explicitly track causality.
>
> The honest summary: multi-leader trades the simplicity of a single source of
> truth for availability and locality, and you pay for it in conflict-handling
> complexity. It's worth it for geo-distributed, write-anywhere workloads (and
> collaborative editing, where CRDTs make the conflicts tractable); it's
> overkill — and a foot-gun — for a single-region app that a single leader with
> read replicas would serve fine.

---

## Professional / Deep-Dive Questions

**Q19: Do a concrete RPO/RTO calculation for a payments database and justify the replication design.**

> **Requirements**: payments DB, regulatory tolerance for data loss is
> effectively zero (RPO ≈ 0), and the business wants RTO ≤ 60 s. Cross-region
> DR is mandatory.
>
> **RPO analysis.** RPO ≈ 0 forces *synchronous* durability before ack. With pure
> async replication, RPO equals replication lag at failure; if lag averages
> 300 ms and spikes to 5 s, we could lose up to 5 s of payments — unacceptable.
> So:
> - In-region: **semi-synchronous** — at least one synchronous follower so every
>   acked write exists on two nodes before the client is told "committed." RPO
>   for a single-node failure ≈ 0.
> - Cross-region DR replica: synchronous cross-region replication would add the
>   inter-region RTT (say 60–80 ms) to *every* write, which may be acceptable for
>   payments (writes aren't the high-QPS path) but is the explicit price. If the
>   business won't pay that latency, we accept a small cross-region RPO (the
>   inter-region lag) and document it as the disaster-only loss window.
>
> **RTO analysis.** RTO ≤ 60 s requires *automated* failover, because a human
> paged at 3 a.m. can't reliably meet 60 s. Budget:
> - Failure detection: heartbeat timeout ~5–10 s (short enough to be fast, long
>   enough to avoid flapping under transient load).
> - Leader election / promotion: ~5–15 s (promote the most-caught-up sync
>   follower; we know it's caught up because it's the sync replica → no waiting
>   to apply backlog → preserves RPO ≈ 0).
> - Traffic redirect (DNS/proxy/connection re-pin): ~10–20 s.
> - Total ≈ 20–45 s, inside the 60 s budget with headroom.
>
> **Resulting design**: single-leader per region, one synchronous follower
> (RPO ≈ 0), automated quorum-based failover with fencing tokens (so a deposed
> leader can't double-write), plus a cross-region replica for DR with an
> explicitly documented cross-region loss window if we choose async for write
> latency reasons. The key justification chain: *RPO ≈ 0 → sync durability;
> RTO ≤ 60 s → automated failover promoting the already-synced follower; payments
> correctness → fencing to prevent split-brain double-spend.*

**Q20: Linearizability requires coordination. Concretely, why does that hurt availability and latency, and how does this connect to CAP/PACELC?**

> Linearizability requires that there be a single, agreed, up-to-date copy of
> each object and that every operation observes the latest completed one. To
> guarantee that across replicas you need *coordination* — a leader plus
> consensus, or synchronous quorum reads and writes — on the critical path of
> each operation.
>
> **Why it hurts availability (the CAP angle).** During a network partition, the
> minority side cannot reach a quorum/leader. To stay linearizable it must
> *refuse* operations (sacrifice availability), because serving them risks
> returning stale data or creating a second history. So under partition you pick
> C or A but not both — that's CAP. A CP system (e.g., a Raft cluster) rejects
> writes on the minority side; an AP system (e.g., Dynamo-style with W=R=1)
> serves them and reconciles later.
>
> **Why it hurts latency even with no partition (the PACELC angle).** PACELC
> extends CAP: *if Partitioned, choose A or C; Else (normal operation), choose L
> (latency) or C (consistency)*. Even when the network is healthy, a linearizable
> operation must wait for coordination — a leader round-trip, or a synchronous
> quorum, possibly cross-region. That's added latency on *every* request, not
> just during failures. So a system can be "PC/EC" (Spanner-like: consistent
> always, paying latency) or "PA/EL" (Dynamo-like: available and low-latency,
> giving up consistency). PACELC is the more useful framing for design reviews
> because partitions are rare but the everyday latency cost is paid constantly.

**Q21: How do hybrid logical clocks (HLC) improve on wall clocks and Lamport clocks for ordering?**

> The problem: to order events across machines for conflict resolution and causal
> consistency, we need timestamps that are (a) close to real time (so they're
> meaningful and comparable to external events) and (b) respect causality (if A
> happens-before B, A's timestamp < B's). Neither pure clock gives both.
>
> - **Wall clock (NTP time)**: meaningful and comparable to real events, but
>   *violates causality* under skew — a later event on a slow-clocked node can get
>   a smaller timestamp, which is exactly what makes LWW lose data.
> - **Lamport clock**: a single logical counter that *guarantees* causality (if A
>   → B then L(A) < L(B)), but it has *no relation to real time* — you can't tell
>   how far apart two events are, and you can't compare to external timestamps.
>
> **Hybrid Logical Clock** combines them: each timestamp is a pair of (physical
> time component, logical counter). The physical part tracks NTP within a small
> bound; the logical part increments to break ties and absorb skew so causality
> is never violated. The result is a timestamp that is *monotonic, causally
> consistent, and within a bounded distance of real wall-clock time* — so it both
> respects happens-before (good for correctness) and stays human-meaningful (good
> for debugging and TTLs). CockroachDB uses HLCs for exactly this; they let a
> system get most of the ordering benefits of something like TrueTime without
> specialized hardware.

**Q22: A read replica is lagging badly. Walk through how you'd diagnose and what consistency-level levers you have.**

> **Diagnose — find where the lag comes from:**
> 1. Measure the actual lag (e.g., position/time delta between leader's log and
>    follower's applied position). Confirm it's apply lag, not just network
>    transfer lag.
> 2. Single-threaded apply: many replicas apply the WAL/binlog on a single
>    thread, so a write-heavy leader can outpace a follower. Check whether
>    parallel apply is enabled and the apply thread is CPU-bound.
> 3. Long-running read queries on the follower blocking apply (lock/version
>    conflicts), or a slow disk on the follower.
> 4. A burst of large writes (bulk import, schema change) saturating
>    replication.
>
> **Consistency-level levers to protect users while lag persists:**
> - **Route critical reads to the leader** for affected users/queries — preserves
>   read-your-writes at the cost of leader load.
> - **Pin sessions to a replica** (sticky routing) to preserve monotonic reads so
>   users don't time-travel even if the chosen replica is behind.
> - **Bounded-staleness gate**: only serve a read from a replica if its lag is
>   under a threshold; otherwise fall back to the leader. Turns "silently stale"
>   into "explicitly fresh-enough."
> - **Track the write position** (the user's last write LSN/timestamp) and only
>   read from a replica caught up past it — read-your-writes without always
>   hitting the leader.
> - **Shed/queue** heavy follower queries that block apply; add parallel apply or
>   a dedicated reporting replica so analytics don't starve the serving replica.
>
> The framing for the interviewer: replication lag is not just an ops problem,
> it's a *consistency-model* problem, and the levers above let you trade leader
> load against freshness per query rather than globally.

**Q23: How do sloppy quorums and hinted handoff change the W + R > N guarantee?**

> A **strict quorum** requires W and R responses from the *designated* N replicas
> for a key (its "preference list"). If too many of those are down, the operation
> fails — favoring consistency over availability.
>
> A **sloppy quorum** relaxes this: if some of the designated replicas are
> unreachable, the write is accepted by *other, healthy* nodes outside the
> preference list, with a **hint** noting which intended node it's standing in
> for. When the intended node recovers, **hinted handoff** delivers the buffered
> write to it. This keeps writes available during failures — you can still get W
> acks even if W of the *home* replicas are down.
>
> The cost: the W + R > N overlap guarantee *no longer holds during the failure*,
> because the W writes may have landed on temporary nodes that a strict R read of
> the home replicas won't contact. So during a partition you can read stale data
> even though writes "succeeded" — sloppy quorum buys availability by weakening
> the consistency guarantee precisely when failures occur. It's a deliberate slide
> toward the A end of the spectrum, appropriate when accepting the write matters
> more than reading the very latest value, and it relies on read-repair and
> anti-entropy to converge afterward.

---

## Staff / Judgment Questions

**Q24: A PM says "make the whole system strongly consistent so we never have bugs." How do you respond?**

> I'd reframe it from a slogan into a per-feature cost decision, because "strongly
> consistent everywhere" is almost always the wrong global default — it pays
> coordination latency and sacrifices availability on data that doesn't need it.
>
> My response, structured:
> 1. **Agree on the goal, not the mechanism.** The real goal is "no
>    user-visible correctness bugs and no surprising staleness." Strong
>    consistency is *one* tool for that, and an expensive one.
> 2. **Classify the data by staleness budget.** Money movement and uniqueness
>    constraints → strong. Counts, feeds, recommendations, presence → eventual
>    with session guarantees is not just acceptable, it's *better* (more
>    available, lower latency, cheaper). Most of the surface area is the latter.
> 3. **Name the cost of "everywhere."** Global strong consistency means
>    cross-region coordination on the hot path, which raises p99 latency, lowers
>    availability during partitions (the system would reject writes rather than
>    serve them), and increases infra cost. The PM is implicitly trading away
>    availability and speed; they should make that trade *knowingly*, per feature.
> 4. **Offer the cheaper guarantees that kill the *actual* bugs they're worried
>    about.** Read-your-writes and monotonic reads eliminate the "my comment
>    disappeared" class of bug — which is what users actually complain about —
>    without global strong consistency.
>
> The staff-level point: my job is to surface the trade-off and attach numbers to
> it (latency, availability, cost), then let the business choose per feature —
> not to either rubber-stamp "strong everywhere" or unilaterally decide.

**Q25: Define a "staleness budget" and show how you'd turn it into an engineering decision and an SLO.**

> A **staleness budget** is the maximum amount of out-of-date-ness a feature can
> tolerate before it harms the user or the business — expressed as a concrete
> number, not a vibe. It's the bridge from product requirements to a consistency
> design.
>
> **Process:**
> 1. **Ask the product question, get a number.** "If this data is N seconds old,
>    who notices and what does it cost?" Examples:
>    - Account balance: budget ≈ 0 → must be strong.
>    - Follower count: budget ≈ minutes → eventual is fine.
>    - Fraud-rules config: budget ≈ seconds → bounded staleness with a tight
>      bound.
> 2. **Map the number to a model:**
>
>    | Staleness budget | Implied model | Implied mechanism |
>    |------------------|---------------|-------------------|
>    | 0 | strong / linearizable | single leader or consensus on read+write path |
>    | sub-second–seconds | bounded staleness | read from replicas only if lag < bound, else leader |
>    | minutes+ | eventual + session guarantees | read replicas, sticky routing, read-your-writes |
>
> 3. **Turn it into an SLO you can monitor.** A staleness budget becomes a
>    measurable target: e.g., "99.9% of reads on feature X are at most 2 s stale,"
>    monitored as replication lag against the 2 s bound, with an alert when the
>    bound is breached. Now "consistency" is an SLO with an error budget, not a
>    binary religious argument.
>
> The value of this framing in a design review: it replaces "should this be
> strong or eventual?" (unanswerable in the abstract) with "what's the staleness
> budget?" (answerable by the PM), and the budget *deterministically* selects the
> replication and routing design. It also makes the trade-off auditable — if
> someone later wants stronger consistency, the conversation is "you want to lower
> the budget from 2 s to 0; here's the latency and availability cost," which is a
> concrete trade rather than a debate.

**Q26: When would you deliberately accept *weaker-than-eventual* (best-effort) consistency, and how do you contain the risk?**

> I'd accept best-effort, no-convergence-guarantee consistency only for data
> where divergence is *self-correcting or disposable* and the alternative cost is
> real. Cases:
>
> - **Caches and derived/recomputable data** — if a cache entry is wrong, the
>   next refresh fixes it, and the source of truth is elsewhere. The "budget" is
>   bounded by the cache TTL.
> - **Telemetry, metrics, sampled analytics** — dropping or duplicating a small
>   fraction is acceptable because decisions are made on aggregates, not
>   individual events. Forcing strong consistency here would crush throughput.
> - **Ephemeral presence / typing indicators** — wrong for a second, then gone;
>   no lasting harm.
>
> **Containment so "best-effort" doesn't become "silently broken":**
> - **Authoritative source of truth** elsewhere that can recompute/repair the
>   weak copy (the weak data is never the system of record).
> - **TTLs and periodic reconciliation / anti-entropy** so divergence has a
>   bounded lifetime even without per-write convergence guarantees.
> - **Explicit blast-radius limits**: the weak data must not feed a strong-path
>   decision (don't authorize a payment off a best-effort cache of the balance).
> - **Observability**: measure divergence (cache hit-correctness, drop rates) so
>   "best-effort" stays within a known band and a regression is visible.
>
> The judgment: weaker-than-eventual is a legitimate, even necessary, choice for
> the right data — but only with a recompute path, a bounded divergence window,
> and a hard wall preventing it from contaminating strong-consistency decisions.
> Used that way, it's how you keep the expensive consistency machinery reserved
> for the small slice of data that truly needs it.

---

*Next step:* [Consistency Models — Junior](../04-consistency-models/junior.md)
