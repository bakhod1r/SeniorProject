# Key Characteristics of Systems — Interview Questions

A system-design interview rarely asks "design Twitter" cold. It probes whether
you can name the *non-functional* properties that make a design good or bad —
scalability, availability, reliability, maintainability — and whether you can
reason about them with numbers instead of adjectives. This file walks the full
ladder, from "define availability" to "your CFO wants 99.999%, talk them out of
it." Every answer is quantified; vague answers are what separate a mid-level
candidate from a senior one.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Staff / Judgment Questions](#staff--judgment-questions)
6. [Rapid-Fire Recap](#rapid-fire-recap)

---

## Junior Questions

**Q1: Define scalability in one sentence, then say what "scales well" actually means.**

> Scalability is a system's ability to handle increased load by adding
> resources. The one-sentence definition is easy; the discriminating follow-up
> is the second clause: a system "scales well" when the *cost per unit of work*
> stays roughly flat as load grows. If doubling traffic forces you to more than
> double the hardware, the system scales *poorly* — you have negative returns to
> scale. Load can be more requests per second, more concurrent users, more data,
> or larger individual payloads, and a design can scale gracefully on one axis
> while collapsing on another (a service that handles 10× QPS fine may die when
> a single row grows to 10 GB). Always ask "scale along which dimension?"

**Q2: Define availability and reliability, and state how they differ.**

> Availability is the fraction of time a system is *up and able to serve
> requests* — it answers "is it on right now?" Reliability is the probability
> that the system performs *correctly* for a given period — it answers "when
> it's on, does it do the right thing without failing?" They differ because a
> system can be available but unreliable, and reliable but unavailable. A bank
> ATM that is reachable 100% of the time but returns the wrong balance 1% of the
> time is highly available and poorly reliable. A backup batch job that is only
> "up" one hour a night but never produces a wrong result during that hour is
> low-availability, high-reliability. Reliability is the stronger property:
> *availability counts uptime; reliability counts correct uptime.*

**Q3: What is the difference between horizontal and vertical scaling?**

> Vertical scaling (scale up) means making a single machine bigger — more CPU,
> RAM, faster disk. Horizontal scaling (scale out) means adding more machines
> and spreading load across them. Vertical is simpler (no code changes, no
> distributed-systems problems) but has a hard ceiling — the biggest box money
> can buy — and that one box is a single point of failure. Horizontal has
> effectively no ceiling and gives you fault tolerance for free (lose one node,
> the others carry on), but it forces you to solve load balancing, data
> partitioning, and consistency. The senior instinct: scale up until it hurts,
> then scale out, because the operational cost of "out" is real.

| Dimension | Vertical (scale up) | Horizontal (scale out) |
|---|---|---|
| Ceiling | Hard limit (largest single box) | Effectively unbounded |
| Fault tolerance | None — one box is a SPOF | Built in — lose a node, survive |
| Complexity | Low — same code, bigger machine | High — LB, sharding, consensus |
| Cost curve | Super-linear at the high end | Roughly linear (commodity HW) |
| Downtime to scale | Often a reboot/migration | Add a node live, no downtime |
| State | Easy (one place) | Hard (must distribute/replicate) |

**Q4: What does "five nines" mean, and how much downtime does it allow?**

> "Five nines" is 99.999% availability. The number of nines maps directly to a
> downtime budget, which you should memorize because interviewers love this:
>
> | Availability | Downtime / year | Downtime / month | Downtime / day |
> |---|---|---|---|
> | 99% ("two nines") | 3.65 days | 7.3 hours | 14.4 min |
> | 99.9% ("three nines") | 8.77 hours | 43.8 min | 1.44 min |
> | 99.99% ("four nines") | 52.6 min | 4.38 min | 8.6 sec |
> | 99.999% ("five nines") | 5.26 min | 26.3 sec | 0.86 sec |
>
> Five nines means *5.26 minutes of downtime per year* — less time than a single
> careless deploy or a manual DNS change. That budget is so tight that you
> cannot achieve it with humans in the loop; it demands automated failover,
> redundant everything, and no maintenance windows. Each added nine costs
> roughly 10× more effort, which is why "how many nines do you actually need?"
> is the more important question.

**Q5: What is a single point of failure (SPOF)?**

> A SPOF is any component whose failure takes the whole system down because
> there is no redundant copy to take over. The classic examples: one database
> primary with no replica, one load balancer, a single message broker, a config
> service everything depends on, or even a single availability zone. Finding
> SPOFs is a checklist exercise — trace every request path and ask "if this one
> box dies right now, am I still serving?" If the answer is no, you have a SPOF
> and high availability is impossible no matter how good the rest is. Removing
> them means adding redundancy (N+1 or N+2 instances) plus a failover mechanism
> that detects the failure and routes around it.

**Q6: What is maintainability and why should a junior care about it?**

> Maintainability is how easily and cheaply the system can be operated,
> understood, and changed over its life — Kleppmann breaks it into operability
> (easy to run), simplicity (easy to understand), and evolvability (easy to
> change). Juniors care because *most of a system's cost is paid after it
> ships.* Code is read far more than it's written, and the team that inherits a
> clever-but-opaque service pays for it every on-call shift. A maintainable
> system has good logs, metrics, runbooks, clear naming, and few surprising
> interdependencies. It is the one characteristic that doesn't show up in a load
> test but shows up in every postmortem.

---

## Middle Questions

**Q7: A vendor advertises 99.99% availability per server. You run two
identical servers behind a load balancer. What is the combined availability,
and what assumption are you making?**

> If a request succeeds when *at least one* server is up, the two servers are in
> *parallel*, and parallel components multiply their *unavailabilities*:
>
> - Single-server unavailability: 1 − 0.9999 = 0.0001
> - Both down at once: 0.0001 × 0.0001 = 0.00000001
> - Combined availability: 1 − 0.00000001 = 0.99999999 ≈ "eight nines"
>
> So two four-nines servers in parallel can theoretically reach eight nines. The
> load-bearing assumption is **independence** — the failures must be
> uncorrelated. In reality they rarely are: both servers share a load balancer,
> a power feed, a network, a deploy pipeline, and the same buggy release. A
> correlated failure (bad deploy pushed to both) makes the real number far
> worse than the math suggests. The parallel formula is the *ceiling*, not the
> expectation.

**Q8: Now those two servers both sit behind one load balancer with 99.9%
availability, and the request must pass through the LB *then* a server. What's
the end-to-end availability?**

> Now you have two stages **in series**: the LB, then the server tier.
> Series components multiply *availabilities* (every stage must be up):
>
> - Server tier (the parallel pair from Q7): ≈ 0.99999999
> - Load balancer: 0.999
> - End-to-end: 0.999 × 0.99999999 ≈ **0.99899999 ≈ 99.9%**
>
> The lesson is brutal and worth stating out loud: **a chain is only as
> available as its weakest link, and series links can only make availability
> *worse*.** Your beautiful eight-nines server tier was dragged down to three
> nines by a single non-redundant load balancer. This is why removing SPOFs
> matters more than over-engineering the parts that are already redundant — and
> why you'd put two load balancers in parallel too.

**Q9: How do MTBF and MTTR set a system's availability?**

> MTBF is Mean Time Between Failures — how long the system runs before it
> breaks. MTTR is Mean Time To Recovery — how long it's down once it breaks.
> Steady-state availability is:
>
> ```
> Availability = MTBF / (MTBF + MTTR)
> ```
>
> The non-obvious insight is that **you can buy availability by shrinking MTTR,
> not just by raising MTBF.** Suppose MTBF = 30 days (720 h). If MTTR is 4 hours
> of manual recovery, availability = 720 / 724 = 99.45%. Now automate failover
> so MTTR drops to 30 seconds (0.0083 h): availability = 720 / 720.0083 =
> 99.9988% — better than four nines, with *the same failure rate*. Making things
> fail less is expensive and hits diminishing returns; making recovery fast is
> often cheaper and more effective. This is the entire argument for "design for
> failure" over "prevent all failure."

**Q10: Walk me through how you'd make a stateless web service highly available.**

> The pattern is redundancy plus automatic failover at every layer:
>
> 1. **Run N+1 (or N+2) identical instances**, never one. Stateless means any
>    instance can serve any request, so losing one just sheds 1/N of capacity.
> 2. **Spread them across failure domains** — multiple availability zones, ideally
>    regions — so a datacenter outage doesn't take all instances at once.
> 3. **Put a load balancer in front with health checks**; it stops routing to a
>    sick instance within seconds. Make the LB itself redundant (two LBs, or a
>    managed/anycast LB) so it isn't a new SPOF.
> 4. **Auto-scaling / self-healing**: a crashed instance is replaced
>    automatically, which is what keeps MTTR in the seconds range.
> 5. **No sticky local state** — push sessions to a shared store (Redis) so a
>    failover doesn't lose the user's context.
>
> The hard part is almost never the stateless tier; it's the database behind it.
> "Stateless service HA is easy, stateful HA is the real interview" is a fair
> thing to say out loud.

**Q11: Why isn't throughput linear when you double the number of servers?**

> Because real workloads have a serial fraction and a coordination cost. Two
> models name this:
>
> - **Amdahl's Law**: if a fraction *s* of the work is inherently serial,
>   speedup is capped at 1/*s* no matter how many cores/servers you add. If 5% is
>   serial, you can never go faster than 20×, even with infinite hardware.
> - **Universal Scalability Law (USL)**: extends Amdahl by adding a *coherency*
>   (crosstalk) term — the cost of nodes coordinating with each other (locks,
>   cache coherence, distributed consensus). Because that term grows with N²,
>   throughput doesn't just plateau, it can *peak and then decline*: adding the
>   31st node can make the system slower than 30 nodes.
>
> Practically: shared resources (a single DB, a global lock, a hot partition)
> are the serial fraction, and chatty coordination is the coherency penalty.
> Scaling well means driving both toward zero — partition the data, avoid global
> locks, prefer share-nothing designs.

**Q12: Give a concrete example where a system is reliable but not available, and
the reverse.**

> *Reliable but not available*: a nightly reconciliation job that runs for one
> hour and is offline the other 23. While it runs it is correct 100% of the time
> (high reliability), but its availability is ~4%. Nobody cares — availability
> isn't its job.
>
> *Available but not reliable*: a price API that responds to every request
> within 50 ms (100% available) but returns stale prices 2% of the time due to a
> cache bug. It's always *up*, but it's lying 2% of the time — low reliability,
> and in a trading context that's catastrophic even though the dashboard is all
> green. The takeaway: an uptime SLA alone can hide a correctness problem.
> Mature SLOs measure *successful, correct* responses, not just "got a 200."

---

## Senior Questions

**Q13: Explain the CAP theorem and how it forces a trade-off between
characteristics.**

> CAP says that when a network **P**artition happens, a distributed system must
> choose between **C**onsistency (every read sees the latest write) and
> **A**vailability (every request gets a non-error response). You can't have
> both *during a partition* — that's the only time CAP actually bites. The
> trade-off is the textbook example of one characteristic capping another:
>
> - A **CP** system (e.g., a strongly consistent store, ZooKeeper, etcd) refuses
>   to serve on the minority side of a partition to avoid returning stale or
>   conflicting data. It sacrifices availability to protect correctness.
> - An **AP** system (e.g., Dynamo-style stores, Cassandra with low quorum)
>   keeps serving on both sides and reconciles later. It sacrifices consistency
>   to stay up.
>
> The nuance seniors must add: CAP is about the *partition moment only*. The
> richer model is **PACELC** — *if Partition, choose A or C; Else (normal
> operation), choose Latency or Consistency.* Even with no partition you pay for
> strong consistency in latency, because reads must coordinate. So "we picked
> CP" is incomplete; you're also signing up for higher steady-state latency.

**Q14: A characteristic is only as strong as its weakest dependency. Show how a
weak characteristic caps the others.**

> Take a service that is beautifully scalable and highly available but depends on
> one non-redundant config store. The config store's reliability now *caps the
> whole system's* availability, because every request needs config. You can run
> 500 stateless app instances across three regions and it buys you nothing — the
> single config store is the series link from Q8, and series only subtracts.
>
> The general principle: end-to-end availability is the **product** of every
> dependency on the critical path. If your service is 99.99% but it
> synchronously calls a 99.9% payment provider and a 99.5% fraud service for
> every request, your real availability is 0.9999 × 0.999 × 0.995 ≈ **99.39%** —
> worse than any single component. A senior design *minimizes synchronous
> dependencies on the critical path* (make the fraud check async, cache config,
> add fallbacks) precisely so one weak link can't drag everything down.

**Q15: Draw the sequence of events when a primary database fails and a replica
is promoted. Where does the availability "downtime" come from?**

> The downtime is the detection + promotion + cutover window — your MTTR. Here it
> is staged:
>
> ```mermaid
> sequenceDiagram
>     autonumber
>     participant App as App Tier
>     participant P as Primary DB
>     participant M as Failover Monitor
>     participant R as Replica
>     participant DNS as Service Discovery
>     App->>P: writes (normal operation)
>     P-->>R: async replication stream
>     Note over P: 💥 Primary crashes
>     App->>P: write
>     App--xP: timeout (no response)
>     Note over App: requests failing — downtime starts
>     M->>P: health check
>     M--xP: no heartbeat (N missed checks)
>     Note over M: confirm failure, avoid false positive
>     M->>R: promote to primary
>     R-->>M: promotion complete
>     M->>DNS: repoint primary endpoint to R
>     DNS-->>App: new primary address
>     App->>R: writes resume
>     Note over App,R: downtime ends — total = detect + promote + cutover
> ```
>
> The interview gold is naming each contributor to MTTR: **detection** (you must
> miss several heartbeats to avoid flapping on a transient blip), **promotion**
> (the replica may need to catch up / replay WAL), and **cutover** (DNS TTL,
> connection-pool refresh, client retries). Shrinking any of these shrinks
> downtime. And note the *reliability* cost hiding here: async replication means
> the replica may be missing the last few committed writes — you traded a little
> data durability for faster failover. CP vs AP, in miniature.

**Q16: How do you decide which characteristic matters most for a given
business?**

> You map characteristics to the cost of their failure *for this specific
> domain*, because the priority order is not universal:
>
> | System | Top priority | Why |
> |---|---|---|
> | Payment / ledger | Consistency + reliability | A wrong balance is unrecoverable trust loss; brief downtime is survivable |
> | Ad-serving / feed | Availability + latency | A stale ad or slightly old feed is fine; *blank* page loses money every ms |
> | Telemetry ingestion | Scalability + availability | Must absorb huge write volume; losing 0.01% of metrics is acceptable |
> | Medical / aviation | Reliability (correctness) | A wrong answer can kill; you'd rather fail closed than be wrong |
> | Internal analytics | Maintainability + cost | Few users, infrequent runs; engineer time dominates the bill |
>
> The senior framing: ask "what's the *blast radius* of each characteristic
> failing?" For a bank, an inconsistent read is far worse than a 500. For a
> social feed, a 500 is far worse than a slightly stale post. You optimize the
> characteristic whose failure mode is least acceptable to *this* business, and
> you deliberately under-invest in the others to save money and complexity.

**Q17: What does "design for failure" mean concretely, beyond the slogan?**

> It means assuming every dependency *will* fail and building the system so a
> failure degrades gracefully instead of cascading. Concretely:
>
> - **Timeouts and retries with backoff + jitter** on every network call, so a
>   slow dependency doesn't pin your threads forever.
> - **Circuit breakers** that stop hammering a dead service and fail fast,
>   protecting your own MTTR and preventing a thundering-herd recovery.
> - **Bulkheads** — isolate resource pools so one slow downstream can't consume
>   all your connections and take out unrelated endpoints.
> - **Graceful degradation / fallbacks** — serve a cached or default response
>   when the live source is down (show last-known price, hide the recommendation
>   widget) instead of erroring the whole page.
> - **Idempotency** so a retry after an ambiguous failure doesn't double-charge.
>
> Each of these attacks MTTR (recover fast) and blast radius (contain the
> failure) rather than trying to prevent failure, which is the more honest and
> cheaper path to high availability.

**Q18: Availability and cost trade off. How do you reason about how many nines to
buy?**

> You compare the *marginal cost of a nine* against the *marginal cost of the
> downtime it removes.* Each additional nine roughly 10×'s the engineering and
> infrastructure effort (single region → multi-AZ → multi-region active-active →
> chaos-tested automated failover), while removing ~90% of the remaining
> downtime. So you ask: what does an hour of downtime actually cost us?
>
> - For a hobby app, 99% (3.65 days/year down) might be totally fine — buying
>   nines is wasted money.
> - For e-commerce at \$X revenue/hour, you compute the expected annual downtime
>   cost at each level and stop where the next nine costs more than the downtime
>   it saves.
> - Five nines is justified almost only for infrastructure others depend on
>   (DNS, auth, payment rails), where your downtime multiplies across many
>   customers.
>
> The senior move is to *push back on a number pulled from thin air*: "99.999%"
> from a stakeholder usually means "I don't want it to go down," not a costed
> requirement. Translate it into a downtime budget and a dollar figure and let
> the business decide if the last nine is worth a multi-region rewrite.

---

## Professional / Deep-Dive Questions

**Q19: You've added nodes and throughput went *down*. Diagnose it with the USL.**

> Throughput peaking then declining is the signature of the USL's **coherency**
> term dominating. Universal Scalability Law:
>
> ```
> C(N) = N / (1 + α(N − 1) + β·N(N − 1))
> ```
>
> where α is contention (serialization, the Amdahl part) and β is coherency
> (crosstalk — nodes coordinating with each other). The α term makes throughput
> *plateau*; the β·N² term makes it *retrograde*, because coordination cost grows
> faster than the work added. When you see throughput fall as you add capacity,
> β is non-zero and meaningful. Real-world culprits:
>
> - A shared lock or hot row every node fights over (β explodes).
> - Distributed coordination — every node gossiping/heartbeating with every
>   other node is O(N²) chatter.
> - Cache-coherency traffic, or a chatty consensus quorum that grows with N.
>
> The fix is architectural, not "add more nodes": shard the contended resource,
> partition so nodes touch disjoint data (share-nothing), batch coordination,
> or use a hierarchy instead of all-to-all communication. The diagnostic punch
> line: *if scaling out makes it slower, you have a coordination problem, and no
> amount of hardware solves a coordination problem.*

**Q20: Model a system as a state machine to reason about availability. Draw it.**

> Treating the system as a Markov state machine makes MTBF/MTTR and the
> availability formula fall out naturally. The simplest two-state model:
>
> ```mermaid
> stateDiagram-v2
>     [*] --> Up
>     Up --> Down: failure (rate = 1/MTBF)
>     Down --> Up: repair (rate = 1/MTTR)
>     Up: Up — serving correctly
>     Down: Down — failed / recovering
>     note right of Up
>       Steady-state availability =
>       MTBF / (MTBF + MTTR)
>     end note
>     note right of Down
>       Time spent here per failure = MTTR.
>       Automate repair to shrink this state.
>     end note
> ```
>
> The value of the state-machine view is that it scales to richer models:
> add a **Degraded** state (running on N−1 nodes, reduced capacity), a
> **Recovering** state (replica catching up, reads OK but writes blocked), or a
> **Split-brain** state (the dangerous one in AP systems). Each state has an
> entry probability and a dwell time, and availability is the fraction of time in
> "serving" states weighted by capacity. This is exactly how you'd justify, with
> numbers, that "fast recovery beats rare failure" — you're shrinking the dwell
> time of the Down state, which dominates the availability integral.

**Q21: Reliability ≠ availability — design an SLO that captures both.**

> A pure uptime SLO ("99.9% of the time a server answers") is gameable: a server
> returning 200s with wrong data scores perfectly. A real SLO is built on a
> **Service Level Indicator** that measures *good* events, not *any* events.
> Define "good" along both axes:
>
> - **Availability SLI**: `successful responses / total valid requests`, where
>   "successful" excludes 5xx *and* timeouts beyond a latency threshold. This
>   folds latency into availability — a response that's too slow to be useful
>   counts as unavailable.
> - **Reliability/correctness SLI**: domain-specific — `responses that returned
>   correct, fresh data / total responses`. For a price API, freshness within X
>   seconds; for a ledger, balance matches source of truth.
>
> Then set an **error budget**: at a 99.9% SLO you may "spend" 0.1% of requests
> as failures per window. The error budget is the bridge between reliability and
> velocity — if you're under budget, ship features fast; if you've burned it,
> freeze and stabilize. This is the operational mechanism that stops "we want
> 100% reliability" (impossible and infinitely expensive) and replaces it with a
> negotiated, measurable target.

**Q22: When does adding redundancy *reduce* reliability instead of improving it?**

> Redundancy improves availability but can hurt reliability and correctness in
> three classic ways, and a strong candidate names them:
>
> 1. **Correlated failures**: redundant copies that share a root cause (same bad
>    deploy, same poisoned config, same expired cert, same AZ power) all fail
>    together. The independence assumption behind the parallel-availability math
>    breaks, so your "redundancy" is illusory. Real HA requires *diverse* failure
>    domains, not just *more* instances.
> 2. **Split-brain**: two redundant primaries that both think they're in charge
>    during a partition accept conflicting writes. Now you've traded a clean
>    outage for silent data corruption — availability up, reliability
>    catastrophically down. This is why CP systems use quorum/fencing to refuse
>    minority-side writes.
> 3. **Added complexity**: every failover mechanism is itself code that can be
>    buggy. A botched automatic failover (flapping, promoting a stale replica,
>    losing committed writes) often causes worse incidents than the failure it
>    was meant to handle. The failover path is the least-tested code in the
>    system and runs only during a crisis.
>
> The synthesis: redundancy is necessary for availability but must be paired with
> *failure-domain diversity* and *consensus-based coordination* (fencing,
> quorums, leader leases) to avoid trading uptime for correctness.

**Q23: Latency, throughput, and tail latency — how do they relate to scalability,
and why do you obsess over p99 instead of the mean?**

> Throughput is volume per unit time (requests/sec); latency is the time for one
> request. They're linked by Little's Law — `L = λ × W` (concurrency = arrival
> rate × latency) — so if latency creeps up under load, the same throughput needs
> more in-flight requests, more threads/connections, more memory, and you hit a
> resource wall. That's a scalability ceiling expressed through latency.
>
> You obsess over **p99/p99.9 tail latency, not the mean**, for two reasons.
> First, the mean hides pain: a 50 ms mean can hide a 2 s p99 that's making 1% of
> users miserable. Second — the killer at scale — **tail latency amplifies with
> fan-out.** If one backend call has a 1% chance of being slow (p99), and a
> single user request fans out to 100 backends in parallel and waits for all,
> the probability that request hits *at least one* slow backend is
> 1 − 0.99¹⁰⁰ ≈ **63%**. So a 1-in-100 tail becomes a near-certainty for any
> fanned-out request. This is why Dean & Barroso's "The Tail at Scale" pushes
> hedged requests, tied requests, and aggressive p99 budgets — at scale the tail
> *is* the experience.

---

## Staff / Judgment Questions

**Q24: A stakeholder demands 99.999% availability for an internal HR tool used by
200 employees during business hours. How do you respond?**

> I'd reframe rather than build. Five nines means a multi-region active-active
> architecture, automated failover, no maintenance windows, and chaos
> engineering — easily 10× the cost and complexity of the tool itself. But the
> *requirement behind the number* almost certainly isn't five nines:
>
> 1. **Recompute the budget against actual usage.** The tool is used ~40 hours a
>    week. 99.9% (three nines) gives 8.77 hours of downtime *per year* — but if
>    you measure availability only during business hours and schedule maintenance
>    at night, the *user-visible* availability is far higher than the raw number
>    suggests. The naive five-nines ask ignores that downtime at 3 a.m. costs
>    nothing here.
> 2. **Price the failure.** What does an hour of HR-tool downtime actually cost?
>    Probably a few annoyed employees and a delayed PTO request — not five-nines
>    money. The marginal nine from 99.9% → 99.999% removes ~8.7 hours/year of
>    downtime at a cost of a major rearchitecture. The math doesn't clear.
> 3. **Offer the right target.** Likely 99.9% with good backups, fast restore
>    (low MTTR), and a status page. Spend the saved budget on maintainability and
>    a solid RPO/RTO for the *data*, which is what actually matters for HR
>    records.
>
> The staff-level signal is refusing to take a number at face value and instead
> negotiating a *costed, business-justified* SLO. Cargo-culting "five nines"
> burns money and is itself a reliability risk, because the complex failover
> machinery you build is more likely to fail than the simple system it replaced.

**Q25: Two designs hit the same SLO today. One is simpler but will need a rewrite
at 10× scale; the other is complex but scales to 100×. Which do you pick?**

> I optimize for the *probability-weighted future*, not the maximum future.
> Default to the simpler design, and the reasoning is explicitly about
> maintainability and option value:
>
> - **Most systems never reach 10× scale.** Building for 100× now pays a
>   certain, immediate cost in complexity (USL coherency penalties, harder
>   debugging, slower iteration, more SPOFs in the failover machinery) to hedge
>   against a scale that may never arrive. That's negative expected value unless
>   growth is near-certain.
> - **Complexity is a reliability tax you pay every day.** The complex design has
>   lower maintainability — more moving parts, more failure modes, a steeper
>   on-call burden. A weak maintainability characteristic quietly caps
>   availability, because most outages are caused by operator error and bad
>   deploys, which complexity makes more likely.
> - **The simpler design preserves optionality.** As long as the rewrite point is
>   *visible in advance* (you're tracking the metric that predicts the 10× wall)
>   and the migration is *feasible* (clean seams, not a rewrite-the-world cliff),
>   you defer the cost until the growth is real and the requirements are clearer.
>
> I'd pick the simpler design *if and only if* I can point to the specific metric
> that will trigger the rewrite and confirm the architecture has the seams to
> evolve (Kleppmann's evolvability). If the simpler design is a dead end with no
> migration path, that changes the calculus — then I'd invest in the seams now,
> but still not in the full 100× machinery.

**Q26: How do you trade off consistency for availability in a real product, and
how do you communicate that trade-off to non-engineers?**

> First, *partition the product by criticality* — not every operation needs the
> same guarantee, and treating them uniformly is the mistake. In an e-commerce
> system:
>
> - **Checkout / payment / inventory decrement**: strong consistency (CP). A
>   double-sold item or double charge is unacceptable. I'll accept that this path
>   may reject writes during a partition rather than corrupt the ledger.
> - **Product browsing, reviews, recommendations, cart preview**: high
>   availability (AP). A slightly stale review count or recommendation is
>   invisible to users; a blank page loses the sale. Serve from cache/replicas,
>   reconcile asynchronously.
>
> This is **PACELC reasoning applied per-feature**: the same product is CP in one
> path and AP in another, and a senior design draws that line deliberately.
>
> To non-engineers I avoid CAP jargon and translate to business outcomes: *"For
> checkout we choose 'correct even if occasionally slow or briefly unavailable,'
> because a wrong charge costs us a customer and a chargeback. For browsing we
> choose 'always fast even if occasionally a few seconds stale,' because a blank
> page costs us a sale. We can't have both perfectly at the exact instant a
> network splits — physics and the CAP theorem say so — so we pick per feature
> based on what failure we can least afford."* Framing it as *which failure is
> cheaper* — not "consistency vs availability" — is what lands the trade-off with
> a product owner.

**Q27: A single weak characteristic is dragging your whole platform. Walk me
through how you'd find and fix it.**

> I'd treat it as the "weakest link caps the chain" principle and make it
> empirical:
>
> 1. **Measure the real end-to-end SLI per critical path**, then decompose it.
>    Multiply the availability of each dependency on the path; the product should
>    match the observed end-to-end number. The dependency dragging the product
>    down the most is your weak link — usually a non-redundant component, a
>    synchronous call to a flaky third party, or a shared resource everyone
>    contends on (the USL α/β culprit).
> 2. **Classify the fix by characteristic.** If it's a SPOF → add redundancy +
>    failover (improve availability). If it's a slow/flaky synchronous dependency
>    → make it async, cache it, or add a fallback so it leaves the critical path
>    (reduce coupling). If it's a contended shared resource → shard/partition it
>    (improve scalability, lower the USL coherency term). If it's a correctness
>    bug masquerading as uptime → fix the SLI to count correct responses and
>    tighten reliability.
> 3. **Re-derive the math and confirm.** After the fix, recompute the predicted
>    end-to-end availability and validate against production. Then find the *new*
>    weakest link and decide whether the marginal nine is worth chasing — usually
>    you stop once the dominant term is no longer dominant and the cost of the
>    next improvement exceeds the downtime it removes.
>
> The judgment is in step 3: knowing *when to stop*. You don't chase every link
> to perfection; you fix the dominant term, re-measure, and stop when the system
> is balanced and the next nine isn't worth its price.

---

## Rapid-Fire Recap

A condensed map of the formulas and one-liners worth having on instant recall:

| Concept | Formula / Fact | One-line intuition |
|---|---|---|
| Steady-state availability | `MTBF / (MTBF + MTTR)` | Buy uptime by shrinking recovery time |
| Series availability | multiply *availabilities* | Adds links → can only get worse |
| Parallel availability | multiply *unavailabilities* | Redundancy → can only get better (if independent) |
| Five nines | 99.999% = 5.26 min/year | No humans in the loop possible |
| Amdahl's Law | speedup ≤ 1/*s* (serial fraction) | Serial work caps your speedup, period |
| USL | `N / (1 + α(N−1) + β·N(N−1))` | Coordination (β·N²) can make scaling *negative* |
| Little's Law | `L = λ × W` | Latency × rate = concurrency = resource pressure |
| CAP | Partition → choose C or A | Only bites during a partition |
| PACELC | else → choose Latency or Consistency | You pay for consistency even with no partition |
| Tail amplification | `1 − (1−p)^fanout` | A 1% tail becomes 63% over 100 fan-out calls |
| Availability vs reliability | uptime vs *correct* uptime | A green dashboard can still be lying |

The thread connecting all of it: **non-functional characteristics interact
multiplicatively, not additively.** Availability is a product of dependencies,
speedup is bounded by the serial fraction, and the tail dominates at fan-out.
Senior answers replace adjectives ("highly available," "scalable") with the
arithmetic above, then tie the arithmetic back to *which failure this specific
business can least afford*. That last step — from math to business judgment — is
what the Staff questions are really testing.

*Next step:* [Numbers Every Engineer Should Know](../05-numbers-every-engineer-should-know/junior.md)
