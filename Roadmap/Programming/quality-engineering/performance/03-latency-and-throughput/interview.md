# Latency and Throughput — Interview Questions

> **Roadmap:** [Performance](../README.md) → Latency and Throughput
> *A performance interview rarely asks "what is latency." It asks "your p50 is fine but your p99 is 10x — what do you check?" and then watches whether you reach for an average (wrong), reason about queueing (right), and know why your load test was lying to you the whole time. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Latency vs Throughput](#theme-1--latency-vs-throughput)
3. [Theme 2 — Percentiles and Tails](#theme-2--percentiles-and-tails)
4. [Theme 3 — Little's Law and Queueing](#theme-3--littles-law-and-queueing)
5. [Theme 4 — Coordinated Omission](#theme-4--coordinated-omission)
6. [Theme 5 — Measurement and Tooling](#theme-5--measurement-and-tooling)
7. [Theme 6 — Debugging Scenarios](#theme-6--debugging-scenarios)
8. [Theme 7 — Design and Judgment](#theme-7--design-and-judgment)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **latency vs throughput** (how long *one* request takes vs how many you finish per second — they are not reciprocals)
- **the average vs the distribution** (the mean is a number almost no user experiences; the tail is what they feel)
- **load vs queueing** (latency doesn't rise linearly with traffic — it goes vertical near saturation)
- **what you sent vs what the system actually served** (coordinated omission: your load generator quietly stops asking and the tail vanishes from the report)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* and, where there's a formula (`L = λW`), actually apply it.

---

## Theme 1 — Latency vs Throughput

### Q1.1 — Define latency and throughput, and explain why they aren't just inverses of each other.

> **Testing:** Whether you conflate the two — the foundational error.

**A.** **Latency** is the time to service a *single* request, end to end (e.g. p99 = 40 ms). **Throughput** is the *rate* of completed work — requests per second, bytes per second. They feel like reciprocals (1/latency) but aren't, because real systems serve requests **concurrently**. A service where each request takes 100 ms (latency) but handles 1000 in flight at once does ~10,000 req/s, not 10. The bridge between them is **concurrency**: throughput = concurrency / latency (this is Little's Law, which we'll get to). You can raise throughput by adding parallelism while latency stays flat — and, more painfully, you can *raise* throughput while latency gets *worse*, because the extra in-flight work sits in queues. Treating them as one number is the root of most bad capacity decisions.

### Q1.2 — Your team wants to raise throughput. Name two ways to do it and what each costs latency.

> **Testing:** Whether you see the trade-off, not just the win.

**A.** Two levers, with opposite latency effects:
1. **More concurrency / parallelism** (more workers, more cores, more in-flight requests). Throughput rises and per-request latency *can stay flat* — until you hit a shared bottleneck (a lock, a connection pool, a disk), after which added concurrency just lengthens queues and latency climbs.
2. **Batching** — group many small operations into one (one DB round trip for 100 rows, one fsync for 100 writes). This raises throughput dramatically by amortizing fixed per-operation cost, but it *adds* latency to individual items: a request now waits for the batch to fill or for a flush timer. It's a deliberate latency-for-throughput trade.

The senior point: throughput and latency are coupled through the bottleneck. "How do I get more throughput" is incomplete without "at what latency budget" — otherwise you'll happily double throughput and blow your SLO.

### Q1.3 — When is batching the right call, and when does it backfire?

> **Testing:** Judgment about a classic latency/throughput trade.

**A.** Batching wins when there's a **large fixed cost per operation** relative to the per-item cost — network round trips, syscalls, fsync, page writes, GPU kernel launches. Amortizing that fixed cost over N items is close to free latency for a big throughput gain, which is why Kafka batches producer records and databases group-commit the WAL. It backfires when (a) traffic is bursty and thin, so batches never fill and you pay the *timeout* delay on every request for no throughput benefit, or (b) the workload is latency-critical and interactive, where the added wait directly hurts the user. The disciplined version uses a **size-or-time** trigger ("flush at 100 items *or* 5 ms, whichever first") so light traffic doesn't eat the worst-case batch delay. Batching is a throughput optimization you pay for in tail latency — size the timer to the SLO.

### Q1.4 — A change cut average response time but the system now handles fewer requests per second. Is that a win?

> **Testing:** Whether you optimize the right metric for the workload.

**A.** It depends entirely on what the system is *for*, and the question is a trap if you answer reflexively. For an **interactive, user-facing** service, lower latency is usually the win — users feel response time, not aggregate rate. For a **batch/throughput-bound** pipeline (ETL, log ingestion, video transcode), throughput is the goal and a per-item latency cut that lowers total throughput is a regression. The other catch: "average response time" is the wrong metric to celebrate either way — I'd want to see the *p99*, because a change that drops the mean while fattening the tail (e.g. added a cache that helps the median but adds a slow miss path) can look like a win and feel like a disaster.

---

## Theme 2 — Percentiles and Tails

### Q2.1 — Why is the average latency a misleading metric? What do you report instead?

> **Testing:** The single most important reflex in the whole topic.

**A.** The average is misleading because latency distributions are **heavily right-skewed** — a long tail of slow requests (GC pauses, cache misses, lock contention, retries). The mean gets dragged by the tail but *hides* it: a service with p50 = 10 ms and p99 = 2 s might average 30 ms, a number almost *no actual request* experiences. The average answers "what's a typical sum" when users live in the *distribution*. Report **percentiles**: p50 (the median — the typical experience), p90/p99 (the unhappy tail), and p99.9 (the worst credible case). Each answers a different question. p50 tells you how the system feels normally; p99 tells you how it feels when something's slightly wrong; p99.9 is what your biggest, most active users hit *constantly*. You can't manage a tail you've averaged away.

### Q2.2 — What does p99 = 250 ms actually mean, and why should you care about p99.9?

> **Testing:** Precise reading of percentiles plus tail-at-scale awareness.

**A.** **p99 = 250 ms** means 99% of requests complete in 250 ms or less, and **1% are slower** — that's the threshold the slowest 1% exceed. People underweight that 1%: at 10,000 req/s, p99 = 250 ms means **100 requests every second** are slower than 250 ms, all day. **p99.9** matters because of *who* hits it. A single user action often triggers many backend requests (a page load might fan out to dozens of services), and a *power user* generates far more requests than average — so your most valuable, most active customers experience the p99.9 routinely, not rarely. The deeper reason, which is the senior answer: **as request counts rise, the probability that at least one request in a user-facing operation hits the tail approaches certainty.** The tail becomes the typical experience for anyone doing real work.

### Q2.3 — Can you average two servers' p99 latencies to get the cluster p99? Why or why not?

> **Testing:** A subtle, real mistake even experienced engineers make.

**A.** **No — percentiles are not additive or averageable.** A percentile is a property of a *specific distribution*; averaging the p99 of server A (say 100 ms) and server B (300 ms) to claim "cluster p99 = 200 ms" is mathematically meaningless — there's no distribution that guarantees. The correct way is to **merge the raw distributions** (or, in practice, merge histograms with the *same bucket boundaries*) and compute the percentile from the combined data. This is exactly why latency must be stored as **histograms**, not pre-computed percentiles: histograms are mergeable across servers and time windows, scalar percentiles are not. Averaging percentiles is one of the most common monitoring bugs, and it always *understates* the tail. If your dashboard shows "avg(p99) across hosts," it's lying to you.

### Q2.4 — Explain "tail at scale." Why does adding more servers to a request make it *slower* at the tail?

> **Testing:** Fan-out amplification — the core insight of the Dean & Barroso paper.

**A.** When one user request **fans out** to many backend services and must wait for *all* of them, the overall latency is the **maximum** of the parallel calls, not the average — and the max is governed by the tail. The math is unforgiving: if each backend has a 1% chance of being slow (p99), then a request touching **one** backend is slow 1% of the time, but a request fanning out to **100** backends is slow `1 − 0.99^100 ≈ 63%` of the time. The rare tail event of a single service becomes the *common* experience of the aggregate. So scaling out — more shards, more microservices per request — *amplifies* the tail unless you actively fight it. This is why p99.9 of individual services dictates the p50 of fan-out systems, and why tail-tolerance techniques (hedged requests, tied requests) exist at all.

### Q2.5 — Two systems have identical p50 and p99. Are they equivalent? How would you tell them apart?

> **Testing:** Whether you think in distributions, not two numbers.

**A.** No — identical p50 and p99 says nothing about *between* and *beyond* those points. One system could be flat to p99 then spike catastrophically at p99.9 (a rare GC-pause-style tail); the other could degrade smoothly. Two points don't define a distribution. I'd tell them apart by looking at the **full distribution** — the whole histogram or CDF — and specifically the **far tail (p99.9, p99.99) and the max**. I'd also look at the *shape*: multimodal latency (two humps) usually means two code paths (cache hit vs miss, fast path vs slow path) and is a different problem than a single fat tail. The lesson: percentiles are samples of a curve; report enough of them (or the histogram) to see the shape, because the difference between the two systems is exactly the part a couple of percentiles omit.

---

## Theme 3 — Little's Law and Queueing

### Q3.1 — State Little's Law and apply it: a service handles 2000 req/s with average response time 50 ms. How many requests are in flight?

> **Testing:** Whether you can actually use the formula, not just name it.

**A.** **Little's Law: L = λW**, where **L** is the average number of items in the system (concurrency / in-flight requests), **λ** is the arrival rate (throughput in steady state), and **W** is the average time each item spends in the system (latency). It holds for *any* stable system regardless of distribution — that's what makes it powerful.

Here: λ = 2000 req/s, W = 50 ms = 0.05 s, so **L = 2000 × 0.05 = 100** requests in flight on average. The practical uses: it tells me I need a thread/connection pool sized for ~100 concurrent requests (with headroom for variance); and it works in reverse — if I *cap* concurrency at 100 and W is 50 ms, max throughput is `L/W = 100/0.05 = 2000 req/s`, full stop. Little's Law is how you connect a concurrency limit to a throughput ceiling on the back of a napkin.

### Q3.2 — Your connection pool is capped at 50. Average query time is 20 ms. What's the max throughput, and what happens above it?

> **Testing:** Little's Law in reverse, plus what saturation feels like.

**A.** Rearranging **λ = L / W**: with L = 50 (the pool cap is the hard concurrency limit) and W = 20 ms = 0.02 s, **max throughput = 50 / 0.02 = 2500 queries/s**. That's a ceiling the pool imposes. Above 2500 req/s, requests can't all get a connection, so they **queue waiting for one**. Now W is no longer 20 ms — it's 20 ms of work *plus* queue-wait time, which grows without bound as arrival rate approaches the ceiling. The throughput stays pinned at ~2500 (you can't go faster than the bottleneck), but latency explodes as the queue backs up. This is the classic signature: **throughput flattens, latency goes vertical.** The fix isn't a bigger pool blindly — it's either faster queries (lower W raises the ceiling) or admission control to shed load before the queue becomes the latency.

### Q3.3 — Why does latency explode near saturation instead of rising linearly? What's the "80% utilization" rule?

> **Testing:** Queueing theory intuition — the most important non-obvious idea here.

**A.** Because **queue length grows non-linearly with utilization**. The standard M/M/1 model gives average wait proportional to **ρ / (1 − ρ)**, where ρ is utilization (arrival rate ÷ service rate). As ρ → 1, the denominator → 0 and wait → infinity. Plugging in: at ρ = 0.5, the factor is 1; at ρ = 0.8 it's 4; at ρ = 0.9 it's 9; at ρ = 0.95 it's 19. So going from 80% to 95% utilization roughly **5x's** your queueing latency for only a 15-point utilization gain. That's the **"keep utilization around 70–80%" rule**: past there, every extra bit of load buys a disproportionate latency penalty, and you've lost the headroom to absorb bursts. The counterintuitive consequence: a system running at 99% CPU isn't "efficient," it's one traffic blip away from a latency cliff. Variability makes this *worse* — bursty arrivals and variable service times push the cliff in earlier than the smooth model predicts.

### Q3.4 — A system at 95% CPU utilization has terrible latency; at 70% it's fine. Same code. Explain.

> **Testing:** Connecting the utilization curve to a real symptom.

**A.** Nothing about the *work* changed — what changed is the **queueing penalty**, which is governed by the ρ/(1−ρ) curve, not the code. At 70% utilization the wait factor is ~2.3; at 95% it's ~19 — roughly **8x more time spent waiting in queue** for the same service time. The CPU isn't doing anything slower per request; requests are just spending most of their life *waiting their turn*. This is why "we're at 95% CPU, great efficiency" is a dangerous read: you're sitting on the steep part of the curve where a small load increase or a brief service slowdown sends latency vertical. The remedy is to run with headroom (target ~70–80%), reduce variability (smooth bursts, even out service times), or add capacity *before* the curve bends — not after the pager goes off.

---

## Theme 4 — Coordinated Omission

### Q4.1 — What is coordinated omission, and why does it make your load test lie?

> **Testing:** The most under-known concept that separates real practitioners.

**A.** **Coordinated omission** is when your measurement tool *unintentionally coordinates with the system under test*, omitting exactly the slow samples that matter. The classic case: a load generator sends a request, **waits for the response**, then sends the next. When the server stalls for 1 second, the generator also stalls — so during that bad second it sends *zero* requests and records *one* slow sample instead of the hundreds of requests that should have arrived and would all have been slow. The tool "coordinated" its sending rate with the server's stall, so the stall is recorded once instead of N times. The result: your reported p99 looks great, the *experienced* p99 is catastrophic, and you ship a system that falls over under exactly the load you thought you tested. It's the difference between "how long did the requests I managed to send take" and "how long would a request that arrived on schedule take."

### Q4.2 — A request stalls for 1 second. How does a naive load generator under-report the tail?

> **Testing:** Whether you can show the mechanism with numbers.

**A.** Suppose the intended rate is 1000 req/s (one request every 1 ms). The server stalls for 1 full second. A naive closed-loop generator was blocked waiting on the in-flight request, so during that second it records **one** sample of ~1000 ms and then resumes. But on the intended schedule, **1000 requests** should have been issued during that second — the one that got stuck *plus* 999 that would have arrived behind it and waited 999 ms, 998 ms, 997 ms, …, down to ~1 ms. The correct record is ~1000 slow samples forming a ramp from 1000 ms down; the naive tool recorded *one*. With one bad sample out of, say, a million, your p99 doesn't even move. The tail you needed to see — caused by the stall queueing up everything behind it — is silently deleted, which is precisely why the system surprises you in production.

### Q4.3 — How do you fix coordinated omission in measurement?

> **Testing:** Concrete remediation, not just diagnosis.

**A.** Two complementary fixes:
1. **Measure against a schedule, not against the response.** Compute each request's latency from its *intended* send time (when it *should* have been sent at the target rate), not from when the generator actually got around to sending it. The extra wait caused by a stall is then correctly attributed to every backed-up request. Tools that do this: **wrk2** (constant-throughput, open-loop) and **HdrHistogram's `recordValueWithExpectedInterval`**, which back-fills the synthetic samples a stall should have produced.
2. **Use an open-loop / constant-rate generator** that keeps issuing requests on schedule regardless of whether prior ones have returned, so a stall produces a real pileup instead of a pause.

The conceptual fix is the same in both: **the clock, not the server, sets the pace.** And know your model — a *closed-loop* test (fixed number of users each waiting for a reply) is legitimate for modeling think-time behavior, but it must not be reported as if it measured a constant arrival rate.

---

## Theme 5 — Measurement and Tooling

### Q5.1 — Why is HdrHistogram the standard for latency, and what problem does a plain histogram have?

> **Testing:** Whether you understand high-dynamic-range recording.

**A.** Latency spans a *huge dynamic range* — from microseconds (cache hit) to seconds (timeout) — and you care about precision across all of it, especially the far tail. A naive fixed-bucket histogram either wastes memory with millions of uniform buckets or loses resolution where you need it. **HdrHistogram** (High Dynamic Range) solves this with **logarithmically-sized buckets at a configured precision** (e.g. "3 significant digits from 1 µs to 1 hour"), giving constant *relative* error across the whole range in bounded memory, with **O(1) constant-time recording** (no allocation, no locks on the hot path). Critically it stores the *full distribution*, so you compute p50, p99, p99.99, and max after the fact — and merge histograms across hosts/intervals (because percentiles aren't averageable). It also has built-in **coordinated-omission correction** via expected-interval recording. That combination — full distribution, mergeable, O(1), CO-aware — is why it's the de facto standard.

### Q5.2 — Histograms vs summaries for latency metrics (e.g. in Prometheus). Which do you pick and why?

> **Testing:** A real, decision-shaped tooling question.

**A.** A **summary** computes percentiles **client-side, per instance**, and exports the precomputed quantiles. A **histogram** exports **bucket counts** and percentiles are computed at query time on the server. For anything aggregated across instances, **pick the histogram** — because you can sum bucket counts across hosts and then compute a cluster percentile, whereas summary quantiles are **per-instance and cannot be aggregated** (you'd be back to the illegal "average of p99s"). Summaries give exact per-instance quantiles cheaply and are fine for a single-instance view, but they can't answer "what's the fleet p99." The cost of histograms is choosing bucket boundaries well — too coarse near your SLO and the percentile estimate is mushy. So: histograms for distributed/aggregated latency (with buckets placed around your SLO thresholds), summaries only when you genuinely need exact per-instance quantiles and never aggregate.

### Q5.3 — wrk vs wrk2 — why does the "2" matter for latency numbers?

> **Testing:** Connecting tooling choice back to coordinated omission.

**A.** **wrk** is a closed-loop, maximum-throughput load generator: each thread fires a request and waits for the response before the next. That makes it excellent for finding *peak throughput* but it **suffers coordinated omission** — when the server stalls, wrk stalls with it and under-reports the tail. **wrk2** (Gil Tene's fork) adds a **`-R` constant request rate**: it issues requests on a fixed schedule regardless of responses and measures latency **from the intended send time**, so a stall correctly piles up and inflates the tail the way production would. So the "2" matters because wrk's latency tail is *fiction under stall* and wrk2's is honest. Rule of thumb: use a constant-rate, open-loop tool (wrk2, or k6/Gatling in open-model) whenever you report latency percentiles; a closed-loop max-throughput run answers a different question (the throughput ceiling), not the latency one.

### Q5.4 — Where should you measure latency — client, load balancer, or service? What does each miss?

> **Testing:** Whether you know latency is a layered, perspective-dependent number.

**A.** Each vantage point answers a different question and hides a different cost:
- **Service-internal** (handler start to handler end): cheap, precise, but **blind to queueing before the handler runs** — the request could have waited 500 ms in an accept queue or thread-pool backlog that this number never sees. This is where coordinated omission and "p99 looks fine but users complain" live.
- **Load balancer / edge**: includes the service's own queue wait and connection handling — closer to truth, but misses the network leg to the actual client.
- **Client / RUM (real user monitoring)**: the *real* experienced latency including DNS, TLS, network, and queueing — but noisy and affected by things you don't control (the user's Wi-Fi).

The senior answer: **measure at multiple layers and diff them.** If edge p99 ≫ service-internal p99, your latency is in *queueing/admission*, not in the code — and the service's own metric was telling you a comfortable lie. "Where you measure" determines which failures are even visible.

---

## Theme 6 — Debugging Scenarios

### Q6.1 — p50 is fine (8 ms) but p99 is 800 ms — a 100x gap. Walk me through what you check.

> **Testing:** Structured tail-latency triage instead of guessing.

**A.** A huge p50/p99 gap means **most requests are fine and a few hit something occasionally** — so I hunt for *intermittent, shared, or stateful* causes, not a uniform slowdown. In rough order:
1. **Stop-the-world pauses** — GC (JVM/Go), runtime safepoints. These hit *every* request unlucky enough to land during the pause and produce exactly this signature. Check GC logs / pause-time metrics first.
2. **Queueing / contention** — a lock, a connection-pool wait, a thread-pool backlog. Little's Law: if you're near saturation on *some* resource, the unlucky requests wait. Check pool saturation and lock contention.
3. **Cache misses / cold paths** — p50 is the cache hit, p99 is the miss that goes to disk or a downstream. Look at hit rate and the miss-path latency.
4. **Downstream tail amplified by fan-out** — one slow dependency or shard drags the request that touches it (tail-at-scale). Check per-dependency latency.
5. **Noisy neighbors / infra** — CPU throttling (cgroup limits), a slow disk, network retransmits, a single bad host. Break the percentile down *by host* — a fat tail concentrated on one instance is a hardware/placement problem.

The method is: the *shape* (flat then a cliff) tells me it's intermittent; then I bisect by layer (GC → contention → cache → downstream → host) using percentiles broken down by dimension, not averages.

### Q6.2 — Throughput climbed with load, then suddenly collapsed under peak — it's now *lower* than at moderate load. Why?

> **Testing:** Recognizing congestion collapse / retry storms.

**A.** This is **congestion collapse**, and the giveaway is throughput going *down* past a point — a healthy saturated system *plateaus*, it doesn't regress. Usual causes:
- **Retry storms / metastable failure.** Requests start timing out near saturation, clients retry, retries add load, more requests time out — a positive feedback loop where the system spends its capacity on doomed retried work. The fix is retry budgets, exponential backoff with jitter, and circuit breakers.
- **Queue-induced timeouts.** As the queue grows, requests sit so long they exceed their deadline and get dropped *after* you already paid to enqueue and partially process them — pure wasted work, so goodput falls.
- **Thrashing.** Memory pressure → swapping or GC death spiral, or context-switch overhead from too many threads — the system spends cycles on overhead instead of work.

I'd confirm by correlating the throughput cliff with retry-rate, timeout-rate, and queue-depth metrics. The durable fix is **admission control / load shedding**: reject or queue-with-deadline *early* so the system stays on the plateau instead of collapsing — protecting goodput by refusing work it can't finish in time.

### Q6.3 — Your load test reports p99 = 15 ms but real users see frequent multi-hundred-ms responses. What's the most likely measurement error?

> **Testing:** Whether coordinated omission is the first thing you reach for.

**A.** Almost certainly **coordinated omission** in the load test. The generator is closed-loop (waits for each response before sending the next), so when the server stalls the generator stalls with it, recording one slow sample instead of the pileup of requests that *should* have arrived during the stall. The reported p99 is computed over "requests I managed to send," which omits exactly the backed-up slow ones — so it reads 15 ms while production, where requests *do* arrive on schedule and queue up behind a stall, sees the real tail. I'd fix the *measurement* before touching the system: switch to a **constant-rate open-loop generator (wrk2)** or enable **HdrHistogram's expected-interval correction**, and measure latency from intended send time. Secondary check: confirm we're measuring at the right layer — service-internal metrics also hide pre-handler queueing. But CO is the prime suspect whenever the lab tail is suspiciously clean and prod isn't.

### Q6.4 — Latency is fine under synthetic load but spikes in production at the same request rate. Same hardware. What differs?

> **Testing:** Why lab numbers don't transfer — variability and workload shape.

**A.** Same *average* rate isn't the same *workload*. Likely differences:
- **Burstiness.** Synthetic load is smooth; real traffic is bursty (diurnal peaks, thundering herds). Queueing latency is driven by *variance*, not just the mean rate — bursts push you onto the steep part of the ρ/(1−ρ) curve momentarily even if the average utilization looks safe.
- **Request mix / cardinality.** The synthetic test probably hits a small hot set (everything cached, same keys); production has a long tail of cold keys, big payloads, expensive queries, and unfavorable cache behavior.
- **Coordinated omission** in the test masking a tail that's always been there.
- **Real concurrency interactions** — lock contention and shared-resource queueing that only appear with the production access pattern, not a uniform synthetic one.

The lesson: **average req/s is a weak predictor of latency.** I'd make the load test reproduce production's *distribution* — burst shape, key/cardinality distribution, payload sizes — and run open-loop. Until the test's variability matches production's, matching the mean rate proves little.

---

## Theme 7 — Design and Judgment

### Q7.1 — How do you set a latency SLO, and which percentile do you put in it?

> **Testing:** SLO literacy — turning latency into a contract.

**A.** An SLO is a *target on a percentile over a window*, e.g. "**99% of requests < 200 ms over a rolling 28 days**." Key choices: pick the **percentile by who you're protecting** — p99 (and often p99.9) for user-facing latency, because the tail is what active users and fan-out callers actually feel; the average is never an SLO because it hides the tail. Set the **threshold from real user impact**, not a round number — the point where latency starts costing conversions or violating a downstream's budget. The window and target imply an **error budget** (1% of requests may exceed 200 ms), which is the lever for balancing reliability work against feature velocity: budget left → ship; budget burned → freeze and fix. And the SLO must be measured **where the user lives** (edge/client), not service-internal, or you're SLO-ing a number that omits queueing. See [Monitoring & Alerting](../../../../Architecture/system-design/) practice for wiring SLOs to burn-rate alerts.

### Q7.2 — Given a throughput target, how do you size capacity — and how much headroom?

> **Testing:** Capacity planning from first principles with Little's Law.

**A.** Start from the **target throughput at peak** (not average — size for the peak you must serve), then:
1. **Per-node ceiling via Little's Law / measured limits.** If a node sustains throughput λ_node at acceptable latency (measured, with a load test that isn't lying about the tail), nodes needed ≈ peak_λ / λ_node.
2. **Headroom for the utilization curve.** Don't size to 100% of the ceiling — target **~70–80% utilization** so you stay off the latency cliff (ρ/(1−ρ) blows up past there) and can absorb bursts. That's the difference between "it works at the average" and "it survives the spike."
3. **Headroom for failure.** Add capacity to tolerate losing nodes/AZs (N+1 or N+2), and for **retry amplification** during incidents.
4. **Re-derive concurrency settings** (pool/thread sizes) from L = λW so the configured concurrency matches the in-flight count the target rate implies.

The senior move is sizing for *peak × headroom × redundancy*, validated by a realistic (burst-shaped, open-loop) load test — not extrapolating from an average-rate benchmark.

### Q7.3 — Name a technique to reduce *tail* latency specifically, and explain the trade-off.

> **Testing:** Tail-tolerance design — hedged/tied requests from the tail-at-scale playbook.

**A.** **Hedged requests.** Send the request to one replica; if it hasn't responded by a short threshold (e.g. the p95), send a **second** request to another replica and take whichever returns first. Because slow responses are usually *transient and uncorrelated* (a GC pause, a busy host) rather than the request being intrinsically slow, the duplicate almost always dodges the stall — collapsing the tail dramatically. Google reported sending hedges only after the 95th percentile adds ~5% extra load while cutting p99.9 substantially. The **trade-off** is exactly that extra load: hedging trades a small throughput/cost overhead for a big tail-latency win, and you must cap it (only hedge the slowest few %) or it amplifies load during overload — the worst time. **Tied requests** are a refinement: send to two replicas that each cancel the other once one starts executing, cutting the duplicate work. Other tail tools: load-balance away from slow hosts, set tight per-try timeouts with retries, and isolate tail-causing work (e.g. separate GC-heavy paths).

### Q7.4 — A downstream dependency has a fat p99.9. Your service fans out to 50 of its shards per request. What's your latency exposure and what do you do?

> **Testing:** Applying tail-at-scale math and choosing a mitigation.

**A.** **The exposure is amplification.** Because I wait for all 50 shards, my request's latency is the **max** of 50 calls. If each shard is slow 0.1% of the time (p99.9), the chance *at least one* is slow per request is `1 − 0.999^50 ≈ 4.9%` — so what's a 1-in-1000 event for the dependency becomes a ~1-in-20 event for *me*. My p99.9 is effectively their p99.9 made common. Mitigations, roughly in order:
1. **Hedged/tied requests** to the shards so a single slow replica doesn't gate the whole fan-out.
2. **Tight per-shard deadlines** with a partial-result strategy — return from the shards that answered in time rather than waiting for the slowest (degrade gracefully if the use case allows).
3. **Reduce fan-out width** — fewer shards per request, or a coarser partitioning, lowers the amplification exponent.
4. **Push back on the dependency's p99.9** — at this fan-out, their tail *is* my median, so their tail is my problem to escalate.

The framing that earns the point: at fan-out 50, I don't care about their p50; **their p99.9 sets my typical experience**, so I design for the max, not the average.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Latency vs throughput in one line?** A: Latency = time for one request; throughput = rate of completed requests; bridged by concurrency (Little's Law).
- **Q: Why not report the average latency?** A: The distribution is right-skewed; the mean hides the tail and is experienced by almost no one.
- **Q: Can you average percentiles?** A: No — percentiles aren't additive; merge histograms (same buckets) and recompute.
- **Q: State Little's Law.** A: L = λW: in-flight = arrival rate × time-in-system, for any stable system.
- **Q: At ρ = 0.9 utilization, how much worse is queue wait than at ρ = 0.5?** A: ~9x vs ~1x (ρ/(1−ρ)) — roughly 9 times worse.
- **Q: Why target ~70–80% utilization?** A: Past it the ρ/(1−ρ) curve bends sharply; small load increases cause big latency jumps and you lose burst headroom.
- **Q: What is coordinated omission?** A: The measurement tool stalls with the server, omitting the slow samples a stall should have produced, so the tail is under-reported.
- **Q: One-line fix for coordinated omission?** A: Measure from intended send time with an open-loop, constant-rate generator (wrk2 / HdrHistogram expected-interval).
- **Q: Histogram or summary for fleet-wide p99?** A: Histogram — bucket counts aggregate across hosts; summary quantiles don't.
- **Q: Why HdrHistogram over a plain histogram?** A: Constant relative precision across a huge dynamic range, O(1) recording, mergeable, CO-aware.
- **Q: What's "tail at scale"?** A: Fan-out makes a request's latency the max of its calls, so each backend's rare tail becomes the aggregate's common case.
- **Q: Fan-out to 100 backends each 1% slow — odds the request is slow?** A: 1 − 0.99^100 ≈ 63%.
- **Q: What's a hedged request?** A: After a short delay, send a duplicate to another replica and take the first to return — cuts the tail for a small load cost.
- **Q: Signature of congestion collapse?** A: Throughput *drops* past peak (not just plateaus), usually from retry storms or deadline-exceeded wasted work.
- **Q: Goodput vs throughput?** A: Goodput is *useful* completed work; throughput can include doomed/retried/timed-out work that never helps anyone.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Treating latency and throughput as reciprocals of one number.
- Reporting or optimizing the **average** latency; ignoring the tail.
- **Averaging percentiles** across hosts or time windows.
- Assuming latency rises linearly with load — no queueing intuition.
- Never having heard of **coordinated omission**, or trusting a closed-loop load test's tail.
- "Just add more servers" to a fan-out problem (it amplifies the tail).
- Sizing capacity to 100% of the per-node ceiling with no headroom.

**Green flags:**
- Naming the *distinction* (latency/throughput, average/distribution, load/queueing) before diving in.
- Actually applying **L = λW** and the **ρ/(1−ρ)** curve with numbers.
- Reaching for **histograms / HdrHistogram** and knowing why percentiles can't be averaged.
- Calling out **coordinated omission** unprompted when a lab tail looks too clean.
- Reasoning about **tail at scale / fan-out amplification** with the `1 − (1−p)^n` math.
- Proposing **hedged requests / admission control / load shedding** and naming their cost.
- Asking "at what latency budget?" before answering "how do I get more throughput?"

---

## Summary

- The bank reduces to four distinctions in costume: **latency vs throughput**, **average vs distribution**, **load vs queueing**, and **what you sent vs what was served (coordinated omission)**. Name the distinction; apply the formula where one exists.
- **Latency vs throughput** are bridged by concurrency, not reciprocity. Batching and parallelism raise throughput but trade latency — always ask "at what latency budget."
- **Percentiles:** the average lies because the distribution is skewed; report p50/p99/p99.9, never average percentiles (merge histograms instead). Fan-out makes the tail the common case — `1 − (1−p)^n`.
- **Little's Law (L = λW)** connects concurrency, throughput, and latency on a napkin; the **ρ/(1−ρ)** queueing curve is why latency goes vertical near saturation — run at ~70–80% utilization.
- **Coordinated omission** is the silent killer of load tests: closed-loop generators stall with the server and delete the tail. Fix it with open-loop, constant-rate measurement from intended send time (wrk2, HdrHistogram).
- **Measurement:** histograms (mergeable) over summaries (per-instance) for fleet percentiles; HdrHistogram for high dynamic range; measure at multiple layers and diff them.
- **Design:** SLOs on the tail percentile measured where the user lives; capacity from peak × headroom × redundancy; fight the tail with hedged requests and protect goodput with admission control.

---

## Further Reading

- *"The Tail at Scale"* — Dean & Barroso (CACM, 2013). The canonical paper on fan-out amplification and tail-tolerance techniques (hedged/tied requests).
- *Designing Data-Intensive Applications* — Martin Kleppmann, Chapter 1 ("Describing Performance"): percentiles, tail latency, and why averages mislead.
- Gil Tene, *"How NOT to Measure Latency"* (talk) — the definitive treatment of coordinated omission, plus HdrHistogram and wrk2.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.
- `wrk2`, `HdrHistogram`, and Prometheus histogram docs — primary sources for the tooling the answers reference.

---

## Related Topics

- [02 — Benchmarking and Microbenchmarks](../02-benchmarking-and-microbenchmarks/interview.md) — how to measure latency/throughput honestly, warmup, and statistical rigor.
- [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md) · [professional.md](professional.md) — the tiered treatment of this topic.
- [Performance README](../README.md) — where latency and throughput sit in the broader performance landscape.
- [Quality Engineering README](../../README.md) — the full QE interview landscape.
