# Latency Budgets — Interview Questions

A latency budget is the discipline of allocating a finite end-to-end response-time target across every hop in a request path, then enforcing it with timeouts and deadlines. These questions move from "what is a budget" up to staff-level judgment about tail behavior, fan-out math, and when the budget itself should force an architecture change. Every answer shows its arithmetic — interviewers care far more about *how* you reason about the numbers than about a memorized constant.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Staff / Judgment Questions](#staff--judgment-questions)

---

## Junior Questions

**Q1: What is a latency budget, in one sentence, and why bother writing one down?**

> A latency budget is a target end-to-end response time that you deliberately split into per-component allowances, so each hop knows its share and you can spot where the time goes *before* you build the system. Without one, latency is an emergent surprise: you ship, measure 900 ms, and have no framework for deciding which of the eight hops to attack. With one, you say "the budget gives the database 30 ms and it's taking 180 ms — there's the bug." It turns a vague "make it faster" into an accountable allocation, the same way a financial budget turns "spend less" into line items.

**Q2: Roughly order these from fastest to slowest: L1 cache reference, main-memory reference, SSD random read, network round-trip within a datacenter, network round-trip across the US.**

> Fastest to slowest, with the rough orders of magnitude every engineer should carry:
>
> | Operation | Typical latency | Relative |
> |---|---|---|
> | L1 cache reference | ~1 ns | 1× |
> | Main memory reference | ~100 ns | 100× |
> | SSD random read | ~16 µs | 16,000× |
> | Round-trip within a datacenter | ~0.5 ms | 500,000× |
> | Round-trip US coast-to-coast | ~150 ms | 150,000,000× |
>
> The headline: memory is ~100× slower than L1, an SSD read is ~150× slower than memory, a same-DC network hop is ~30× slower than an SSD read, and a cross-country round-trip is ~300× slower than a same-DC hop. These ratios — not the exact numbers — are what let you sanity-check a design in your head.
>
> 🎞️ **See it animated:** [Latency Numbers Every Programmer Should Know](https://colin-scott.github.io/personal_website/research/interactive_latency.html)

**Q3: A request hits an API gateway, then a service, then a database, and returns. If each step is 20 ms, what is the end-to-end latency?**

> The steps happen one after another, so you *add* them: gateway 20 ms + service 20 ms + database 20 ms = 60 ms of work. Then remember the network hops between them. If there are three sequential network round-trips at ~0.5 ms each in-DC, that's another ~1.5 ms, for ~61.5 ms. The lesson for a junior: sequential work sums, and don't forget the wires between the boxes — they're cheap in-DC but not free.

**Q4: What's the difference between p50 and p99 latency, and which one should a budget target?**

> p50 (median) is the latency half your requests beat; p99 is the latency 99% of requests beat — i.e., the slowest 1% are worse than this. They can differ wildly: a service might have p50 = 10 ms but p99 = 200 ms because of GC pauses, cold caches, or lock contention. You budget at the tail (p99, sometimes p99.9), because users feel the slow requests, and at scale a single page view triggers dozens of calls — so almost every page hits *somebody's* tail. A budget built only on p50 is a budget that's blown the moment real traffic arrives.

**Q5: Your product team says "pages should load fast." How do you turn that into a number you can budget against?**

> I push for a measurable target tied to a percentile and a threshold, because "fast" isn't enforceable. I'd convert it to something like "p95 page load ≤ 1 second" — a concrete SLO. From there the budget is mechanical: subtract the client render time and the browser-to-edge network, and what's left is the *server-side* budget I get to split across gateway, services, and storage. The conversation moves from opinion ("feels slow") to arithmetic ("we're 300 ms over the 1,000 ms target, and 220 ms of that is the recommendation call").

---

## Middle Questions

**Q6: Walk me through decomposing a 200 ms p99 budget for a "get user profile" request that hits a load balancer, an auth check, a profile service, and a cache-or-database read.**

> I lay out every hop and assign an allowance that sums to ≤ 200 ms, leaving slack. A first pass:
>
> | Hop | Allowance (p99) |
> |---|---|
> | Client→edge + LB | 15 ms |
> | Auth check (token validate, cached keys) | 10 ms |
> | Profile service compute | 25 ms |
> | Cache read (hit path) | 5 ms |
> | DB read (miss path) | 40 ms |
> | Network round-trips (4 × ~1 ms) | 4 ms |
> | Serialization / framing | 6 ms |
> | **Subtotal (cache-miss path)** | **100 ms** |
> | **Reserve / safety margin** | **100 ms** |
>
> I budget the *worst realistic path* (cache miss, 100 ms) and keep the other 100 ms as headroom for GC, queueing, and tail variance. If a single line item is already eating the whole budget, that's the design conversation to have now, not after launch.

**Q7: When do you add component latencies and when do you take the maximum?**

> Add them when calls are **sequential** (each must finish before the next starts); take the max when calls are **parallel** (fired together, you wait for the last to return). Concretely: if service A calls B then C then D at 30 ms each sequentially, that's 30+30+30 = 90 ms. If A fires B, C, D concurrently, it's max(30, 30, 30) = 30 ms — a 3× win. The catch with parallel is the tail: you're now exposed to the *slowest* of the three on every request, which is why fan-out makes p99 worse even though it makes p50 better. Sequential is predictable; parallel trades latency for tail risk.

**Q8: Show the two paths with a diagram and the math.**

> ```mermaid
> flowchart TD
>     subgraph SEQ["Sequential — latencies ADD"]
>         direction LR
>         A1[Service A] --> B1["B<br/>30ms"] --> C1["C<br/>30ms"] --> D1["D<br/>30ms"]
>     end
>     subgraph PAR["Parallel — latency = MAX"]
>         direction TB
>         A2[Service A] --> B2["B 30ms"]
>         A2 --> C2["C 30ms"]
>         A2 --> D2["D 30ms"]
>         B2 --> J[join: wait for slowest]
>         C2 --> J
>         D2 --> J
>     end
>     SEQ -. "30+30+30 = 90ms" .-> R1[Total 90ms]
>     PAR -. "max(30,30,30) = 30ms" .-> R2[Total 30ms]
> ```
>
> Sequential total = sum = 90 ms. Parallel total = max = 30 ms. The diagram makes the trade visible: parallel is 3× faster at the median but binds your latency to whichever dependency tails worst.

**Q9: How do you derive a service's latency budget from an SLO?**

> Start from the user-facing SLO and work inward, subtracting fixed costs. Say the SLO is "p99 end-to-end ≤ 300 ms." Client render and last-mile network might eat 80 ms, leaving 220 ms server-side. The edge/LB takes 20 ms → 200 ms for the service mesh. If the request fans through three services in sequence, I might split it 70 / 70 / 60 ms, then within each service subtract its own DB and serialization costs. The SLO is the total budget; deriving per-service numbers is just repeated subtraction down the call tree, always reserving margin at each level.

**Q10: What role do timeouts play in a latency budget?**

> Timeouts are how you *enforce* the budget — they convert an allowance into a hard ceiling. If the profile service is budgeted 25 ms, I don't set its DB timeout to the database's default of 30 seconds; I set it near its allowance plus margin, say 50 ms. Past that, waiting longer can't help: the end-to-end budget is already blown, so I fail fast and return a degraded response rather than holding the whole call tree hostage. A timeout much larger than the budget is a budget with no enforcement — the slow path will eventually find it.

**Q11: Why can't you just add p99 values across hops to get the end-to-end p99?**

> Because percentiles don't add. The end-to-end p99 is *not* the sum of each hop's p99, because the slow requests at one hop are mostly different requests from the slow ones at the next hop. If hop A is at its p99 on 1% of requests and hop B independently on a *different* 1%, the chance a single request is slow at *both* is roughly 0.01 × 0.01 = 0.0001 — extremely rare. So summing p99s massively overestimates the real end-to-end p99. Conversely, summing p50s *underestimates* it. The honest answer: you can't compute end-to-end percentiles from per-hop percentiles analytically; you measure the end-to-end distribution directly. For budgeting, summing p99s gives a safe (pessimistic) upper bound, which is fine for allocation but wrong as a prediction.

---

## Senior Questions

**Q12: Explain the tail-at-scale problem. Why is the p99 of a fan-out far worse than the p99 of a single call?**

> If one backend serves a request with p99 = 10 ms, that means each call has a 1% chance of exceeding 10 ms. Now a request fans out to N backends in parallel and must wait for *all* of them. The probability that *at least one* exceeds 10 ms is 1 − (1 − 0.01)^N. The slow tail of the whole request is governed by that probability, not by any single call.
>
> | Fan-out N | P(at least one > p99) = 1 − 0.99^N |
> |---|---|
> | 1 | 1.0% |
> | 10 | 9.6% |
> | 50 | 39.5% |
> | 100 | 63.4% |
> | 200 | 86.6% |
>
> At N = 100, **63%** of requests touch a backend's p99 — so what was a 1-in-100 event for one call becomes the *common case* for the fan-out. This is Dean & Barroso's "tail at scale": as you add parallel dependencies, the *median* of the overall request drifts toward the *tail* of the individual calls. It's why a service composed of many fast services can still be slow, and why you must attack tails, not averages.

**Q13: Given that math, what techniques cut tail latency in a fan-out?**

> Several, often combined:
>
> - **Hedged requests:** after a short delay (e.g., the p95 of the call), send a duplicate request to a second replica and take whichever returns first. This caps your exposure to one slow replica at the cost of a few percent extra load.
> - **Tied requests:** send to two replicas immediately but have them cancel each other once one starts executing — even tighter tail control.
> - **Reduce fan-out:** fewer parallel dependencies directly lowers 1 − (1−p)^N. Sometimes one fatter call beats ten thin ones.
> - **Improve the per-call tail:** fix the GC pauses, lock contention, or cold caches causing the p99, which shifts the whole curve.
> - **Partial results / good-enough responses:** return the 95 shards that answered and skip the 5 stragglers if the product allows.
>
> The framing: you can't make every call fast, so you make slowness *recoverable*.

**Q14: How do hedged requests change the math, and what's the cost?**

> Say each replica independently exceeds 10 ms with probability 1%, and you hedge by sending a second copy. The hedged request is slow only if *both* copies are slow: ~0.01 × 0.01 = 0.0001, i.e., 0.01% — a 100× improvement in that tail. Even hedging only after the p95 (so the second request fires on just ~5% of calls) recovers most of the benefit while adding only ~5% extra traffic. The cost is real: extra load on backends and replicas, plus the bookkeeping to cancel the loser. The rule of thumb is to defer the hedge until the original is already in its slow tail, so you pay the extra request only when it's likely to help.

**Q15: What is coordinated omission and why does it make your p99 a lie?**

> Coordinated omission is the measurement bug where your load generator only records latency for requests it actually sent — but when the system stalls, the generator *also* stalls and simply doesn't send the requests that would have hit the stall. The slowest requests are systematically omitted, so the tail looks far better than reality. Example: you intend to send one request per millisecond. The server freezes for 1 second. An honest measurement should show ~1,000 requests with latencies ramping up to ~1 s. Coordinated omission instead shows *one* slow request (~1 s) plus 999 fast ones that "would have" started during the freeze but were never issued — turning a 1-second stall into a barely-visible blip. The fix: record latency against each request's *intended* start time (not when it was actually sent), or use a tool that compensates (e.g., correcting for the freeze by back-filling the omitted samples). Otherwise you'll budget against a fantasy tail.

**Q16: How do you propagate a deadline through a chain of services so the budget is honored end to end?**

> I attach an absolute deadline (a wall-clock timestamp, not a duration) to the request and pass it through every hop — in gRPC this is the built-in deadline; otherwise a header like `X-Request-Deadline`. Each service computes its *remaining* budget as `deadline − now`, and gives its own downstream calls a timeout no larger than that, minus a small reserve for its own post-processing. So if the gateway sets a 200 ms deadline and 60 ms is already spent by the time the profile service calls the database, the database call gets at most ~135 ms, not a fresh 200 ms. This prevents the classic bug where each layer independently allows the full budget, so a 4-deep chain could legally take 4× the intended time. Deadline propagation makes the budget a *shared, shrinking* resource that the whole call tree respects.

---

## Professional / Deep-Dive Questions

**Q17: Quantify the business case. How much does latency actually cost in revenue, and how does that anchor a budget?**

> The famous published figures:
>
> | Study | Finding |
> |---|---|
> | Amazon | Every 100 ms of added latency cost ~1% in sales |
> | Google | An extra 500 ms on search results dropped traffic ~20% |
> | Google (later) | Slowing results by 100–400 ms reduced searches per user, with effects persisting after speed was restored |
>
> These numbers turn a latency budget from an engineering nicety into a P&L line. If a feature adds 100 ms and we do $5B/year through the affected flow, the back-of-envelope cost is ~$50M/year — which is how you justify spending a sprint to shave 40 ms, or how you decide a "nice" feature isn't worth its latency. I'd never quote these as exact for *our* product (they're from specific companies and eras), but they establish the order of magnitude: tens of milliseconds are worth real money at scale, which is precisely why the budget is enforced rather than aspirational.

**Q18: How do you allocate a single end-to-end budget across multiple teams that each own a service?**

> I treat the budget like a shared resource with named owners, because an unowned millisecond is one nobody defends. The mechanics:
>
> 1. Fix the end-to-end SLO (e.g., p99 ≤ 250 ms).
> 2. Map the critical path and assign each team a numbered allowance whose sum (plus reserve) ≤ 250 ms — e.g., gateway 20, auth 15, search 90, ranking 70, render 30, reserve 25.
> 3. Make each allowance a *per-service SLO* the team is accountable for and alerts on.
> 4. Hold a central reserve (the 25 ms) so one team's overrun doesn't silently steal another's headroom.
> 5. Require a "latency change request" when a team wants to exceed its allowance — they must find the milliseconds elsewhere (their own optimization, or a negotiated trade with another team).
>
> The political point: if you don't decompose the budget into owned line items, every team assumes it has the whole budget, and the sum blows the SLO. Per-team allowances make the trade-offs explicit and negotiable.

**Q19: A dependency you don't control has a p99 of 300 ms but your end-to-end budget is 200 ms. What are your options?**

> The budget is mathematically infeasible on the synchronous path, so I change the *shape* of the call, not just the number:
>
> - **Cache it.** If the data tolerates staleness, serve from a local/edge cache and refresh asynchronously — the 300 ms call moves off the request path entirely.
> - **Make it asynchronous.** Return immediately with a pending state and fill in the slow data via a follow-up (poll, SSE, websocket). The user-perceived budget is met even though the dependency is slow.
> - **Precompute.** Materialize the result ahead of time (a nightly job, a stream processor) so the request reads a ready answer.
> - **Hedge or use a faster replica/region** if the slowness is tail variance rather than inherent.
> - **Degrade gracefully.** Time out at, say, 150 ms and return a default/partial response, so the 300 ms dependency can't blow the whole request.
>
> Notice the budget *forced* an architecture decision: when the math doesn't close synchronously, you push work off the critical path. That's the budget doing its job — it surfaces the redesign early instead of at 3 a.m. during an incident.

**Q20: Why is a budget that only reserves margin at p99 still risky, and how do you account for queueing?**

> Because as utilization rises, queueing latency explodes non-linearly, and your nice static budget assumes a near-idle system. By queueing theory, waiting time scales roughly with 1/(1 − ρ), where ρ is utilization. At ρ = 0.5 the queueing multiplier is ~2×; at ρ = 0.8 it's ~5×; at ρ = 0.9 it's ~10×. So a service whose service time is 10 ms can show 50–100 ms of *waiting* once it's busy, even though nothing in the code got slower. A budget that ignores this works in a load test at 30% utilization and detonates in production at 85%. The fix is to budget at your *target peak utilization*, keep utilization well below the knee (often ≤ 70%), and treat the gap between p50 and p99 as a queueing/contention signal — if the tail balloons under load, you're past the knee and need headroom or more capacity, not micro-optimizations.

---

## Staff / Judgment Questions

**Q21: You inherit a system at p99 = 1.2 s against a 500 ms SLO. How do you run the investigation using the budget as a tool?**

> I make the budget a measurement plan, not a guess:
>
> 1. **Instrument the critical path** with per-hop spans (distributed tracing) so I have the *actual* latency distribution per hop, not just totals.
> 2. **Build the budget table** of where the time *should* go vs. where it *does* go. The gap localizes the problem — usually one or two hops own most of the overage.
> 3. **Attack the biggest line item first.** If ranking is 600 ms of the 1,200, halving ranking beats any amount of work on a 20 ms hop. Amdahl's law: optimize the dominant term.
> 4. **Separate "always slow" from "tail slow."** A high p50 means a structural cost (a slow query, sequential calls that should be parallel); a fine p50 but bad p99 means tail effects (GC, fan-out, contention) — different fixes.
> 5. **Re-budget after each change** and confirm the end-to-end p99 actually moved — local wins don't always show up globally because of fan-out.
>
> The judgment is in *sequencing*: measure before optimizing, and spend your effort where the milliseconds actually are.

**Q22: When should the latency budget itself drive a major redesign — cache layer, edge, or async — rather than incremental tuning?**

> When the *sum of the irreducible costs on the synchronous path exceeds the budget*, no amount of tuning closes the gap, and that's the signal to change the architecture. Concretely:
>
> - If a cross-region round-trip (~150 ms) is on the critical path and the budget is 100 ms, physics says you can't get there synchronously — you need an **edge/regional** presence or a **cache** near the user, because you can't tune the speed of light.
> - If an inherently slow computation (ranking, aggregation, third-party call) dominates and tolerates staleness, you **precompute or cache** it off the path.
> - If the slow work isn't needed for the first paint, you make it **async** and stream it in.
>
> The test I apply: "Add up the floor costs — network physics, mandatory DB reads, mandatory compute. If that floor is already above the budget, optimization is hopeless and the answer is to remove work from the path." Incremental tuning is for when you're *over* budget but the floor is *under* it. Knowing which regime you're in — and saying so to stakeholders before committing a quarter to micro-optimizations — is the staff-level call.

**Q23: How do you set a budget when traffic is bursty and the tail you care about is p99.9, not p99?**

> p99.9 is a different animal: at 1M requests/day it's the slowest ~1,000 requests, and at high fan-out it's the *typical* page (a page with 100 backend calls hits *some* p99.9 on roughly 1 − 0.999^100 ≈ 9.5% of loads). So for fan-out-heavy, high-revenue flows I budget at p99.9 and accept that the gap between p99 and p99.9 is dominated by rare events — GC pauses, failovers, retries, cold starts. The budget then includes *explicit* allowances for those: a GC-pause reserve, a retry budget (one retry must still fit inside the deadline), and a hedge to mask single-replica stalls. For bursty traffic I budget at the *burst* utilization, not the average, because the queueing blow-up at the burst peak is exactly where p99.9 lives. The mistake is averaging the burst away; the tail you're paid to protect is created by the peak.

**Q24: What's the most common latency-budgeting mistake you've seen senior engineers make, and how do you guard against it?**

> Budgeting at the average and treating tails as someone else's problem — then being shocked when the composed system is slow despite every component "meeting its SLO." The root cause is forgetting that (a) percentiles don't add, (b) fan-out drags the median toward the tail via 1 − (1 − p)^N, and (c) your benchmark, run at low utilization with coordinated omission, hid the real distribution. My guardrails: budget and alert at a *tail* percentile chosen for the fan-out width; measure end-to-end distributions directly rather than composing per-hop percentiles; use load tools that correct for coordinated omission; propagate deadlines so the budget is enforced, not just documented; and keep utilization below the queueing knee so the budget survives peak. In short — respect the tail, enforce with deadlines, and measure honestly. Everything else is arithmetic.

---

*Next step:* [Number Tables](../../04-back-of-envelope/01-number-tables/junior.md)
