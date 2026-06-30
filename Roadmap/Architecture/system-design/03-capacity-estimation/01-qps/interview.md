# QPS (Queries Per Second) — Interview Questions

A focused interview drill on **QPS estimation**: how to turn a product description into a defensible number of queries per second, propagate it through fan-out, and convert it into concurrency, instances, and cost. Every answer shows the arithmetic, because in a real interview the number matters less than whether the interviewer can follow how you got there.

The golden rule that threads through every answer below: **you size for the peak second, not the average second.** A system that is comfortable at the daily mean and underwater at the dinner-time spike is a system that pages someone at 7 p.m.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Staff / Judgment Questions](#staff--judgment-questions)
6. [Reference: Numbers Worth Memorizing](#reference-numbers-worth-memorizing)

---

## Junior Questions

**Q1: What is QPS, and how is it different from RPS, TPS, and throughput?**

> **QPS** (Queries Per Second) is the rate at which a system receives discrete units of work — one query, one read, one lookup — measured per second. The terms you'll hear:
>
> | Term | Stands for | Typical unit of work |
> |------|-----------|----------------------|
> | QPS | Queries Per Second | A read/lookup against a service or datastore |
> | RPS | Requests Per Second | An HTTP request hitting a server |
> | TPS | Transactions Per Second | A write that must be durable/atomic (often DB) |
> | Throughput | — | Generic "work units per second", any layer |
>
> In casual system-design conversation **QPS and RPS are used interchangeably** — both mean "requests per second arriving at a tier." The distinction that *does* matter is **TPS**, because a transaction usually implies a durable write, which is far more expensive than a read. If an interviewer says "QPS" and you silently treat every query as a write, your hardware estimate will be 5–10× too large. Always pin down: is this a read or a write?

**Q2: A service handles 1 million requests per day, spread evenly. What is its average QPS?**

> A day has `24 × 60 × 60 = 86,400` seconds. The number to memorize is **~100,000 seconds per day** (86,400 rounded up — it makes mental math trivial and is conservative).
>
> ```
> Average QPS = 1,000,000 requests / 86,400 s ≈ 11.6 QPS
> ```
>
> Using the rounded `100,000 s/day`: `1,000,000 / 100,000 = 10 QPS`. So **roughly 10–12 QPS**. The rounding gives you a clean answer that's slightly conservative — exactly what you want when sizing.
>
> The reusable shortcut: **1 million/day ≈ 12 QPS**, and therefore **1 billion/day ≈ 12,000 QPS**. Memorize that pair and you can do most daily-volume conversions in your head.

**Q3: What is the difference between average QPS and peak QPS, and why can't you provision for the average?**

> **Average QPS** smears all the day's traffic evenly across 86,400 seconds. **Peak QPS** is the rate during the busiest second of the day — typically a daily spike (morning commute, lunch, evening prime time).
>
> Real traffic is never flat. A consumer app might do most of its volume in a few peak hours, so the busiest second can be **2–10× the daily average**. If you provision only for the average, the system is overloaded for the entire peak window — exactly when the most users are watching.
>
> The fix is a **peak multiplier**: `Peak QPS = Average QPS × peak_factor`. A safe default when you have no data is **×2 to ×3** for a smooth global service, and **×5 or higher** for a spiky, single-timezone consumer app. Always state your multiplier out loud; the interviewer cares more about *that you applied one* than its exact value.

**Q4: A read-heavy app does 100 reads for every 1 write. If total QPS is 50,500, split it.**

> The read:write ratio is **100:1**, so out of every 101 requests, 100 are reads and 1 is a write.
>
> ```
> Writes = 50,500 × (1 / 101) = 500 write QPS
> Reads  = 50,500 × (100 / 101) = 50,000 read QPS
> ```
>
> This split is the single most important early move in capacity estimation, because reads and writes go to different places and cost differently. The 50,000 read QPS is a candidate for **caching and read replicas**; the 500 write QPS sets the load on your **primary database** and your write path's durability budget. Most consumer systems are read-heavy (often 10:1 to 1000:1), which is why "add a cache, add read replicas" is such a common answer.

**Q5: Why do we round 86,400 seconds to 100,000 in back-of-the-envelope math?**

> Three reasons. First, **mental arithmetic**: dividing by 100,000 (or 10⁵) is just shifting the decimal, while dividing by 86,400 is not something you want to do under interview pressure. Second, **conservatism**: 100,000 > 86,400, so dividing by the larger number gives a slightly *lower* average QPS per request — which means if anything you'll provision a hair generously when you later multiply by peak factor. Third, **precision is fake here anyway**: your DAU and per-user request counts are guesses with ±50% error bars, so chasing the 13,600-second difference is false precision. Round aggressively, be transparent that you rounded, and spend your effort on the multipliers that actually move the answer.

---

## Middle Questions

**Q6: Walk me through the DAU → QPS formula end to end.**

> The canonical chain converts a user-facing number (daily active users) into a machine-facing number (peak QPS):
>
> ```
> 1. Requests/day   = DAU × actions_per_user_per_day
> 2. Average QPS    = Requests/day / 86,400          (use 100,000 to round)
> 3. Peak QPS       = Average QPS × peak_factor       (×2 … ×10)
> ```
>
> Worked example: 10M DAU, each user makes 20 requests/day, peak factor ×3.
>
> ```
> Requests/day = 10,000,000 × 20 = 200,000,000 req/day
> Average QPS  = 200,000,000 / 100,000 = 2,000 QPS
> Peak QPS     = 2,000 × 3 = 6,000 QPS
> ```
>
> Each line has exactly one assumption you should defend: `actions_per_user` (product behavior), the seconds rounding (mechanical), and `peak_factor` (traffic shape). Name all three, give a number to each, and the interviewer can follow — and challenge — your reasoning precisely.

**Q7: What is request fan-out, and how does it create a gap between external and internal QPS?**

> **External QPS** is what arrives at your edge (load balancer / API gateway) from clients. **Internal QPS** is the total work generated *inside* your system as that one external request triggers downstream calls. One user request rarely maps to one backend operation.
>
> Example: a single "load home feed" request might internally do: 1 auth check, 1 feed-ranking call, 1 fan-out to 5 microservices, and each of those issues 3 database/cache reads.
>
> ```mermaid
> sequenceDiagram
>     participant C as Client (1 req)
>     participant GW as API Gateway
>     participant FS as Feed Service
>     participant R as Ranking
>     participant DB as Datastore (cache+DB)
>     C->>GW: GET /home   (1 external request)
>     GW->>FS: getFeed     (1)
>     FS->>R: rank()       (1)
>     FS->>DB: read x 5 services × 3 reads (15)
>     R->>DB: read x 4     (4)
>     DB-->>FS: results
>     FS-->>GW: feed
>     GW-->>C: 200 OK
>     Note over C,DB: 1 external req → ~21 internal ops (fan-out ≈ 21×)
> ```
>
> So if external traffic is 6,000 QPS and the average fan-out to the datastore is ~21×, the **datastore sees ~126,000 internal QPS**. The trap candidates fall into is sizing the database off the *external* number. Always ask "how many internal operations per external request?" and carry that multiplier through to each downstream tier.

**Q8: Estimate the QPS for a URL shortener like bit.ly. Walk through reads and writes separately.**

> State assumptions first. Say **100M new short URLs created per month**, and a **100:1 read:write ratio** (links are clicked far more than created).
>
> **Writes (create):**
> ```
> 100,000,000 / month ÷ 30 days ≈ 3,333,333 / day
> Average write QPS = 3,333,333 / 100,000 ≈ 33 QPS
> Peak write QPS    = 33 × 3 ≈ 100 QPS
> ```
>
> **Reads (redirect):**
> ```
> Reads/day = writes/day × 100 = 333,333,333 / day
> Average read QPS = 333,333,333 / 100,000 ≈ 3,333 QPS
> Peak read QPS    = 3,333 × 3 ≈ 10,000 QPS
> ```
>
> Conclusion: ~**100 write QPS, ~10,000 read QPS at peak**. That immediately shapes the design: writes are tiny (a single primary DB handles them comfortably), reads are 100× heavier and dominated by a key→URL lookup that's a perfect fit for a cache. This is why URL shorteners are textbook "cache + read replica" problems — the QPS split tells you so before you've drawn a single box.

**Q9: How does Little's Law turn QPS and latency into a concurrency number?**

> **Little's Law**: `L = λ × W`, where `L` is the average number of requests *in the system concurrently*, `λ` is the arrival rate (QPS), and `W` is the average time a request spends in the system (latency, in seconds).
>
> This is how you go from "6,000 QPS" to "how many threads / connections / in-flight requests do I need?"
>
> ```
> λ = 6,000 QPS
> W = 50 ms = 0.05 s
> L = 6,000 × 0.05 = 300 concurrent requests in flight
> ```
>
> So at any instant ~300 requests are being processed. That number sizes your **thread pool, async slots, or DB connection pool**. If each request holds one DB connection for its full 50 ms, you need ~300 connections across the fleet at peak. Little's Law is the bridge between the *rate* world (QPS) and the *resource* world (pools, threads, memory), and it's parameter-free — no assumptions about distribution, just steady-state.

**Q10: Why does higher latency increase the resources needed even at constant QPS?**

> Because Little's Law makes concurrency the product of *both* rate and latency: `L = λ × W`. Hold QPS fixed and double the latency, and you double the number of in-flight requests — each one occupies a thread, a connection, and some memory for longer.
>
> ```
> Constant 6,000 QPS:
>   W = 50 ms  → L = 6,000 × 0.050 = 300 concurrent
>   W = 200 ms → L = 6,000 × 0.200 = 1,200 concurrent (4×)
> ```
>
> This is why a slow downstream dependency is so dangerous: it doesn't reduce your QPS, but it inflates concurrency, exhausts your connection pool, and causes requests to queue — which raises latency further, which raises concurrency further. The feedback loop is how a small latency regression cascades into a full outage. The lesson for capacity work: **never quote a concurrency number without quoting the latency you assumed.**

---

## Senior Questions

**Q11: Convert peak QPS to an instance count. Show the headroom math.**

> Two inputs: peak QPS and per-instance capacity (how much one server can safely sustain). Then divide and add headroom.
>
> Suppose peak is **6,000 QPS** and benchmarking shows one instance handles **800 QPS at acceptable latency**.
>
> ```
> Raw instances = 6,000 / 800 = 7.5 → 8 instances
> ```
>
> But 8 is the number where you're running at 100% — there's no slack for traffic spikes above peak, deploys, or instance failure. Apply a **utilization target of ~70%** so each instance is doing 800 × 0.70 = 560 effective QPS:
>
> ```
> Sized instances = 6,000 / 560 ≈ 10.7 → 11 instances
> ```
>
> Then add **redundancy for failure** (survive losing 1–2 instances or an AZ). With 3 availability zones and "survive one AZ loss," you provision so that 2/3 of capacity ≥ peak: `11 / (2/3) ≈ 17 instances`, ~6 per AZ. Final answer: **~11 for load + headroom, ~17 for AZ-failure tolerance.** The interviewer wants to see all three multipliers (utilization, redundancy, peak) named explicitly.

**Q12: Why do you size for the peak second specifically, and not the peak hour or the daily mean?**

> Because **overload is instantaneous, not amortized.** A server's queue fills up in the second that arrivals exceed service rate; it doesn't care that the *hour's* average was fine. If your busiest second is 6,000 QPS but you provisioned for the hourly mean of 3,000 QPS, then during that second 3,000 requests/s have nowhere to go — they queue, latency spikes, timeouts fire, and clients retry (adding *more* load). The damage is done in real time.
>
> The hierarchy of conservatism:
>
> | Sizing basis | What it protects against | Risk |
> |--------------|--------------------------|------|
> | Daily mean | Nothing real | Overloaded all peak |
> | Peak hour (avg) | Sustained busy periods | Still overloaded at the spike-second |
> | **Peak second** | The actual worst instant | Correct baseline |
> | Peak second × surge | Flash events, retries | Costs more; sometimes warranted |
>
> You size for the peak *second* because that's the granularity at which queues overflow. Then you decide separately whether to also buffer for *super*-peak surge events (launches, news spikes) via autoscaling or a surge multiplier.

**Q13: Explain the utilization-vs-latency cliff and the 70% rule.**

> Queueing theory (M/M/1 as the intuition pump) says the average wait in a queue grows with `1 / (1 − ρ)`, where `ρ` is utilization. This is non-linear: latency is mild up to moderate utilization, then explodes as ρ → 1.
>
> | Utilization ρ | Queue-delay factor `1/(1−ρ)` | Feel |
> |---------------|------------------------------|------|
> | 50% | 2× | comfortable |
> | 70% | 3.3× | healthy ceiling |
> | 90% | 10× | latency climbing fast |
> | 95% | 20× | tail latency on fire |
> | 99% | 100× | effectively down |
>
> Going from 70% to 90% utilization saves you ~22% of hardware but **triples** queueing delay; from 90% to 99% the delay grows 10× more. That's the cliff. The practical rule: **target ~70% steady-state utilization** at peak so there's headroom to absorb bursts, retries, and a failed node without falling off the cliff. This is *why* the headroom factor in Q11 exists — it's not arbitrary padding, it's keeping you on the flat part of the curve.

**Q14: At what QPS does the design force a cache, a read replica, or a shard? Give thresholds.**

> There are no universal constants, but there are well-worn order-of-magnitude triggers. The driver is almost always the **read** number, because reads dominate and are the cheapest to offload.
>
> | Symptom (per primary node) | Typical trigger | Standard remedy |
> |----------------------------|-----------------|-----------------|
> | Read QPS exceeds single-node serving rate | ~thousands–10k QPS of hot reads | **Cache** (Redis/Memcached) the hot keys |
> | Reads still saturate after caching | cache miss + cold reads grow | **Read replicas** to fan out read load |
> | Write QPS exceeds single-primary capacity | ~thousands of write TPS, or write-IO bound | **Shard** (horizontal partition) the writes |
> | Working set exceeds one machine's RAM/disk | dataset bigger than one node | **Shard** for storage, not just QPS |
>
> The decision order is deliberate: **cache first** (cheapest, helps reads instantly), **replicas next** (scales reads, single write point), **shard last** (scales writes and storage, but adds cross-shard query pain and resharding cost). A senior answer ties each move to the specific QPS or data-size number that justified it — "reads are 50k QPS and 95% hit a hot 1% of keys, so a cache absorbs them; writes are only 500 QPS so a single primary is fine, no sharding yet."

**Q15: Your read:write ratio is 1000:1 and reads are 200,000 QPS. Size the read tier.**

> First confirm the split. At 1000:1, writes are `200,000 / 1000 = 200 write QPS` — trivial, one primary handles it. The whole problem is the **200,000 read QPS**.
>
> Step 1 — cache absorbs the hot set. Assume 90% cache hit rate:
> ```
> Cache reads = 200,000 × 0.90 = 180,000 QPS  → served from cache tier
> DB reads    = 200,000 × 0.10 =  20,000 QPS  → must hit replicas
> ```
>
> Step 2 — size the cache tier. If a Redis node serves ~100,000 ops/s safely, then `180,000 / 100,000 ≈ 2` nodes for load, plus replicas for HA → ~4–6 nodes.
>
> Step 3 — size read replicas. If a replica serves ~5,000 read QPS at acceptable latency: `20,000 / 5,000 = 4 replicas`, apply 70% utilization → `20,000 / (5,000 × 0.7) ≈ 6 replicas`.
>
> The takeaway is structural: **caching collapsed a 200k-QPS problem into a 20k-QPS problem**, and the cache hit rate is the most leverage-heavy assumption in the whole estimate. A 90% → 95% improvement halves the DB-facing load (20k → 10k QPS). That's why cache-hit-rate is the first number a senior defends in a read-heavy design.

---

## Professional / Deep-Dive Questions

**Q16: Estimate Twitter-style timeline reads end to end, including fan-out, and decide where it forces a design change.**

> **Assumptions (state them):** 200M DAU; each user opens the app and refreshes their home timeline ~10 times/day; each refresh is one read request. We'll also account for the write side (tweets posted).
>
> **External read QPS:**
> ```
> Timeline reads/day = 200,000,000 × 10 = 2,000,000,000 (2B) /day
> Average read QPS   = 2,000,000,000 / 100,000 = 20,000 QPS
> Peak read QPS      = 20,000 × 3 = 60,000 QPS
> ```
>
> **Write QPS (tweets posted):** say each user posts ~0.5 tweets/day on average:
> ```
> Tweets/day  = 200,000,000 × 0.5 = 100,000,000 /day
> Average write QPS = 100,000,000 / 100,000 = 1,000 QPS
> Peak write QPS    = 1,000 × 3 = 3,000 QPS
> ```
>
> **The fan-out decision.** A timeline read can be served two ways:
>
> | Strategy | When a tweet is posted | When a timeline is read | Cost concentrated on |
> |----------|------------------------|--------------------------|----------------------|
> | Fan-out on write (push) | Write to every follower's timeline | Just read your precomputed timeline | Writes (1 tweet → N follower writes) |
> | Fan-out on read (pull) | Just store the tweet | Gather + merge from everyone you follow | Reads (1 read → M followed-author fetches) |
>
> Fan-out-on-write turns the cheap 3,000-write-QPS stream into a huge internal write amplification: a celebrity with 50M followers means one tweet → 50M timeline writes. Fan-out-on-read keeps writes cheap but makes the 60,000-QPS read path do heavy merging. The production answer is **hybrid**: fan-out-on-write for normal users (most reads become a single cheap lookup) and fan-out-on-read for celebrities (avoid the write storm), merged at read time. The QPS numbers — cheap writes, dominant reads, pathological fan-out at the tail — are exactly what drives this hybrid.

**Q17: Walk through connection-pool sizing for a DB tier from QPS, using Little's Law and queueing limits.**

> Goal: how many DB connections does the app fleet need at peak, and how does that interact with the DB's own limits?
>
> **Step 1 — concurrency via Little's Law.** Peak DB QPS = 20,000; average query latency (including network) = 2 ms = 0.002 s:
> ```
> L = λ × W = 20,000 × 0.002 = 40 concurrent queries in flight
> ```
>
> So at steady state only ~40 connections are *actively executing*. But you need slack for latency variance and bursts, so size the pool above the mean concurrency — say 2–3× → ~100–120 connections at peak across the fleet.
>
> **Step 2 — the counterintuitive part.** More connections is *not* better. A database with C cores can only truly execute ~`cores × (1 + disk_wait/cpu_time)` queries in parallel; beyond that, extra connections just add context-switching and lock contention, raising latency for everyone. PostgreSQL on 8 cores often performs best at a few dozen connections, not hundreds. So you put a **pooler (PgBouncer / HikariCP)** in front: thousands of app threads multiplex onto a small, bounded set of real DB connections.
>
> **Step 3 — reconcile.** If Little's Law says 40 active and the DB is happiest at ~50 connections, then the pooler's max should be ~50–100, and any app concurrency beyond that *queues at the pooler* (cheap) rather than overwhelming the DB (catastrophic). The QPS → concurrency → pool-size chain is the whole point: it tells you the pool's *floor* (Little's Law) and the DB's hardware tells you its *ceiling*, and the pool max lives between them.

**Q18: How do you forecast QPS growth and translate it into capacity cost over a planning horizon?**

> Treat growth as compounding. If current peak is **6,000 QPS** and traffic grows **8% month-over-month**, project forward with `QPS(t) = QPS₀ × (1 + r)^t`:
>
> ```
> Monthly rate r = 0.08
> 6 months:  6,000 × 1.08^6  = 6,000 × 1.587 ≈ 9,500 QPS
> 12 months: 6,000 × 1.08^12 = 6,000 × 2.518 ≈ 15,100 QPS  (~2.5× in a year)
> ```
>
> A handy mental shortcut is the **rule of 72**: at 8%/month, traffic *doubles* every `72 / 8 = 9` months.
>
> Translate to instances using Q11's per-instance capacity. With 560 effective QPS/instance and 70% utilization:
>
> | Horizon | Peak QPS | Instances (load) | Relative cost |
> |---------|----------|------------------|---------------|
> | Now | 6,000 | ~11 | 1.0× |
> | +6 mo | ~9,500 | ~17 | ~1.5× |
> | +12 mo | ~15,100 | ~27 | ~2.5× |
>
> Cost scales roughly **linearly with peak QPS** for stateless tiers (more instances), but **super-linearly for stateful tiers** once you cross a sharding boundary (resharding is operational work, not just more boxes). So the forecast does two jobs: (1) tells finance the run-rate trajectory, and (2) flags *when* you'll cross an architectural cliff — e.g. "writes hit single-primary capacity in ~8 months, so plan sharding now, not when it's on fire."

**Q19: External QPS is 10,000 but the database is melting at 400,000 QPS. Diagnose using fan-out and amplification.**

> The 40× gap between external (10k) and internal (400k) DB QPS is the symptom; the cause is **read amplification in the request path**. Decompose where the 400k comes from:
>
> ```
> Per external request, the DB sees:
>   - N+1 query pattern: 1 list query + 30 per-item queries  = 31
>   - permission check per item                              = +30
>   - no caching, so repeated identical lookups              = ×(1/hit_rate)
> Effective fan-out ≈ 40× → 10,000 × 40 = 400,000 DB QPS
> ```
>
> Three orthogonal fixes, each attacking a different multiplier:
>
> | Fix | Multiplier it kills | Effect on 400k |
> |-----|--------------------|-----------------|
> | Batch the N+1 (one `IN (...)` query) | 31 → 2 | ~26k QPS |
> | Cache hot reads at 90% hit | ×10 → ×1 | divides remainder by ~10 |
> | Denormalize permission into the row | +30 → 0 | removes the per-item check |
>
> The principle: **you don't always scale the database; you often scale the fan-out down.** The cheapest 400k → 10k reduction is fixing the N+1 in application code, which costs nothing in hardware. A senior reaches for amplification analysis *before* reaching for more replicas — verify the internal QPS is real load and not self-inflicted before you spend money on it.

**Q20: How do retries and timeouts inflate effective QPS, and how do you keep that from becoming a death spiral?**

> Every retry is *additional* QPS the system must serve. If clients retry up to 3 times on failure, then under partial failure your effective load can be `1 + retries` times nominal:
>
> ```
> Nominal peak           = 6,000 QPS
> 20% of requests failing, each retried twice:
>   extra load = 6,000 × 0.20 × 2 = 2,400 QPS
> Effective load = 6,000 + 2,400 = 8,400 QPS  (+40%)
> ```
>
> This is the **retry storm / metastable failure** mechanism: the system slows → more requests time out → clients retry → load rises → system slows further. The extra QPS appears *exactly when you have the least capacity to serve it*, so a system that's fine at 100% nominal can collapse when a 40% retry surcharge lands on top.
>
> Defenses, all of which cap the effective-QPS multiplier:
> - **Exponential backoff + jitter** — spreads retries out instead of synchronizing them into a thundering herd.
> - **Retry budgets / token buckets** — cap retries to e.g. 10% of base traffic, so the multiplier can never exceed 1.1×.
> - **Circuit breakers** — stop sending to a failing dependency entirely, cutting the amplification at the source.
> - **Load shedding** — reject early (cheap 429) rather than accept work you can't finish, keeping goodput high.
>
> The capacity-estimation lesson: when sizing for peak, **add a retry-surcharge headroom** (the same family as the 70% utilization rule), because nominal peak is not the true peak under failure.

---

## Staff / Judgment Questions

**Q21: An interviewer challenges "your DAU is just made up." How do you defend an estimate built on guesses?**

> You don't defend the *inputs* as facts — you defend the *method* and the *bounds*. The move is to make the estimate's sensitivity explicit:
>
> 1. **State the input as a range, not a point.** "DAU is somewhere between 5M and 20M; I'll carry 10M and show you what changes if I'm 2× off."
> 2. **Identify which assumption dominates.** In a QPS estimate, the answer is usually most sensitive to `actions_per_user` and `peak_factor`, and least sensitive to the seconds rounding. So I'd say: "If DAU is 2× higher, peak QPS is 2× higher and I need ~2× instances — linear, easy to absorb with autoscaling. But if the peak factor is ×6 instead of ×3, that *also* doubles peak, and the two compound."
> 3. **Anchor to a known reference where possible.** "This is roughly Reddit-scale; their public numbers put us in the right order of magnitude."
> 4. **Decide what the number is *for*.** A capacity estimate exists to answer "single box or fleet? cache or no cache? shard now or later?" Those are order-of-magnitude decisions. Being off by 2× rarely flips them; being off by 100× does. So I optimize the estimate for *getting the order of magnitude right*, not the leading digits.
>
> The senior signal is treating estimation as **decision-making under uncertainty**, with the error bars in view, rather than pretending the inputs are precise.

**Q22: When is precise QPS estimation a waste of time, and when is it load-bearing?**

> Estimation is **load-bearing** when the number sits near an *architectural threshold* — a point where the design qualitatively changes. Examples: deciding single-primary vs. sharded (cross the write-capacity line and the system is a different beast); deciding whether a tier fits one region or needs global distribution; sizing a fixed-capacity resource you can't quickly grow (a Kafka cluster, a provisioned DB). Here a 2× error can mean a re-architecture, so the estimate earns careful work.
>
> Estimation is a **waste of time** when:
> - The tier is **elastically autoscaled** and stateless — you'll find the real number in production within hours, and being wrong just means the autoscaler adds boxes. Don't agonize over the starting count.
> - You're **far from any threshold** — if the honest estimate is "~50 QPS" and a single node does 5,000, the exact value is irrelevant; the answer is "one box, done."
> - The **input uncertainty dwarfs the math** — if you genuinely have no idea whether DAU is 100k or 10M, refining 86,400 vs 100,000 is theater.
>
> The judgment: spend estimation effort **proportional to the cost of being wrong and the difficulty of correcting it later.** Cheap-to-change, far-from-threshold → estimate loosely and move on. Expensive-to-change, near-threshold → estimate carefully and stress-test the assumptions.

**Q23: You have headroom to either cut p99 latency in half or add 50% more capacity for the same cost. Which, and how does QPS reasoning decide it?**

> It depends on *why* you have headroom pressure, and Little's Law makes the trade quantitative. Recall `L = λ × W`: concurrency (and therefore connection/thread/memory pressure) is the product of QPS and latency.
>
> - **If the bottleneck is concurrency/resource exhaustion** (pools saturating, memory from in-flight requests, downstream connection limits), then **halving latency halves L for free** — same QPS, half the in-flight requests, which is equivalent to *doubling* effective capacity on the resource that's actually constrained. Cutting latency wins, and it's cheaper than the 50% capacity add.
> - **If the bottleneck is raw CPU throughput** (each request costs a fixed CPU budget regardless of how fast it returns), then latency improvements don't free up throughput headroom, and **adding 50% capacity** is the direct lever.
> - **If the constraint is user-facing SLO**, latency cuts also improve the product and reduce retries (which, per Q20, suppresses effective-QPS amplification) — a second-order capacity win.
>
> The staff-level reasoning: **diagnose which dimension of `L = λ × W` is binding before spending the headroom.** Most engineers reflexively add capacity; the more leveraged move is often latency, because it attacks concurrency *and* retry-amplification *and* user experience simultaneously. Quantify it: "halving W from 200ms to 100ms drops in-flight requests at 6,000 QPS from 1,200 to 600 — that's 600 fewer connections, which is more than the 50% capacity add buys me on the resource that's saturating."

**Q24: Capacity planning says you need 17 instances; finance pushes back on cost. How do you negotiate using the estimation, without compromising reliability?**

> I'd decompose the 17 into its justifying multipliers and show finance exactly what each one buys, because not all of them are equally non-negotiable:
>
> ```
> Load (peak QPS / per-instance)        ~11 instances
> + Utilization headroom (70% target)    (folded into the 11)
> + AZ-failure redundancy (survive 1/3)  → 17 instances
> ```
>
> Then I separate **safety-critical** from **negotiable**:
> - **Non-negotiable:** the peak-load number and the 70% utilization target — dropping below these means we fall off the latency cliff (Q13) during normal peak. I won't trade that; it's not headroom, it's the floor.
> - **Negotiable, with a stated risk:** the AZ-redundancy from 11→17. Finance can choose to survive an *instance* failure but not a full *AZ* failure, which is cheaper but accepts a defined outage risk. That's a business decision, and I'll frame it as one: "for ~6 fewer instances we save $X/month and accept that a single-AZ outage degrades us instead of riding through it — how often is that acceptable?"
> - **Cheaper alternatives I'd offer instead of cutting safety:** autoscaling so we only pay for 17 during the few peak hours and run ~11 off-peak; spot/preemptible instances for the redundancy buffer; a better cache hit rate to shrink the *load* number itself (the most cost-effective lever — see Q15, where 90%→95% halved DB load).
>
> The staff signal is refusing to silently shave reliability to hit a budget. Instead I expose the cost/risk curve, attach numbers to each reliability tier, and let the business make an *informed* trade — while protecting the floor that keeps us off the cliff. Estimation is what makes the negotiation honest: every instance is tied to a multiplier the other side can see and reason about.

---

## Reference: Numbers Worth Memorizing

These constants and shortcuts let you do the whole DAU → QPS → instances chain in your head.

| Quantity | Value | Why it matters |
|----------|-------|----------------|
| Seconds per day | 86,400 (round to **100,000**) | The DAU→QPS divisor |
| 1 million req/day | **≈ 12 QPS** | Daily-volume shortcut |
| 1 billion req/day | **≈ 12,000 QPS** | Scales the above |
| Default peak multiplier | **×2–×3** smooth, **×5+** spiky | Average → peak |
| Healthy utilization ceiling | **~70%** | Stay off the latency cliff |
| Little's Law | **L = λ × W** | QPS + latency → concurrency |
| Typical read:write skew | 10:1 to 1000:1 | Reads → cache/replica; writes → primary |
| Rule of 72 (growth) | doubling time ≈ 72 / (%/period) | Forecasting horizons |

The estimation discipline in one sentence: **start from a user-facing number, apply explicit multipliers (actions/user, peak factor, fan-out, utilization, redundancy), and stop refining once the answer is on the right side of every architectural threshold.** The arithmetic is easy; the skill is knowing which assumptions move the result and saying them out loud.

*Next step:* [Storage](../02-storage/junior.md)
