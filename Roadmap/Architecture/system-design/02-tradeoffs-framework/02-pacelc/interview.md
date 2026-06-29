# PACELC — Interview Questions

A staged set of interview questions on the PACELC theorem — the refinement of CAP that
makes the *normal-operation* tradeoff between latency and consistency explicit. Questions
move from definition recall up to staff-level vendor-selection judgment. Each answer is
written to be said out loud in a real interview: precise, specific, and backed by numbers
where numbers matter.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Staff / Judgment Questions](#staff--judgment-questions)

---

## Junior Questions

**Q1: State the PACELC theorem and expand the mnemonic.**

> PACELC is read as two conditional clauses joined by an "else":
>
> - **PAC** — *if* there is a network **P**artition, the system must choose between
>   **A**vailability and **C**onsistency.
> - **ELC** — **E**lse (when the system is running normally, no partition), it must choose
>   between **L**atency and **C**onsistency.
>
> So the full reading is: "**if P**artition then **A** or **C**, **e**lse **L** or **C**."
> It was proposed by Daniel Abadi in 2010/2012 as an extension of Eric Brewer's CAP
> theorem. The headline insight: a distributed data store faces a tradeoff *all the time*,
> not only during failures. Even on a perfectly healthy network, replicating data forces a
> choice between answering fast and answering with the latest value.

**Q2: In one sentence, what does the "else" branch capture that CAP ignores?**

> The else branch captures the cost you pay during *normal* operation: to keep replicas
> strongly consistent you must coordinate across them on every write (and sometimes every
> read), and that coordination adds latency. CAP only talks about what happens during a
> partition, which is rare; PACELC adds the everyday tradeoff that you pay 99.99% of the
> time the system is up.

**Q3: What are the four PACELC "classes"? Name each.**

> Combine the two binary choices (A vs C during partition) × (L vs C otherwise) and you get
> four classes:
>
> | Class   | During partition | Normal operation | One-line character                          |
> |---------|------------------|------------------|---------------------------------------------|
> | PA/EL   | Availability     | Latency          | Always fast, never blocks; weakest consistency |
> | PA/EC   | Availability     | Consistency      | Fast when partitioned, careful otherwise    |
> | PC/EL   | Consistency      | Latency          | Strict when partitioned, fast otherwise (rare/odd) |
> | PC/EC   | Consistency      | Consistency      | Always consistent, pays latency everywhere  |

**Q4: Give one example system for each PACELC class.**

> | Class   | Example system           | Why it fits                                            |
> |---------|--------------------------|--------------------------------------------------------|
> | PA/EL   | Cassandra, DynamoDB, Riak | Stay available under partition; default to low-latency eventual reads/writes |
> | PA/EC   | MongoDB (default config)  | Available under partition (failover), but normal reads/writes favor consistency |
> | PC/EL   | PNUTS (Yahoo!)            | Chooses consistency under partition, but low-latency timeline consistency normally |
> | PC/EC   | Google Spanner, VoltDB, HBase | Refuse to serve stale/inconsistent data; pay coordination latency always |

**Q5: Is PACELC about hardware failures or about a permanent design choice?**

> Both, but framed as one tradeoff space. The PAC half is about how the system behaves
> during a *transient* event (a partition). The ELC half is a *permanent* design property
> that's visible every single request when the network is fine. PACELC's value is that it
> forces you to name *both* — many systems are described only by their partition behavior,
> which hides the latency cost you actually live with day to day.

**Q6: Why is "consistency" expensive in terms of latency?**

> Because consistency means a read sees the most recent write, and to guarantee that across
> replicas the system must coordinate. Coordination is a round trip: a write may need to be
> acknowledged by a majority (quorum) of replicas before it's considered committed, and a
> strongly-consistent read may need to confirm it isn't reading a stale replica. Every round
> trip is bounded below by the network round-trip time (RTT) between replicas. If your
> replicas are in different data centers, that RTT can be tens of milliseconds — pure
> physics, the speed of light in fiber, that no amount of CPU can remove.

---

## Middle Questions

**Q7: Explain precisely what PACELC *adds* over CAP, and why that addition matters in practice.**

> CAP says: when a partition happens, pick A or C. The trap is that CAP only describes the
> failure case. Real systems spend the overwhelming majority of their lifetime *not*
> partitioned, so CAP says almost nothing about how the system behaves the 99.99% of the
> time it's healthy. PACELC closes that gap with the ELC clause: even with no partition,
> replication still forces a Latency-vs-Consistency choice, because keeping replicas in sync
> requires synchronous coordination that costs latency.
>
> Why it matters: two databases can both be "CP" under CAP and behave completely differently
> in production. One might do synchronous cross-region replication on every write (PC/EC,
> high tail latency); another might serve reads from a local replica with eventual
> consistency when not partitioned (PC/EL, low latency). CAP labels them identically; PACELC
> distinguishes them. The dimension PACELC adds — latency paid in normal operation — is
> precisely the dimension your users feel.

**Q8: Walk through the four classes with the example system and the user-visible behavior.**

> - **PA/EL — Cassandra (default):** Under a partition it keeps accepting reads and writes on
>   both sides (availability). Normally, with consistency level ONE, a write returns after a
>   single replica acks and a read hits one replica — sub-millisecond local latency, but you
>   may read stale data. Fast and available; eventually consistent.
> - **PA/EC — MongoDB (default, with majority concerns):** A replica set elects a primary; if
>   the primary is partitioned away the cluster fails over so writes stay available. But in
>   normal operation reads with `readConcern: majority` / writes with `w: majority` favor
>   consistency over the lowest possible latency.
> - **PC/EL — PNUTS:** Under partition it refuses to violate its per-record timeline
>   consistency (PC). Normally it serves reads from a local region replica with low latency
>   even though they may lag the master (EL). This combination is unusual — most systems that
>   are strict under partition are also strict normally.
> - **PC/EC — Spanner:** Refuses stale or inconsistent reads in both regimes. Uses Paxos +
>   TrueTime to provide external (linearizable) consistency, and pays the coordination
>   latency on every committed write — there's no "go fast and be loose" mode.

**Q9: Classify DynamoDB under PACELC and justify it.**

> DynamoDB is **PA/EL** by default. Under a partition it favors availability — it keeps
> serving requests; it descends from the Dynamo paper's always-writable design. In normal
> operation its *default* read is **eventually consistent** (lower latency, reads from any
> replica), which is the EL choice. The nuance: DynamoDB also offers **strongly consistent
> reads** as a per-request option, which moves *that read* toward EC and roughly doubles its
> latency and cost (and strongly-consistent reads are not available from global secondary
> indexes or read replicas in other regions). So the *baseline* class is PA/EL, with a
> per-request knob to opt into stronger consistency. Global Tables (multi-region) are
> last-writer-wins and remain PA/EL.

**Q10: Classify Spanner under PACELC and justify it.**

> Spanner is **PC/EC**. Under a partition, a Paxos group that loses its quorum stops serving
> writes for the affected splits rather than diverge — consistency over availability (PC).
> In normal operation, Spanner provides external consistency (linearizability across the
> whole database) using TrueTime commit-wait and Paxos majority replication, paying that
> coordination latency on every write — consistency over latency (EC). Abadi's own point
> about Spanner is subtle: it's "effectively CA" in CAP terms because Google engineers the
> network (redundant links, controlled WAN) so partitions are extraordinarily rare — but its
> *design choice* when forced is PC, and its everyday behavior is unambiguously EC.

**Q11: Classify Cassandra and MongoDB, and contrast them.**

> | Aspect              | Cassandra                          | MongoDB                                |
> |---------------------|------------------------------------|----------------------------------------|
> | Default class       | PA/EL                              | PA/EC (default config)                 |
> | Topology            | Masterless, peer-to-peer ring      | Single primary per replica set         |
> | Under partition     | Both sides keep serving (avail.)   | Failover elects new primary (avail.)   |
> | Normal-op default   | Tunable; CL=ONE → low latency, eventual | `readConcern`/`w: majority` → favors consistency |
> | The knob            | Per-query consistency level (ONE..ALL) | Per-op read/write concern + read preference |
>
> Both are "AP-ish" under partition, but Cassandra's default *normal* behavior is latency-first
> (PA/EL) while MongoDB's default leans consistency-first in normal operation (PA/EC). The key
> caveat is that both are *tunable*, so a single deployment can be moved between classes by
> configuration — PACELC describes the default, not an immutable property.

**Q12: Why does replication force a latency-vs-consistency choice even when there is NO partition?**

> Because correctness of a strongly-consistent read requires that the write it should reflect
> has reached enough replicas before the read can observe it. Take quorum replication with
> N=3 replicas: to guarantee read-your-writes you need W + R > N, e.g. W=2, R=2. That means
> a write must wait for an *acknowledgment from a second replica* before returning, and a read
> must contact two replicas and reconcile. Each of those is a network round trip. If you
> instead set W=1, R=1, the write returns as soon as one node has it and the read trusts the
> first responder — much faster, but now a read can land on a replica that hasn't received
> the write yet. No partition is involved; this is just the unavoidable cost of making
> multiple copies agree. The network being healthy doesn't make the round trips free.

---

## Senior Questions

**Q13: The PC/EL class (PNUTS) is described as "odd." What exactly is it, and why is it rare?**

> PC/EL means: *consistent* under partition, but *latency-first* in normal operation. That
> sounds contradictory because the usual intuition is "if you're willing to be strict during
> a failure, you're strict all the time." PNUTS — Yahoo!'s geo-replicated store — achieves it
> with a specific model called **per-record timeline consistency** and a **per-record master**:
>
> - Each record has a single master replica that serializes all its writes, giving a total
>   order per record — that ordering is preserved even across regions, so under partition it
>   doesn't allow divergent histories (the PC side).
> - But normal *reads* are served from a *local* region replica that may lag the master. A
>   read returns some consistent prior version quickly (low latency) rather than blocking to
>   confirm it has the absolute latest — that's the EL side.
>
> It's rare because most designers who care enough to be strict during partitions also want
> strict reads normally (collapsing to PC/EC), and most designers who want low-latency local
> reads also accept availability during partitions (collapsing to PA/EL). PNUTS threads the
> needle: serialize writes through a per-record master (consistency) while letting reads be
> stale-but-fast (latency). The price is that *writes* to a record whose master is in a remote
> region pay cross-region latency, and read-your-own-writes isn't guaranteed without extra
> mechanisms.

**Q14: Show with arithmetic how a latency SLO can rule out strong global consistency.**

> Strong (linearizable) writes across regions require a majority quorum commit, so each write
> incurs at least one cross-region round trip to the *farthest replica needed to form the
> majority*. Put numbers on a 3-region deployment:
>
> | Region pair                  | One-way light-in-fiber latency | RTT (≈ 2× + switching) |
> |------------------------------|--------------------------------|------------------------|
> | us-east ↔ us-west            | ~30 ms                         | ~65 ms                 |
> | us-east ↔ eu-west            | ~40 ms                         | ~85 ms                 |
> | us-east ↔ ap-southeast       | ~110 ms                        | ~230 ms                |
>
> Say the leader is in us-east and replicas sit in us-west and eu-west. A majority (2 of 3)
> needs the leader plus the *nearest* follower, but the commit must wait for the round trip to
> whichever follower completes the quorum — at best ~65 ms RTT. Add Paxos/Raft processing,
> fsync, and (for Spanner) TrueTime commit-wait (often a few ms), and a strongly-consistent
> cross-region write floor is roughly **70–90 ms**.
>
> Now suppose the product requires a **p99 write latency SLO of 20 ms**. The physics alone —
> ~65 ms minimum round trip — exceeds that by 3×. No amount of engineering removes the speed
> of light, so **a 20 ms global write SLO is incompatible with synchronous global strong
> consistency.** The only ways to honor the SLO are (a) drop to EL — commit locally, replicate
> async (PA/EL or PC/EL with local-master), or (b) pin all replicas to one region so writes
> never cross the WAN, which sacrifices geo-redundancy. PACELC names this directly: the SLO
> forced you onto the L side of ELC.

**Q15: Walk through the request paths of an EC vs EL configuration. (Use a diagram.)**

> The difference is *where the write is allowed to return*. In EC, the write blocks until a
> majority of replicas acknowledge; in EL, it returns after the local replica accepts and
> replication happens in the background.
>
> ```mermaid
> sequenceDiagram
>     participant Client
>     participant Leader as Leader (us-east)
>     participant R1 as Replica (us-west)
>     participant R2 as Replica (eu-west)
>
>     Note over Client,R2: EC path — strong consistency, pays quorum RTT
>     Client->>Leader: write(x=1)
>     Leader->>R1: replicate(x=1)
>     Leader->>R2: replicate(x=1)
>     R1-->>Leader: ack
>     Note over Leader: majority reached (2/3) after farthest needed RTT
>     Leader-->>Client: committed (≈70-90 ms)
>     R2-->>Leader: ack (later)
>
>     Note over Client,R2: EL path — low latency, replicate in background
>     Client->>Leader: write(x=2)
>     Leader-->>Client: committed (≈1-5 ms, local)
>     Leader->>R1: replicate(x=2) async
>     Leader->>R2: replicate(x=2) async
> ```
>
> In the EC path the client waits for the second ack — bounded by cross-region RTT. In the EL
> path the client is released as soon as the leader durably stores the write locally;
> replicas catch up afterward, so a read elsewhere can momentarily see the old value. Same
> hardware, same healthy network — the only difference is whether the system pays the quorum
> round trip *synchronously*.

**Q16: What are tunable consistency levels? Give concrete Cassandra and DynamoDB examples.**

> Tunable consistency means the *same* store lets each operation choose where it sits on the
> latency-vs-consistency line, so a single deployment spans multiple PACELC behaviors.
>
> **Cassandra** exposes per-query consistency levels (CL). With replication factor N=3:
>
> | Write CL | Read CL  | Guarantee                                   | PACELC flavor of that op |
> |----------|----------|---------------------------------------------|--------------------------|
> | ONE      | ONE      | Fast, eventually consistent (W+R ≤ N)       | EL                       |
> | QUORUM   | QUORUM   | Strong if W+R > N (2+2 > 3) → read-your-writes | EC                    |
> | ALL      | ONE      | Strongest write durability, slowest writes  | EC-leaning              |
> | LOCAL_QUORUM | LOCAL_QUORUM | Quorum within local DC only — strong locally, async cross-DC | EL globally / EC locally |
>
> **DynamoDB** is simpler: reads are **eventually consistent** by default (EL) or
> **strongly consistent** per request (EC). A strongly-consistent read costs ~2× the read
> capacity units and has higher latency, and isn't offered on global secondary indexes. Writes
> are always quorum-durable within a region; cross-region (Global Tables) is async
> last-writer-wins (EL). So both systems let you pick PA/EL or "PA/EC-for-this-operation" at
> request granularity.

**Q17: How do session guarantees act as a "middle ground" between EL and EC?**

> Strong consistency (EC) and pure eventual consistency (EL) are the endpoints. Session
> (or "client-centric") guarantees sit between them by being strong *with respect to one
> client's own session* while still letting different clients see slightly different global
> states. The classic set:
>
> - **Read-your-writes:** a client always sees its own prior writes.
> - **Monotonic reads:** a client never sees time go backwards (no reading an older value
>   after a newer one).
> - **Monotonic writes:** a client's writes are applied in the order issued.
> - **Writes-follow-reads (causal):** a write is ordered after any write the client read.
>
> These are cheap to implement (typically with per-client version vectors / "min read
> timestamp" pins) and don't require global coordination on every operation — so they keep
> most of EL's latency while removing the most jarring anomalies. In PACELC terms, they let
> you stay essentially EL globally while giving each user an experience that *feels* consistent.
> DynamoDB's session tokens, Cosmos DB's "Session" consistency level, and MongoDB's causally
> consistent sessions are productized versions of exactly this.

**Q18: Abadi argued Spanner is "effectively CA, designed PC/EC." Reconcile that with CAP saying CA is impossible.**

> CAP's theorem rules out a system that is *simultaneously* C and A *while tolerating
> partitions* — you can't promise both during a partition. Spanner does not violate that: when
> a partition forces the choice, Spanner chooses **C** (it stops serving the affected splits),
> so it is genuinely **P→C**, i.e. CP, not CA. Abadi's "effectively CA" remark is an
> *operational* observation, not a theoretical claim: Google runs Spanner over a privately
> engineered network with redundant paths where partitions are so rare that, in practice,
> users almost never experience the A-loss. So:
>
> - **Theoretically**, Spanner is CP (PC under PACELC's first clause).
> - **Operationally**, partitions are rare enough that it *feels* CA.
> - **The dimension that actually shapes your app** is the ELC half: Spanner is EC, so every
>   write pays coordination + commit-wait latency. That's why PACELC is the more useful lens —
>   the everyday tax (EC latency) dominates the experience far more than the once-in-a-blue-moon
>   partition behavior.

---

## Professional / Deep-Dive Questions

**Q19: Build a decision tree for placing a *new* service into a PACELC class. What questions drive it?**

> The placement is driven by two independent questions, asked in order:
>
> ```mermaid
> flowchart TD
>     A[New data service] --> B{During a partition,<br/>can we serve stale/divergent data?}
>     B -- "Yes, stay up" --> PA[PA: available under partition]
>     B -- "No, correctness first" --> PC[PC: consistent under partition]
>     PA --> C{In NORMAL operation,<br/>can a read be slightly stale?}
>     PC --> D{In NORMAL operation,<br/>can a read be slightly stale?}
>     C -- "Yes, want low latency" --> PAEL[PA/EL<br/>Cassandra, DynamoDB]
>     C -- "No, want fresh reads" --> PAEC[PA/EC<br/>MongoDB default]
>     D -- "Yes, want low latency" --> PCEL[PC/EL<br/>PNUTS, local-master designs]
>     D -- "No, want fresh reads" --> PCEC[PC/EC<br/>Spanner, VoltDB, HBase]
> ```
>
> The discriminating inputs are concrete product facts, not preferences:
>
> 1. **Cost of a stale read to the business.** A "like" counter tolerates staleness → PA/EL.
>    An account balance for a transfer does not → PC/EC.
> 2. **Latency SLO vs replica geography.** If the p99 SLO is below the inter-replica RTT,
>    EC is physically impossible and you're forced to EL (see Q14).
> 3. **Availability target during failures.** A checkout cart must never reject a write
>    (PA); a ledger may correctly refuse (PC).
>
> Note the two questions are genuinely orthogonal, which is *why* four classes exist and why
> describing a system with CAP alone (one question) loses information.

**Q20: A team says "we're CP so consistency is handled." What's the senior pushback using PACELC?**

> "CP" only answers the partition question. It says nothing about the *normal-operation*
> behavior, which is where almost all your latency budget is actually spent. The pushback is a
> sequence of concrete questions:
>
> - "CP tells me what you do during a partition. What's your **ELC** behavior — EC or EL?"
> - "If EC: what's the cross-region quorum RTT, and does your p99 write SLO survive paying it
>   on *every* write? Show me the math (Q14)."
> - "If EL: then your 'CP' label is hiding the fact that *normal* reads can be stale. So
>   consistency is **not** 'handled' — it's only guaranteed under partition, which is the rare
>   case. Read-your-writes for a user editing their own profile may still break."
> - "Which is it per operation? Many CP systems are tunable, so 'CP' is a default, not a
>   property of every query."
>
> The point: "CP" is a one-bit summary of a two-bit space. PACELC forces the team to also
> declare EC vs EL, which is the part the user feels. A precise answer is "PC/EC with QUORUM
> reads, p99 write 80 ms cross-region" — *that's* a handled-consistency statement.

**Q21: Compare the four classes across the dimensions that matter for system selection.**

> | Dimension                    | PA/EL              | PA/EC                 | PC/EL                 | PC/EC                 |
> |------------------------------|--------------------|-----------------------|-----------------------|-----------------------|
> | Read freshness (normal)      | Eventual           | Strong                | Eventual (local)      | Strong (linearizable) |
> | Write latency (cross-region) | Lowest (local ack) | Higher (sync read/consistency) | Low (local master) | Highest (quorum + commit-wait) |
> | Availability under partition | Highest            | High (failover)       | Lower (may block)     | Lower (may block)     |
> | Read-your-writes by default  | No                 | Yes                   | Needs session pin     | Yes                   |
> | Typical workload fit         | High-write, tolerant of staleness | Read-heavy, freshness matters | Geo reads + ordered writes | Money, inventory, identity |
> | Example                      | Cassandra, DynamoDB | MongoDB (default)     | PNUTS                 | Spanner, VoltDB       |
> | Operational complexity       | Low–medium         | Medium                | High                  | High (clock/coordination) |
>
> The selection heuristic: start from the *least forgiving* invariant in your data. If any
> invariant requires linearizability (no double-spend, unique usernames), you're pulled toward
> PC/EC for that data even if it costs latency. If no invariant is that strict and latency is
> the product differentiator, PA/EL wins. Mixed systems often split data: ledger in PC/EC,
> feed/counters in PA/EL.

**Q22: How would you actually *measure* whether a deployed system is EC or EL — empirically?**

> Don't trust the label; measure the anomaly rate and the latency signature:
>
> 1. **Consistency probe (staleness test):** A writer writes a monotonically increasing value
>    with a timestamp to key K; many geographically distributed readers poll K and record the
>    gap between the write's commit time and when each reader first observes it. If readers
>    *ever* see a value older than one they previously saw, or lag the write, the system is
>    behaving EL. Zero observed staleness across the fleet under load is the EC signature.
>    (This is essentially what tools like Jepsen and YCSB+T probe.)
> 2. **Latency signature:** Plot write p50/p99. If write latency tracks the inter-replica RTT
>    (e.g., p50 ≈ 70 ms matching cross-region quorum), the write path is synchronous → EC. If
>    write p50 is ~1–3 ms regardless of replica geography, the ack is local → EL.
> 3. **Partition the network in a test env** (e.g., with `tc`/iptables or a chaos tool) and
>    observe: does the minority side keep accepting writes (PA) or start erroring (PC)?
>
> The combination of the staleness probe and the latency-vs-RTT correlation pins down ELC; the
> partition injection pins down PAC. This matters because configuration drift (someone changed
> a default read concern) can silently move a service between classes.

**Q23: Where does PACELC's two-bit model break down or oversimplify?**

> PACELC is a great *first-order* map, but reality is finer:
>
> - **Consistency is a spectrum, not a bit.** Between "strong" and "eventual" lie causal,
>   bounded-staleness, monotonic, prefix, and session consistency (e.g., Azure Cosmos DB
>   exposes five explicit levels). PACELC's single C/L axis flattens that ladder.
> - **Per-operation, not per-system.** Tunable stores (Cassandra, DynamoDB, Cosmos) sit in
>   *different* classes for different queries, so a single label is only the default.
> - **Latency isn't binary either.** EC's latency depends on quorum size, replica placement,
>   and whether reads are leader-pinned vs quorum reads — there are many "EC speeds."
> - **It ignores durability and throughput** as separate axes; a PA/EL system can still lose
>   data if it acks before any durable write, which PACELC doesn't capture.
> - **Partition itself is fuzzy** — gray failures, partial partitions, and asymmetric links
>   don't fit the clean "partition / no partition" dichotomy.
>
> The senior framing: use PACELC to *start* the conversation and force the latency tradeoff
> into the open, then refine with the actual consistency level, the per-operation knobs, and
> measured numbers.

---

## Staff / Judgment Questions

**Q24: You're selecting a datastore for a global fintech ledger plus a social activity feed. Use PACELC end-to-end, including the cost dimension.**

> I'd split the system by invariant rather than pick one database for everything, because the
> two workloads sit at opposite ends of PACELC.
>
> **Ledger (money movement, balances):** The hard invariant is no double-spend and a single
> total order of transactions — that's linearizability. So this is **PC/EC**: during a
> partition I'd rather *refuse* a debit than allow a divergent balance (PC), and in normal
> operation I will not serve a stale balance (EC). Candidate: Spanner or CockroachDB. I accept
> the cost: cross-region commit ~70–90 ms p99 (Q14), so I design the UX around it (optimistic
> "processing…" states, async confirmations) and place replicas to minimize the quorum RTT for
> the dominant traffic region.
>
> **Activity feed (likes, follows, timelines):** The invariant is weak — a like count being
> stale for a few seconds is invisible to users; what users *do* notice is a slow feed. So this
> is **PA/EL**: stay available under partition, serve low-latency eventually-consistent reads.
> Candidate: Cassandra or DynamoDB with eventually-consistent reads. I add **session
> guarantees** (read-your-writes) so a user always sees *their own* like immediately, which is
> the one staleness anomaly that *would* be noticed — cheap to provide without going full EC.
>
> ```mermaid
> flowchart LR
>     U[User request] --> R{Which data?}
>     R -- "balance / transfer" --> L[Ledger<br/>PC/EC — Spanner/CockroachDB<br/>p99 ~80ms, strong]
>     R -- "feed / counters" --> F[Feed<br/>PA/EL — Cassandra/DynamoDB<br/>p99 ~3ms, eventual + read-your-writes]
> ```
>
> **The cost dimension** is the deciding factor that PACELC makes legible. EC is expensive on
> three axes:
>
> | Cost axis        | PC/EC ledger                          | PA/EL feed                             |
> |------------------|---------------------------------------|----------------------------------------|
> | Latency          | High (quorum + commit-wait every write) | Low (local ack)                       |
> | $ infra          | Higher (coordination, often premium managed e.g. Spanner) | Lower (commodity, eventual reads cheaper) |
> | Engineering      | Higher (clock sync, schema constraints, careful UX for slow writes) | Lower (write-anywhere, simple) |
>
> Spending PC/EC's cost on the feed would burn money and latency for a guarantee nobody needs;
> spending PA/EL's looseness on the ledger would risk real financial bugs. PACELC's job here is
> to make me put the *right* data in the *right* class and to surface the cost I'm paying for
> consistency where I genuinely need it.

**Q25: A vendor's marketing says "strong consistency with single-digit-millisecond global latency." How does PACELC let you call the bluff?**

> PACELC plus physics says that claim is impossible *for global, multi-region linearizable
> writes*. Strong consistency on a global write requires a majority quorum that includes
> replicas in other regions, and the inter-region RTT alone is tens of milliseconds (Q14). You
> cannot have a 5 ms *globally linearizable* write across continents — the speed of light
> forbids it. So one of three things must be true, and I'd ask which:
>
> 1. **The "global" is regional.** The single-digit latency is within one region; cross-region
>    is async (so it's actually PA/EL or bounded-staleness globally). Likely.
> 2. **The "strong" is weaker than linearizable.** They mean session or bounded-staleness
>    consistency (e.g., Cosmos DB's tiers), which *can* be fast locally. Then it's not the
>    strong consistency a fintech invariant needs.
> 3. **Reads are fast, writes are not.** Leader-local reads can be single-digit ms while
>    writes still pay quorum RTT. Marketing quotes the read number.
>
> The PACELC discipline forces the precise question: "Is that single-digit latency for a
> *linearizable cross-region write*, or for a *local/bounded-staleness read*?" The honest
> answer is always the latter for a geo-distributed system. PACELC is the framework that lets
> you decompose the marketing claim into the (PAC, ELC) it's quietly conflating.

**Q26: Under what conditions would you deliberately choose PA/EC over the more common PA/EL or PC/EC, and what's the risk?**

> PA/EC is the right pick when you need **fresh reads in normal operation** but you are
> **willing to keep serving (possibly with reduced guarantees) through a partition** rather than
> halt. Concretely: a content/catalog or social system where (a) showing stale data normally is
> a real UX bug — users edit and immediately re-read their content, expecting freshness — but
> (b) a partition (rare) must not take the whole product down, so failover to keep writing is
> acceptable, with reconciliation afterward. MongoDB's default replica-set behavior lands here:
> majority read/write concerns give you fresh reads normally; an election keeps you available
> when a primary is isolated.
>
> **The risk** is the seam between the two regimes. Because you chose A under partition, during
> the partition you *relax* the EC guarantee you advertise normally — so the system's actual
> consistency is bimodal: strong when healthy, weaker (and potentially conflicting) when
> partitioned. If application code assumes the normal-operation EC guarantee always holds, it
> can misbehave exactly during the failure when correctness matters most (e.g., a split-brain
> window before failover converges, or rolled-back writes after a primary rejoins). Mitigation:
> use majority write concern so acknowledged writes survive failover, design idempotent
> operations, and make the application explicitly tolerant of the partition-time relaxation
> rather than assuming uniform behavior. The judgment call is whether your data can survive that
> bimodality — if it can't, you actually needed PC/EC.

---

*Next step:* [Consistency vs Availability](../03-consistency-vs-availability/junior.md)
