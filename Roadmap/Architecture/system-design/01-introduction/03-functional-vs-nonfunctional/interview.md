# Functional vs Non-Functional Requirements — Interview Questions

A system-design interview rarely starts with "design a database." It starts with
"design X," and the very first thing a strong candidate does is split the problem
into **what the system must do** (functional requirements, FRs) and **how well it
must do it** (non-functional requirements, NFRs). The questions below walk that
distinction from first principles up to staff-level judgment calls, with model
answers you can adapt under pressure.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Staff / Judgment Questions](#staff--judgment-questions)
6. [Quick-Reference Tables](#quick-reference-tables)

---

## Junior Questions

**Q1: In one sentence each, what is a functional requirement and what is a non-functional requirement?**

> A **functional requirement** specifies a behavior the system must produce — an
> input-to-output rule, a feature, or a piece of business logic. It answers
> "what does the system *do*?" A **non-functional requirement** specifies a
> *quality* of that behavior — how fast, how reliable, how secure, how scalable
> it must be. It answers "how *well* must the system do it?" Concretely: "users
> can reset their password" is functional; "password reset emails arrive within
> 30 seconds for 99% of requests" is non-functional. FRs define the feature set;
> NFRs define the constraints under which those features must hold.

**Q2: Give three concrete examples of each for a ride-hailing app.**

> Functional requirements:
> 1. A rider can request a ride by specifying pickup and destination.
> 2. The system matches the rider to the nearest available driver.
> 3. A rider can pay via a saved card after the trip ends.
>
> Non-functional requirements:
> 1. Driver-matching completes within 5 seconds at the 95th percentile.
> 2. The service maintains 99.95% availability during peak hours.
> 3. Location updates from 1 million concurrent drivers are ingested without
>    data loss.
>
> Notice the FRs each map to a user-visible action, while the NFRs each attach a
> *measurable bound* to those actions. A feature without an NFR is only half a
> requirement.

**Q3: If you only implemented the functional requirements and ignored the non-functional ones, what could go wrong?**

> The system would be *correct but unusable*. The ride app could match a rider to
> a driver — eventually. But if matching takes 90 seconds, riders abandon the
> app. If the service falls over under load every Friday night, the feature
> technically "works" but fails exactly when it matters. NFRs are what separate a
> demo from a product. They are also where most real-world incidents come from:
> outages, slowness, breaches, and runaway cloud bills are almost always NFR
> failures, not missing features.

**Q4: Where do non-functional requirements usually come from? Are they always written down?**

> They come from several places, and frequently they are *not* written down,
> which is why surfacing them is a senior skill:
> - **Business expectations** — "the site must feel fast," "we can't lose
>   orders."
> - **User experience norms** — implicit thresholds (a click should feel
>   instant, ~100 ms).
> - **Legal and compliance** — GDPR, PCI-DSS, HIPAA, data residency.
> - **Operational reality** — the on-call team's tolerance, the cost budget.
> - **Contractual SLAs** — promises made to paying customers.
>
> Because many NFRs live as unstated assumptions, the candidate who *asks* about
> latency, scale, availability, and consistency in an interview is demonstrating
> exactly the judgment the interviewer is testing for.

**Q5: A product manager says "the app should be fast." Why is that not yet a usable requirement, and what would you ask?**

> "Fast" is a *direction*, not a *target*. It can't be tested, designed against,
> or signed off. To make it usable I'd turn it into a measurable statement by
> nailing down four things:
> 1. **Which operation?** Page load, search, checkout — each has its own budget.
> 2. **Which metric?** Latency at which percentile (p50, p95, p99)?
> 3. **What threshold?** A number, e.g. "search returns in < 200 ms."
> 4. **Under what conditions?** At what load, in which regions, on what devices?
>
> The result might be: "Search returns results in under 200 ms at p95 when serving
> 10,000 queries per second from EU users." Now it's a requirement: observable,
> testable, and architecturally meaningful.

---

## Middle Questions

**Q6: Walk me through how you'd convert "it should be fast" into a measurable non-functional target.**

> I use a small, repeatable template that turns a vibe into a number:
>
> | Slot | Question to answer | Example |
> |------|--------------------|---------|
> | Operation | What user action? | "Submit checkout" |
> | Metric | Latency, throughput, error rate? | Latency |
> | Statistic | Average or a tail percentile? | p99 |
> | Target | The actual number | < 500 ms |
> | Conditions | Load, region, payload | 5k RPS, US-East |
> | Window | Measured over what period? | Rolling 28 days |
>
> So "it should be fast" becomes: **"Checkout submission completes in under 500 ms
> at p99, sustained at 5,000 requests per second, measured over a rolling 28-day
> window."** I deliberately prefer tail percentiles over averages, because the
> average hides the slow requests that drive the worst user experiences. A p99 of
> 500 ms means *one in a hundred* users waits longer than that — and high-traffic
> systems generate millions of "one in a hundred" events per day.

**Q7: Why do non-functional requirements drive architecture more than functional ones?**

> Because functional requirements can usually be satisfied by *many* architectures,
> while non-functional requirements *eliminate* most of them. "Store a user's
> orders" can be done with a single Postgres table, a sharded cluster, a NoSQL
> store, or a flat file — functionally they're all fine. But add "handle 500,000
> writes per second with 99.99% availability across three regions," and almost
> every simple option is ruled out. The NFRs are the *constraints*; the
> architecture is the *solution to those constraints*. This is why experienced
> designers spend the opening minutes of an interview pinning down scale,
> latency, availability, and consistency before drawing a single box. The shape of
> the answer is determined by the NFRs.
>
> A useful mental model:
>
> ```mermaid
> flowchart LR
>   FR[Functional Requirements] --> S[Feature set: WHAT to build]
>   NFR[Non-Functional Requirements] --> C[Constraints: HOW WELL]
>   S --> D{Design space}
>   C --> D
>   D --> A[Concrete architecture]
>   style NFR fill:#fde,stroke:#c39
>   style C fill:#fde,stroke:#c39
> ```
>
> FRs open the design space; NFRs narrow it to a single viable region.

**Q8: Name the main "-ilities" and how each is measured.**

> The "-ilities" are the standard categories of NFR. Each has a canonical metric:
>
> | -ility | What it means | How it's measured |
> |--------|---------------|-------------------|
> | Scalability | Handle growing load gracefully | Throughput (RPS, QPS) at fixed latency; cost per request as load grows |
> | Availability | Fraction of time the system is usable | Uptime %, "nines" (99.9%, 99.99%) |
> | Reliability | Operates correctly without failure | MTBF, MTTR, error rate, success ratio |
> | Latency / Performance | Responsiveness | p50/p95/p99 response time; throughput |
> | Durability | Data survives failures | Probability of data loss (e.g. 11 nines for object stores) |
> | Maintainability | Ease of change | Lead time for changes, change-failure rate, cyclomatic complexity |
> | Security | Resistance to misuse | Vulnerability counts, time-to-patch, audit findings |
> | Consistency | Agreement of replicas | Staleness window; strong vs eventual model |
> | Observability | Ability to understand internal state | Coverage of logs/metrics/traces; MTTD |
> | Cost-efficiency | Resource economy | $ per request, $ per active user, infra spend |
>
> The skill isn't memorizing the list — it's knowing *which* -ilities matter for
> *this* system and attaching numbers to them. A payments system weights
> consistency and durability; a video CDN weights latency and cost.

**Q9: Explain the difference between SLI, SLO, and SLA. Give an example tying them together.**

> They form a hierarchy from measurement to promise:
> - **SLI (Service Level Indicator)** — the *measured number*. A quantitative
>   signal of behavior. Example: "proportion of HTTP requests served in under
>   300 ms."
> - **SLO (Service Level Objective)** — the *internal target* for an SLI. Example:
>   "99.9% of requests served in under 300 ms over 28 days." It's the goal the
>   team holds itself to.
> - **SLA (Service Level Agreement)** — the *external contract*, usually with
>   financial penalties, that wraps an SLO with a margin of safety. Example: "If
>   monthly availability drops below 99.5%, the customer receives a 10% credit."
>
> The relationship: SLIs are what you *measure*, SLOs are what you *aim for*, SLAs
> are what you *promise customers* (and pay for if you miss). Crucially, the SLA
> is almost always *looser* than the SLO — you set your internal target tighter
> than your contractual one so you have buffer before penalties trigger. The gap
> between SLO and 100% is the **error budget**: the amount of unreliability you're
> allowed to spend on releases, experiments, and risk.

**Q10: What is an error budget and how does it connect availability targets to engineering decisions?**

> An error budget is the *complement* of an availability SLO: if your SLO is
> 99.9% successful requests, your error budget is 0.1% — you may "fail" one
> request in a thousand without breaching the objective. Over a month that's a
> concrete, spendable quantity (≈43 minutes of total downtime at 99.9%).
>
> It connects to decisions because it converts reliability from a moral argument
> ("we should be more careful") into an accounting one. If the budget is healthy,
> the team can ship faster and take risks. If the budget is exhausted, the policy
> is to freeze risky launches and pour effort into reliability until the budget
> refills. It also dissolves the classic dev-vs-SRE tension: both sides agree on
> the number, and the number — not opinion — dictates whether you ship or
> stabilize.

**Q11: How do you elicit non-functional requirements in an interview when the prompt only gives you "design Twitter"?**

> The prompt is intentionally underspecified — surfacing the NFRs *is* the test.
> I drive a short clarification phase across a fixed checklist:
> - **Scale**: How many daily active users? Reads vs writes ratio? Peak QPS?
> - **Latency**: What's an acceptable timeline-load time? p99 budget?
> - **Availability**: Is brief downtime acceptable, or is this tier-1?
> - **Consistency**: Must a posted tweet appear instantly to followers, or is a
>   few seconds of lag fine?
> - **Durability**: Can we ever lose a tweet? (No.)
> - **Cost / footprint**: Are we optimizing for a startup budget or hyperscale?
> - **Compliance**: Data residency, content moderation, retention rules?
>
> I state my assumptions out loud when the interviewer defers ("I'll assume 200M
> DAU, 100:1 read:write, eventual consistency for the timeline"), because that
> shows I know these numbers *change the design* and I'm making them explicit
> rather than hiding them.

---

## Senior Questions

**Q12: Give a worked example of a "quality attribute scenario" and explain why the format matters.**

> A quality attribute scenario is a structured, testable way to specify an NFR. It
> has six parts: **source, stimulus, artifact, environment, response, response
> measure.** Vague NFRs hide ambiguity; this format forces every dimension to be
> named.
>
> Example (availability):
> - **Source**: an external client
> - **Stimulus**: a backend database node crashes
> - **Artifact**: the order-service API
> - **Environment**: normal peak-hour operation
> - **Response**: traffic fails over to a replica; in-flight requests are retried
> - **Response measure**: no customer-visible errors; failover completes within
>   10 seconds; zero committed orders lost
>
> Why it matters: "the system should be highly available" is untestable. The
> scenario above can be turned directly into a chaos-engineering test — kill the
> node, assert failover < 10 s and zero lost orders. It converts an adjective
> into an executable acceptance criterion, and it forces the team to confront the
> *environment* (does this hold during a deploy? during a region outage?) that
> vague NFRs gloss over.

**Q13: Non-functional requirements famously conflict. Walk through the consistency / availability / latency / cost tensions.**

> NFRs are rarely independent; improving one usually taxes another. The major
> tensions:
>
> - **Consistency vs Availability (CAP)**: In a network partition you must choose.
>   A strongly consistent system rejects writes it can't safely replicate
>   (sacrificing availability); an available system accepts them and reconciles
>   later (sacrificing consistency). You can't have both during a partition.
> - **Consistency vs Latency (PACELC)**: Even *without* a partition, enforcing
>   strong consistency means coordinating replicas (quorums, consensus), which
>   adds round-trips and raises latency. Eventual consistency answers from the
>   nearest replica — faster, but possibly stale.
> - **Latency vs Cost**: Lower latency usually means more replicas, more caching,
>   more regions, beefier hardware — all of which cost money. Multi-region active-
>   active gives great latency and availability but can double or triple infra
>   spend.
> - **Durability vs Latency**: Synchronously replicating every write to multiple
>   disks/regions before acknowledging guarantees durability but slows the write
>   path; async replication is faster but risks losing recent writes on failure.
>
> ```mermaid
> flowchart TD
>   subgraph Tradeoff Triangle
>     C[Strong Consistency]
>     A[High Availability]
>     L[Low Latency]
>   end
>   C -.competes with.-> A
>   C -.competes with.-> L
>   A -.competes with.-> COST[Low Cost]
>   L -.competes with.-> COST
> ```
>
> The senior move is not to "win" all of them but to *state which you're
> sacrificing and why* — e.g. "for the social timeline we choose availability and
> low latency over strong consistency, because a few seconds of staleness is
> invisible to users but a 2-second load time is not."

**Q14: Walk through, step by step, how requirement priorities change a design. Use a banking transfer vs a social feed.**

> Same primitive — "user performs an action, others see the result" — but the
> NFR priorities flip the entire architecture.
>
> | Dimension | Bank transfer | Social feed post |
> |-----------|---------------|------------------|
> | Top priority | Correctness, consistency, durability | Availability, latency, scale |
> | Consistency | Strong (ACID, no double-spend) | Eventual (seconds of lag OK) |
> | Data loss tolerance | Zero | Low but non-zero acceptable |
> | Write path | Synchronous, transactional, audited | Async, fire-and-forget, fan-out |
> | Storage | Relational, single source of truth | Denormalized, replicated caches |
> | On partition | Reject the write (CP) | Accept the write (AP) |
>
> Step by step for the **transfer**: the design centers on a transactional store
> with strong isolation, two-phase commit or a saga with compensation, an
> immutable audit log, and idempotency keys to prevent double-charging on retry.
> Latency is secondary — users tolerate a 1-second "processing" spinner if it
> means their money is never wrong.
>
> For the **feed**: the design centers on write fan-out to per-user timeline
> caches, heavy CDN/edge caching, async pipelines, and graceful degradation
> (showing a slightly stale feed beats showing an error). A lost or delayed post
> is recoverable; a 5-second stall loses engagement.
>
> The lesson: identical functional requirements, opposite architectures —
> *because the NFR priorities differ*. This is exactly why eliciting and ranking
> NFRs up front is the highest-leverage step.

**Q15: How do you decide which percentile to target — p50, p95, p99, or p999 — and what's the cost of chasing tail latency?**

> The percentile choice should follow the *blast radius* of a slow request:
> - **p50** tells you the typical experience but hides everyone having a bad day.
>   Rarely a sufficient SLO on its own.
> - **p95 / p99** are the usual SLO targets — they bound the experience for the
>   slow tail without demanding the near-impossible.
> - **p999 / p9999** matter when a single slow request fans out into many. If one
>   page makes 100 backend calls and waits for all of them, the page's latency is
>   governed by the *p99 of the dependencies* — so each dependency effectively
>   needs p999-class behavior for the page to hit p99. This is "tail latency
>   amplification."
>
> The cost of chasing the tail is steep and non-linear: going from p99 to p999
> often means over-provisioning, hedged requests (sending duplicate requests and
> taking the first response), aggressive timeouts, and removing every source of
> variance (GC pauses, cold caches, noisy neighbors). I target the *tightest
> percentile the product actually needs* and resist gold-plating beyond it,
> because each extra "nine" of latency can multiply cost.

**Q16: How do you handle a non-functional requirement that is a hard external constraint — like a compliance mandate — versus one that's a tunable target?**

> I split NFRs into two classes and treat them very differently:
>
> - **Tunable targets** (latency, throughput, cost): these have a *gradient*. I can
>   trade them against each other, relax them under load, and negotiate the number
>   with the business. A 250 ms target vs 300 ms is a discussion.
> - **Hard constraints** (compliance, legal, data residency, contractual SLAs):
>   these are *binary*. "EU user data must stay in EU regions" is not a target you
>   optimize toward 95% — it's a boundary you must not cross, ever. There's no
>   error budget for "we leaked PII 0.1% of the time."
>
> Hard constraints get designed in *first*, because they prune the architecture
> before anything else. Data residency may force region-pinned storage and rule
> out a global single database. PCI-DSS may force network segmentation and tokeni-
> zation that shapes every service touching card data. I treat them as
> non-negotiable invariants and build the tunable optimizations *inside* the box
> they define. Conflating the two — negotiating a legal requirement like a latency
> target — is a classic and dangerous mistake.

---

## Professional / Deep-Dive Questions

**Q17: A stakeholder asks for "99.999% availability." Talk me through what you'd push back on and how you'd reason about the cost.**

> Five nines is ~5.26 minutes of allowed downtime *per year* — including deploys,
> dependency outages, and human error. Before accepting it I'd interrogate three
> things:
>
> 1. **Is it actually needed?** Most products are well served by three or four
>    nines. Five nines is appropriate for payment rails, telephony, core infra —
>    not a typical web app. The cost curve is steep: each additional nine roughly
>    multiplies engineering effort and infra spend. I'd ask what failure actually
>    *costs* per minute and let that justify (or deflate) the target.
> 2. **Availability of what, measured how?** End-to-end user journey, or one
>    service? Measured at the load balancer, or from the client's perspective
>    including their flaky mobile network? The measurement boundary changes
>    everything.
> 3. **Does the dependency chain even allow it?** Availability multiplies across
>    serial dependencies. Five services each at 99.99% in series give
>    0.9999^5 ≈ 99.95% — you can't promise more uptime than your weakest serial
>    path delivers without redundancy at every hop.
>
> The reasoning, made concrete:
>
> | Availability | Downtime / year | Downtime / month | Typical use |
> |--------------|-----------------|------------------|-------------|
> | 99% | 3.65 days | 7.2 hours | Internal tools |
> | 99.9% | 8.77 hours | 43.8 minutes | Standard SaaS |
> | 99.99% | 52.6 minutes | 4.38 minutes | Business-critical |
> | 99.999% | 5.26 minutes | 26 seconds | Payments, telco |
>
> My pushback isn't "no" — it's "let's price it." Often the stakeholder discovers
> 99.95% meets the business need at a fraction of the cost, and the conversation
> shifts from an arbitrary number to an informed trade-off.

**Q18: How does availability compose across architecture, and how do you raise it without buying more nines per component?**

> Availability composes by *topology*:
> - **Serial dependencies multiply**: if A calls B calls C, overall ≈ A×B×C.
>   More hops in series → lower combined availability. This is why deep call
>   chains are fragile.
> - **Redundant (parallel) components add reliability**: two independent replicas
>   each at 99% give 1 − (0.01 × 0.01) = 99.99% *if* they fail independently.
>
> So instead of buying a more reliable single component, I add *redundancy* and
> *isolation*:
> - **Replication and failover** turn one 99.9% node into a 99.99%+ cluster.
> - **Bulkheads** stop one failing dependency from sinking the whole system.
> - **Circuit breakers + graceful degradation** let the system shed a failing
>   non-critical dependency rather than fail the whole request.
> - **Removing synchronous dependencies** — making a call async or cached — takes
>   it off the critical availability path entirely.
>
> The deeper point: the cheapest way to raise availability is usually *not* a
> better component but a *better architecture* — fewer things in series, more
> things in parallel, and the assumption that everything fails.

**Q19: Some non-functional requirements are hard to test before launch — scalability, resilience under failure. How do you validate them?**

> I refuse to let "untestable until prod" be an excuse, and I build validation in
> layers:
> - **Load and stress testing**: synthetic traffic at and beyond target QPS to
>   confirm throughput and latency budgets hold, and to find the breaking point.
> - **Soak testing**: sustained load over hours/days to surface leaks, slow
>   resource exhaustion, and degradation that a short test misses.
> - **Chaos engineering**: deliberately injecting failures (kill nodes, add
>   latency, partition the network) in staging or controlled prod to verify that
>   the failover and degradation NFRs actually hold. The quality-attribute
>   scenario from Q12 becomes the chaos test.
> - **Game days**: rehearsed failure drills with the on-call team to validate not
>   just the system but the human runbook and MTTR.
> - **Production SLO monitoring**: the ultimate validation. SLIs measured live, so
>   the system is continuously *proving* its NFRs rather than asserting them once.
>
> The mindset shift is treating NFRs as *continuously verified properties*, not
> one-time checkboxes. A scalability requirement isn't "done" — it's a number a
> dashboard watches forever.

**Q20: How do non-functional requirements evolve over a system's lifetime, and how do you design so they can be tightened later without a rewrite?**

> NFRs are not static. A startup's "1,000 users, eventual consistency is fine"
> becomes "10 million users, regulators now require an audit trail, enterprise
> customers demand a 99.95% SLA." If the original design baked the loose
> assumptions into its bones, tightening them means a rewrite.
>
> To design for evolution:
> - **Make NFR-sensitive choices replaceable.** Hide the cache, the queue, the
>   datastore behind interfaces so the *implementation* can move from single-node
>   to distributed without touching business logic.
> - **Instrument from day one.** You can't tighten what you don't measure. Even at
>   small scale, ship SLIs so the future conversation is data-driven.
> - **Leave headroom in the data model.** Idempotency keys, version columns, and
>   event logs are cheap to add early and brutally expensive to retrofit; they're
>   the hooks that let you later add stronger consistency or audit guarantees.
> - **Separate the stateless from the stateful.** Stateless services scale by
>   adding boxes; the hard scaling problems live in state. Designing for stateless
>   compute early keeps the costly rework confined to the data tier.
>
> I explicitly ask which NFRs are *likely to tighten* and invest in flexibility
> there, while keeping the parts that won't change simple. Over-engineering for
> scale you may never reach is as much a failure as ignoring it.

**Q21: When two non-functional requirements directly conflict and the business won't pick, how do you force a decision?**

> I make the trade-off *visible and costed* so the choice can't stay abstract:
> 1. **Quantify both sides.** "Strong consistency adds ~40 ms p99 and caps us at
>    20k writes/sec; eventual consistency hits our latency target but means a
>    follower can see stale data for up to 3 seconds." Now it's numbers, not
>    adjectives.
> 2. **Tie each to a business outcome.** Stale data here means a user might see a
>    deleted comment for 3 seconds — annoying but harmless. Versus: a 40 ms
>    slowdown measurably drops conversion by X%. The business *can* rank those.
> 3. **Find the asymmetry.** Most conflicts aren't symmetric — one side has a
>    cheap mitigation (read-your-own-writes for the author, eventual for everyone
>    else) that captures most of the value of both. The senior answer is often
>    "neither extreme — segment the requirement by use case."
> 4. **Default to reversible.** If the business genuinely can't decide, I pick the
>    option that's cheaper to *change later* and revisit when data arrives.
>
> The anti-pattern is the engineer silently picking one and hiding the trade-off.
> Surfacing it — ideally with a one-line decision record — is the professional
> move.

---

## Staff / Judgment Questions

**Q22: You inherit a system whose NFRs were never written down. How do you reverse-engineer them, and what do you do with what you find?**

> Undocumented NFRs still *exist* — they're just implicit in the code,
> infrastructure, and incident history. I reconstruct them archaeologically:
> - **Read the production telemetry.** What latency, error rate, and throughput is
>   the system *actually* delivering? That's the de facto SLI, and the org has
>   tacitly accepted it.
> - **Mine the incident history.** Postmortems reveal which failures the business
>   considered unacceptable (the ones that triggered all-hands) versus tolerable.
>   That's the real, lived availability and durability requirement.
> - **Read the contracts and the alerting config.** SLAs, paging thresholds, and
>   auto-scaling triggers encode the numbers someone once cared about.
> - **Interview the on-call engineers.** They carry the unwritten NFRs in their
>   heads — "we can never let the queue back up past X" — that no document holds.
>
> Then I *write them down* and socialize them, because the act of making them
> explicit is the value: it converts tribal knowledge into an agreed contract,
> exposes the places where reality has silently drifted below what the business
> assumes, and creates the baseline against which future changes are judged.
> Reverse-engineering NFRs is often the highest-leverage thing you can do on a
> legacy system.

**Q23: How do you push back when a team treats every NFR as "must-have," and how do you prioritize when you can't satisfy them all within budget?**

> "Everything is critical" is the same as "nothing is prioritized," and it
> reliably produces an over-engineered, over-budget system that's still wrong in
> the places that matter. My approach:
> 1. **Force a ranking, not a label.** Instead of must/should/nice, I make the
>    team *order* the NFRs against each other: if you could only nail one of
>    {latency, cost, consistency}, which? The forced ranking exposes the real
>    priorities that flat labels hide.
> 2. **Anchor to business impact and failure cost.** An NFR is only "critical" if
>    missing it causes proportionate business harm. We quantify: what does a
>    breach, an extra 100 ms, or a 4-hour outage actually cost? Numbers deflate
>    inflated priorities fast.
> 3. **Expose the budget as a constraint, not a surprise.** Show the team the
>    cost of the full NFR wishlist versus the budget. When five-nines and global
>    low latency together blow the budget 3×, the team self-selects what truly
>    matters.
> 4. **Use "good enough" thresholds.** Many NFRs have a knee in the curve beyond
>    which more investment yields nothing the user notices. I target the knee, not
>    the asymptote.
>
> The staff-level skill is comfort with *deliberately under-delivering* on the
> NFRs that don't move the business, so the budget concentrates on the ones that
> do.

**Q24: Compliance is sometimes framed as "just another NFR." Argue for or against, and explain how a hard regulatory constraint should shape the architecture differently from a performance NFR.**

> I argue *against* flattening compliance into "just another NFR," while
> acknowledging it lives in the NFR family. The difference is in *kind*, not
> degree:
>
> - **Performance NFRs are continuous and negotiable.** 280 ms instead of 250 ms
>   is a degraded-but-acceptable state; you can ship it and tighten later. They
>   have error budgets — you're *allowed* to miss them sometimes.
> - **Regulatory constraints are binary and non-negotiable.** "PII of EU residents
>   must not leave the EU" has no error budget. Crossing it once is a reportable
>   breach with legal and financial consequences. There is no "99.9% compliant."
>
> Architecturally this means compliance is designed *first* and as an *invariant*,
> not optimized toward. Concretely, a data-residency mandate may:
> - Force *region-pinned* storage and rule out a single global database — a
>   structural decision that constrains every later choice.
> - Require data-flow controls and tokenization so PII never transits a
>   non-compliant service, shaping service boundaries themselves.
> - Demand immutable audit logs and retention/erasure (right-to-be-forgotten)
>   machinery as first-class components, not bolt-ons.
> - Make some otherwise-attractive optimizations (a global cache, a third-party
>   analytics SDK) simply illegal regardless of their performance benefit.
>
> So while I'll *catalog* compliance alongside the other -ilities, I treat it as a
> different *class*: a boundary the design must live inside, established before any
> performance or cost tuning begins. Treating a legal constraint like a tunable
> latency target is how teams build fast systems that get shut down by regulators.

---

## Quick-Reference Tables

A compact cheat sheet for the opening minutes of a design interview.

**FR vs NFR at a glance:**

| | Functional Requirement | Non-Functional Requirement |
|---|------------------------|----------------------------|
| Question | What does it *do*? | How *well* does it do it? |
| Example | "User can place an order" | "Order confirms in < 1 s at p99" |
| Verification | Pass/fail behavior test | Measured against a numeric threshold |
| Drives | Feature set, scope | Architecture, infrastructure, cost |
| When elicited | Stated in the prompt | Usually must be *surfaced* by you |
| Failure looks like | Missing feature | Outage, slowness, breach, cost blowout |

**SLI / SLO / SLA hierarchy:**

| Term | What it is | Audience | Example |
|------|-----------|----------|---------|
| SLI | A measured signal | Engineering | % requests < 300 ms |
| SLO | Internal target on an SLI | Engineering | 99.9% < 300 ms / 28 days |
| SLA | External contractual promise | Customer / legal | 99.5% or 10% credit |
| Error budget | 100% − SLO | Both | 0.1% allowed failures |

**The major NFR conflicts:**

| Tension | Why they fight | Common resolution |
|---------|----------------|-------------------|
| Consistency vs Availability | CAP: must choose during partition | Pick CP or AP per use case |
| Consistency vs Latency | Coordination adds round-trips | Eventual reads, strong where it matters |
| Latency vs Cost | Low latency needs more infra | Cache + target the percentile that matters |
| Durability vs Latency | Sync replication slows writes | Tunable write concern per data class |

The throughline across every question above: **functional requirements tell you
what to build; non-functional requirements tell you whether what you built is
actually worth using — and they are what your architecture is really a solution
to.** Surface them early, attach numbers, rank them honestly, and name your
trade-offs out loud.

*Next step:* [Key Characteristics](../04-key-characteristics/junior.md)
