# CAP Theorem — Interview Questions

A staged set of interview questions and model answers on the CAP theorem, ordered
from first-job fundamentals to staff-level system judgment. Each question is phrased
the way a real interviewer would ask it, followed by a model answer written the way
a strong candidate would actually speak — concrete, system-specific, and honest about
the limits of the theory.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Staff / Judgment Questions](#staff--judgment-questions)

---

## Junior Questions

These check whether you can state CAP precisely and avoid the common slogans.

**Q1: State the CAP theorem and define each of the three letters.**

> The CAP theorem says that a distributed data store cannot simultaneously
> guarantee all three of Consistency, Availability, and Partition tolerance; when a
> network partition occurs, you must sacrifice either consistency or availability.
>
> - **Consistency (C):** every read returns the most recent completed write, or an
>   error. Formally this is *linearizability* — the system behaves as if there is a
>   single, up-to-date copy of the data and every operation takes effect atomically
>   at some instant between its start and its return.
> - **Availability (A):** every request received by a non-failing node returns a
>   non-error response, in a bounded amount of time. It does not promise the *latest*
>   data — only that you get *an* answer.
> - **Partition tolerance (P):** the system continues to operate even when the
>   network drops or delays an arbitrary number of messages between nodes.
>
> The precise version is due to Gilbert and Lynch (2002), who proved Eric Brewer's
> 2000 conjecture. The careful phrasing matters: it is *during a partition* that the
> tension becomes a hard choice.

**Q2: People say CAP means "pick two of three." Why is that framing misleading?**

> Because "pick two" implies all three pairings are equally available menu options,
> and they are not. In any system that runs across a network, partitions are not a
> design choice — packets get dropped, NICs fail, switches reboot, links saturate.
> So **P is not optional**; it is a fact of the physical world.
>
> That collapses the "three choices" into a single binary that only matters *when a
> partition is happening*: do you keep answering requests with possibly-stale data
> (give up C, stay A → **AP**), or do you refuse to answer to avoid serving stale or
> divergent data (give up A, stay C → **CP**)? When the network is healthy, a
> well-built system can be both consistent and available — CAP says nothing about the
> no-partition case. The slogan also hides that C and A are not on/off switches but
> spectrums you can tune per operation.

**Q3: What does "partition" actually mean here? Is it the same as a node crashing?**

> A partition is a *network* failure: two groups of nodes are both alive but can't
> talk to each other, or messages between them are delayed beyond any timeout. The
> classic picture is two data centers whose interconnect goes down — each side is
> healthy and serving traffic, but neither can see the other.
>
> A single node crashing is different — that's a node failure, and the remaining
> nodes can usually agree that it's gone and route around it. The hard case is a
> partition because **neither side can distinguish "the other side is dead" from "the
> other side is alive but unreachable, and possibly still serving writes."** That
> ambiguity is the entire source of the CAP dilemma. In practice CAP also captures
> slow networks: if a node can't reach a quorum within the timeout, that's
> operationally a partition even if the cable is fine.

**Q4: Give a one-sentence example each of a CP system and an AP system.**

> A CP system: ZooKeeper — during a partition, the minority side stops serving so it
> never returns stale or conflicting data. An AP system: Amazon DynamoDB or Cassandra
> in its default mode — during a partition, every reachable replica keeps accepting
> reads and writes, accepting that replicas may temporarily diverge and reconcile
> later. The mental shortcut: CP "fails closed," AP "fails open."

**Q5: If a system is "highly available," does that automatically make it AP in CAP terms?**

> No — and this trips people up. "Highly available" in the marketing/SRE sense means
> "rarely down, lots of nines." CAP's A is a much stricter, formal property: *every*
> request to *every* non-failed node returns a successful response, even mid-partition.
> A CP system like etcd can have excellent operational availability (99.99%+) under
> normal conditions and still be CP, because the *one* time it gives up is precisely
> when a partition isolates a minority of nodes — then it correctly returns errors on
> that side rather than risk inconsistency. So a system can be both "highly available"
> in practice and "CP" in theory. Don't conflate the SLA number with the CAP letter.

---

## Middle Questions

These probe whether you understand what "consistency" means in CAP and how real
systems implement the choice.

**Q6: The C in CAP and the C in ACID are both "consistency." Are they the same thing?**

> No, they're unrelated and the name collision causes endless confusion.
>
> | Aspect | C in CAP | C in ACID |
> |---|---|---|
> | What it constrains | Ordering/recency of reads across replicas | Validity of data against declared rules |
> | Formal meaning | Linearizability — one logical copy, real-time order | Transaction moves DB from one valid state to another |
> | Enforced by | Replication/consensus protocol | Constraints, triggers, application invariants |
> | Scope | The distributed system as a whole | A single transaction on a single logical DB |
> | Who guarantees it | The datastore design | Largely the application + DB constraints |
>
> ACID-C is about *integrity constraints* — foreign keys, balances never going
> negative, the transaction not violating invariants you declared. CAP-C is about
> whether a read sees the latest write across replicas. You can satisfy one and
> violate the other. When an interviewer says "consistency" in a distributed-systems
> context, always clarify which one — and which *consistency model* (linearizable?
> sequential? eventual?), because "consistent" alone is ambiguous.

**Q7: What does a CP system do, concretely, when a partition happens? Walk me through it.**

> Take a 5-node etcd/ZooKeeper-style cluster using a majority-quorum consensus
> protocol (Raft / ZAB). Say the network splits it into a group of 3 and a group of 2.
>
> - The **majority side (3 nodes)** still has a quorum. It can elect/retain a leader,
>   commit new writes (a write needs 3 of 5 acks), and serve linearizable reads. It
>   stays both consistent and available *to clients that can reach it*.
> - The **minority side (2 nodes)** cannot form a quorum. It will not accept writes,
>   and a strict configuration won't serve potentially-stale reads either. Clients on
>   that side get errors or timeouts. **That is the sacrifice of availability** — done
>   deliberately so the system never returns data that contradicts the majority.
>
> When the partition heals, the minority catches up via the log and the cluster is
> whole again. The key design property: a write is never acknowledged unless a
> majority has it, so the two sides can never have committed conflicting writes.

**Q8: And what does an AP system do in the same partition scenario?**

> Take a Dynamo-style system (Cassandra, Riak, DynamoDB) with replication factor 3.
> When the network splits, **both sides keep serving**. With a low write quorum (say
> W=1 or W=2 in a sloppy-quorum setup), each side can accept reads and writes against
> whatever replicas it can reach.
>
> The cost is **divergence**: the same key might be written to different values on
> each side of the partition. The system doesn't block — it records the conflict and
> resolves it later, using mechanisms like last-write-wins timestamps, vector clocks /
> version vectors that surface siblings to the application, or CRDTs that merge
> deterministically. Cassandra also uses hinted handoff to stash writes destined for
> unreachable nodes and replay them on heal, plus read-repair and anti-entropy
> (Merkle-tree) repair to converge. So AP trades *immediate* correctness for
> *eventual* convergence and continuous availability.

**Q9: How do read and write quorums let you tune the C/A trade-off? What is R + W > N?**

> In a quorum-replicated system, N is the replication factor (copies per key), W is
> the number of replicas that must acknowledge a write, and R is the number that must
> respond to a read.
>
> The rule **R + W > N** guarantees that the read set and the write set *overlap by at
> least one replica*, so any read is guaranteed to see at least one copy of the most
> recent successful write. That gives you strong (read-your-writes / linearizable-ish)
> behavior. If R + W ≤ N, reads and writes can miss each other and you get eventual
> consistency.
>
> | Config (N=3) | Property | A vs C lean |
> |---|---|---|
> | W=3, R=1 | Strong reads, slow/fragile writes | C-leaning; writes fail if any replica down |
> | W=1, R=1 | Fast, max availability, stale reads possible | A-leaning (eventual) |
> | W=2, R=2 | R+W=4>3, strong, tolerates one node down | Balanced |
> | W=3, R=3 | Strongest reads and writes, lowest availability | Strong C |
>
> So quorums turn the binary CAP choice into a *dial*. But note: tuning R+W>N gives you
> overlap, not full linearizability — you still need read-repair or a consensus layer
> to handle concurrent writes correctly. It's "strong consistency" in the practical
> sense, not a free linearizability guarantee.

**Q10: Map a few well-known systems onto CP vs AP and explain the placement.**

> | System | CAP lean | Why |
> |---|---|---|
> | ZooKeeper / etcd / Consul | CP | Majority quorum (ZAB/Raft); minority refuses writes to stay consistent |
> | HBase | CP | Each region served by exactly one region server; unreachable → unavailable, not stale |
> | Google Spanner | CP (effectively CA-ish) | Paxos + TrueTime; chooses consistency, leans on a very reliable private network to keep A high |
> | Cassandra | Tunable, default AP | Dynamo-style; per-query consistency level lets you slide toward CP |
> | DynamoDB | AP by default, CP option | Eventually consistent reads by default; strongly consistent reads opt-in |
> | Riak | AP | Vector clocks + siblings; built explicitly on the Dynamo paper |
> | MongoDB | CP (default) | Single primary per shard; writes go to primary, failover loses availability briefly |
>
> The honest caveat: most of these are *tunable* per operation, so the single-label
> placement is a simplification of where the default sits.

---

## Senior Questions

These test whether you can reason about CAP rigorously and spot where the model
breaks down.

**Q11: Why do people say "CA" isn't a real option for a distributed system?**

> Because CA means "consistent and available *as long as there's no partition*" — and
> for anything that spans a network, partitions *will* happen, so "CA" is just "CP or
> AP that hasn't decided what to do during a partition yet." You don't get to opt out
> of partitions; you only get to choose your behavior when one occurs.
>
> The only honest CA systems are **single-node** systems (or systems behaving as one
> logical node): a standalone Postgres instance is trivially consistent and available
> because there's no network between replicas to partition. The moment you add a
> second node that must agree, you're choosing C-vs-A-under-partition whether you
> admit it or not. So when a vendor markets a distributed database as "CA," the right
> follow-up is: "what does it do when the replicas can't see each other?" — and the
> answer is always either "stops serving" (CP) or "diverges" (AP).

**Q12: Is CAP a property of a whole system, or can it differ per operation?**

> Per operation — and this is one of the most important refinements over the slogan.
> The CP/AP choice is made *per request*, not stamped on the system once.
>
> Cassandra is the clean example: a single cluster can serve one query at
> `consistency=ONE` (AP — fast, possibly stale) and the next at `consistency=QUORUM`
> or `ALL` (CP — overlap-guaranteed, fails if not enough replicas respond). Even
> within one feature you might write at QUORUM but read at ONE. DynamoDB lets you flag
> individual reads as strongly vs eventually consistent.
>
> So the correct framing is: CAP describes the behavior of a *given operation under a
> given configuration during a partition*. A mature design assigns the consistency
> level to each operation based on that operation's tolerance for staleness, rather
> than picking one global setting. Saying "Cassandra is AP" is shorthand for "its
> defaults are AP-leaning."

**Q13: Sketch the Gilbert–Lynch impossibility argument. Why is the trade-off provable, not just empirical?**

> It's a short, beautiful contradiction proof. Assume a system that is simultaneously
> linearizable (C), available (A), and partition-tolerant (P), and derive a
> contradiction.
>
> Set up two nodes, G1 and G2, each holding a replica of value `x = v0`, with a
> partition between them so no messages cross.
>
> ```mermaid
> sequenceDiagram
>     participant Client
>     participant G1 as Node G1
>     participant G2 as Node G2
>     Note over G1,G2: Network partition — no messages cross
>     Client->>G1: write x = v1
>     activate G1
>     Note over G1: Availability ⇒ must respond,<br/>cannot wait for G2
>     G1-->>Client: OK (x = v1 on G1)
>     deactivate G1
>     Client->>G2: read x
>     activate G2
>     Note over G2: Availability ⇒ must respond,<br/>still believes x = v0
>     G2-->>Client: x = v0  ❌ stale
>     deactivate G2
>     Note over G1,G2: Read returned v0 after write of v1 committed<br/>⇒ NOT linearizable. Contradiction.
> ```
>
> The logic: a client writes `x = v1` to G1. By **Availability**, G1 must respond
> without waiting for G2 (it can't reach it — **Partition**). Now a client reads `x`
> from G2. By **Availability**, G2 must respond without consulting G1. G2 has never
> seen the write, so it returns `v0`. But linearizability (**Consistency**) requires
> the read, which happens after the write completed, to return `v1`. It returned `v0`
> — contradiction. Therefore no system can hold all three during a partition. It's
> provable because it's a pure information argument: G2 *cannot* know about a write it
> received zero bits about. No clever engineering beats the speed of "no messages."

**Q14: A teammate claims their system is "strongly consistent AND always available." How do you stress-test that claim?**

> I'd accept it only with a partition caveat, then probe the partition behavior
> directly:
>
> 1. **"When the network splits the cluster, what happens to a write on the minority
>    side?"** If the answer is "it succeeds," they're AP and not strongly consistent.
>    If "it errors/blocks," they're CP and not always available. There's no third door.
> 2. **"What's your write quorum versus replica count?"** If W < majority, a partition
>    can let both sides accept writes → divergence.
> 3. **"Do you depend on a single reliable network?"** Systems like Spanner *look*
>    like CA because Google's private network makes partitions extremely rare and
>    short — but Spanner still chooses C and gives up A when a partition does occur.
>    "Rare partitions" is an operational fact, not an escape from CAP.
>
> The claim is usually true *in the absence of partitions*, which is the part CAP
> doesn't constrain. The honest restatement is: "strongly consistent, and highly
> available *when the network is healthy*."

**Q15: What are CAP's limitations, and what does PACELC add?**

> CAP's big blind spot: it only describes behavior *during a partition*, and
> partitions are the rare case. It says nothing about the trade-off you make 99.9% of
> the time — when the network is fine. But that everyday trade-off is real: to be
> strongly consistent, you must coordinate across replicas (quorums, consensus), which
> costs **latency**. CAP is silent on this.
>
> **PACELC** (Abadi, 2012) closes the gap. Read it as: *if there is a Partition (P),
> choose between Availability and Consistency (A/C); Else (E), in normal operation,
> choose between Latency and Consistency (L/C).*
>
> | System | PACELC | Reading |
> |---|---|---|
> | Dynamo / Cassandra | PA/EL | AP under partition; low latency over consistency normally |
> | Spanner | PC/EC | Consistent under partition; pays latency for consistency always |
> | MongoDB | PA/EC (configurable) | Leans available under partition, consistent when healthy |
> | etcd / ZooKeeper | PC/EC | Consistency in both regimes |
>
> The everyday "E" branch is often the *more* important one because partitions are
> rare but latency is paid on every request. CAP makes you think about the disaster;
> PACELC makes you think about the bill you pay daily.

---

## Professional / Deep-Dive Questions

These expect production scars and precise vocabulary.

**Q16: Linearizability vs sequential consistency vs eventual consistency — where do they sit relative to CAP's C?**

> CAP's C is specifically **linearizability**, the strongest single-object model. It's
> worth ranking the neighbors because "consistent" is used loosely:
>
> | Model | Guarantee | Real-time order? | CAP relation |
> |---|---|---|---|
> | Linearizability | Single up-to-date copy; ops appear instantaneous in real-time order | Yes | This *is* CAP's C |
> | Sequential consistency | A single global order all clients agree on, but not tied to wall-clock real time | No | Weaker than CAP-C |
> | Causal consistency | Causally-related ops seen in order; concurrent ops may differ | Partial | Achievable while staying available (sticky-available) |
> | Eventual consistency | Replicas converge *if* writes stop; no order guarantee meanwhile | No | The AP regime |
>
> A crucial nuance from the "highly-available transactions" line of work: **causal
> consistency is the strongest model achievable in an always-available
> (partition-tolerant, available) system.** Linearizability and sequential consistency
> are not — they require giving up availability during partitions. So if a feature
> needs to stay available no matter what, causal+ is your ceiling.

**Q17: How do you choose CP vs AP for a specific feature — give me a payments example and a "likes counter" example.**

> I anchor on one question: *what's the cost of serving stale or conflicting data
> versus the cost of returning an error?*
>
> **Payments / account balance / inventory decrement → CP.** Double-spending money or
> overselling the last item is a correctness violation with legal and financial
> consequences. I'd rather the operation fail and the user retry than commit two
> conflicting truths. So I route these through a linearizable store (consensus-backed
> primary, transactional DB, or QUORUM writes with R+W>N), and I accept that during a
> partition the minority side rejects the operation. The user sees "try again," not a
> wrong balance.
>
> **Like counts / view counts / "last seen" / social feeds → AP.** A like counter
> being off by 3 for a few seconds harms nothing. Here availability and latency win:
> serve from the nearest replica, accept eventual convergence, use a CRDT counter
> (e.g., a PN-Counter) so concurrent increments on both sides of a partition merge
> without losing increments. The system never tells a user "you can't like this right
> now."
>
> The senior move is recognizing both can live in the *same product*: the checkout
> path is CP, the engagement metrics path is AP, and you choose per data flow, not per
> company.

**Q18: Walk through a concrete failure where someone wrongly chose AP for money and it cost them.**

> The canonical class is **lost-update / double-spend under last-write-wins**. Picture
> a wallet stored AP with LWW conflict resolution, balance = $100. A partition splits
> the replicas. On side A the user spends $80 (balance → $20). On side B,
> concurrently, the user spends $70 (balance → $30). Both succeed because each side is
> available and writes locally.
>
> On heal, LWW keeps whichever write has the higher timestamp — say $30 — and silently
> discards the other. Net: the user spent $150 but the ledger shows a $30 balance and
> the business is out the difference. No error was ever raised; the loss is invisible
> until reconciliation.
>
> The fixes all amount to "don't use LWW for monotonic money": model the balance as a
> sequence of *immutable transactions* (an append-only ledger) rather than a mutable
> total, require a quorum/consensus on the spend operation (CP for that path), or use
> a conflict-free structure that can't lose updates. The lesson: AP's "resolve later"
> is fine for commutative data and catastrophic for "must not overcount/undercount"
> data.

**Q19: How do timeouts turn CAP from a binary into a continuous, latency-driven decision?**

> Because in practice you can't *detect* a partition instantly — you infer it from a
> timeout. A node waiting for a quorum ack doesn't know if the peer is dead, slow, or
> unreachable; it only knows the clock ran out. So every system has a knob: *how long
> do I wait before I decide a partition is happening and trigger my C-or-A behavior?*
>
> - Wait longer → you tolerate transient slowness without sacrificing consistency, but
>   you raise tail latency and risk looking "down."
> - Time out sooner → you stay responsive (favor A/latency), but you'll declare
>   partitions that were just blips, and react (fail writes, or accept divergence)
>   unnecessarily.
>
> This is exactly why Abadi argued the *Else* branch of PACELC matters: even with no
> real partition, the consistency-vs-latency trade-off is live on every request,
> mediated by these timeouts. So CAP's "binary under partition" is, operationally, a
> continuous latency-budget decision. There's a well-known formulation: consistency,
> availability, and *latency* form a continuous trade-off — partition is just the
> infinite-latency corner case.

**Q20: How does Spanner appear to "beat" CAP, and what's really going on?**

> Spanner is externally-consistent (linearizable, even across the globe) *and*
> operationally very available — so it looks like it broke CAP. It didn't. Three
> things are true at once:
>
> 1. **It is a CP system.** When a real partition isolates a Paxos group from its
>    quorum, Spanner chooses consistency and that group becomes unavailable for writes.
>    No magic — it gives up A, per the theorem.
> 2. **Partitions are made rare and short.** Google runs Spanner over a private,
>    heavily-redundant network with engineered failure domains, so the A-sacrificing
>    case almost never fires. High *operational* availability ≠ CAP's A.
> 3. **TrueTime** — GPS+atomic-clock-backed bounded-uncertainty timestamps — lets
>    Spanner assign a global commit order and *wait out* clock uncertainty (commit-wait)
>    instead of coordinating message round-trips for ordering. This buys
>    linearizability cheaply on the latency axis, addressing PACELC's "EC" cost, not
>    CAP.
>
> So the honest summary, which Brewer himself wrote: Spanner is a CP system that
> achieves availability so high in practice that users can mostly ignore the P. It
> reframes the trade-off economically; it doesn't repeal the theorem.

---

## Staff / Judgment Questions

These are about communication, organizational impact, and avoiding cargo-cult CAP.

**Q21: How would you explain the CP-vs-AP choice to a non-technical product owner who wants "always available and always correct"?**

> I'd drop the jargon and use a money-and-trust analogy, framed as a business decision
> they own.
>
> "Imagine our system runs in two buildings connected by a phone line. Almost always
> the line works. But once in a while it goes dead, and the two buildings can't check
> with each other. In that moment we have exactly two choices, and I need you to pick
> per feature:
>
> - **Be safe (CP):** when the buildings can't talk, we *pause* the risky action and
>   tell the customer 'one second, please retry.' Nobody's money gets corrupted, but
>   for a few seconds that feature is unavailable.
> - **Stay open (AP):** when the buildings can't talk, we *keep going* and reconcile
>   when the line comes back. The feature never goes down, but for a few seconds two
>   customers might see slightly different numbers, and rarely we have to fix up a
>   conflict afterward.
>
> For checkout and payments, we choose *safe* — a wrong balance is unacceptable. For
> likes and view counts, we choose *stay open* — a number being briefly off is fine
> and downtime there would annoy users for no benefit. 'Always available and always
> correct' is genuinely impossible the instant the phone line dies, so the real
> decision is *which features lean which way* — and that's a product call as much as
> an engineering one."
>
> The point is to convert an impossibility theorem into an ownable, per-feature risk
> decision rather than a "no, can't be done."

**Q22: Your team is reaching for "eventual consistency everywhere" because it's trendy. How do you push back?**

> I'd reframe it from "trendy default" to "tax you pay forever." Eventual consistency
> isn't free — it pushes the hard problem out of the database and *into every consumer
> of the data and into your on-call rotation*. Specifically:
>
> - **Application complexity:** every read path now has to tolerate stale and
>   conflicting data, handle siblings/merges, and be idempotent. That's code in dozens
>   of places instead of one consistency guarantee in one place.
> - **Operational burden:** you inherit reconciliation jobs, anti-entropy repair,
>   conflict dashboards, and "why is this count wrong?" support tickets forever.
> - **Subtle correctness bugs:** read-your-own-writes violations, lost updates,
>   causality bugs — the expensive, hard-to-reproduce kind.
>
> So my pushback is: *classify the data first.* For commutative, low-stakes, or
> naturally idempotent data (metrics, feeds, caches), eventual consistency is the
> right and cheap choice. For data with invariants (money, inventory, uniqueness,
> auth), the coordination cost of strong consistency is *buying down* far larger
> downstream cost. Default to the strongest model the workload's latency/availability
> budget allows, and *demote* to eventual consistency only where you can name why it's
> safe. "Eventual everywhere" is as much a smell as "strong everywhere."

**Q23: When is CAP the wrong framework to reach for at all? What should you use instead?**

> CAP is a great *conversation starter* and a terrible *design spec*. It's the wrong
> tool when:
>
> - **You're not designing a replicated store.** CAP is about a single replicated data
>   object under partition. For end-to-end request architecture, latency budgets,
>   throughput, and failure isolation, CAP barely applies.
> - **The interesting trade-off is the everyday one.** Most of your latency and most
>   user pain comes from normal operation, not partitions. **PACELC** is the better
>   frame because it forces the consistency-vs-latency conversation that happens on
>   every request.
> - **You need a precise contract.** "We're AP" tells a developer almost nothing.
>   Naming the **consistency model** (linearizable, causal+, read-your-writes,
>   monotonic reads, eventual) is a real, testable spec. Jepsen-style analyses and the
>   consistency-model hierarchy are far more actionable than the CAP triangle.
> - **You're choosing per operation.** As established, the unit of decision is the
>   operation, not the system, so a system-level CAP label is already a lossy summary.
>
> My rule: use CAP to *open* the discussion and to sanity-check partition behavior,
> then immediately move to PACELC for the latency axis and to named consistency models
> for the actual contract. CAP is the doorway, not the room.

**Q24: Design judgment — sketch how you'd split consistency choices across a real e-commerce checkout flow.**

> I'd map each data flow to the strongest model its risk profile demands, accepting a
> mix within one product.
>
> | Data flow | Choice | Reasoning |
> |---|---|---|
> | Product catalog / descriptions | AP / eventual | Read-heavy, low stakes; stale for seconds is invisible. Cache aggressively. |
> | Inventory decrement at checkout | CP (linearizable on the item) | Overselling the last unit is a real loss; coordinate or use atomic conditional writes. |
> | Cart contents | Causal / session-consistent | Must be read-your-writes for the user; can be available, doesn't need global linearizability. |
> | Payment authorization | CP + idempotency keys | Must never double-charge; consensus-backed, exactly-once semantics via idempotency. |
> | Order placement | CP, append-only | Orders are immutable facts; write once to a linearizable log. |
> | Recommendations / "people also bought" | AP / eventual | Approximate by nature; availability and latency win. |
> | View/like/cart-add analytics | AP / CRDT counters | Commutative, lossy-tolerant, must never block the hot path. |
>
> The staff-level point: a single checkout is *not* one CAP decision. It's a dozen
> data flows, each placed independently, with the strong-consistency budget spent only
> where invariants demand it (money, inventory, identity) and availability/latency
> favored everywhere else. The architecture's quality is in *where you drew those
> lines*, and being able to defend each one in PACELC terms — not in claiming the whole
> system is "CP" or "AP."

---

*Next step:* [PACELC](../02-pacelc/junior.md)
