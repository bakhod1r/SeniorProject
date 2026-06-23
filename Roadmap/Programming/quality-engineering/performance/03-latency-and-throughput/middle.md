# Latency and Throughput — Middle Level

> **Roadmap:** [Performance](../README.md) → Latency and Throughput
> *The junior page defined the words. This page gives you the math that binds them: Little's Law, the queue that explains why a half-idle server still has a slow tail, and the curve that explains why "add 10% more traffic" can turn a healthy service into a smoking one.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Little's Law — the Identity That Ties It All Together](#littles-law--the-identity-that-ties-it-all-together)
4. [Service Time vs Wait Time vs Response Time](#service-time-vs-wait-time-vs-response-time)
5. [The Latency–Load Curve and the Knee](#the-latencyload-curve-and-the-knee)
6. [Queueing Intuition — Why 80% Utilization Already Hurts](#queueing-intuition--why-80-utilization-already-hurts)
7. [Percentiles Done Right](#percentiles-done-right)
8. [Moving the Curve — Batching, Pipelining, Concurrency](#moving-the-curve--batching-pipelining-concurrency)
9. [Worked Example — A Capacity Calculation with Little's Law](#worked-example--a-capacity-calculation-with-littles-law)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is the math underneath latency and throughput, and how do I measure it under realistic load?**

At the junior level latency and throughput are two numbers you read off a dashboard. That model is fine until something breaks the relationship between them — and it always does. It can't explain why a service that handles 1,000 requests per second at 20 ms suddenly handles the same 1,000 at 400 ms when one downstream dependency slows down; why a load test that shows "p99 = 15 ms" lies about production; or why a server sitting at 70% CPU has a perfectly healthy median and a tail latency that's three times worse than it was at 50%.

The answers are not mysterious — they're arithmetic. **Little's Law** ties throughput, latency, and concurrency into a single identity you cannot violate. **Queueing theory** explains the curve that bends latency upward as you approach saturation. And **percentile statistics**, done correctly, are the only honest way to report what users actually experience. This page makes all three concrete, with numbers you can reproduce and the tools (`HdrHistogram`, `wrk2`, Prometheus histograms) that measure them without lying to you.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can define latency, throughput, and percentiles informally.
- **Required:** Comfortable reading a basic time-series dashboard (requests/sec, p50/p99 latency).
- **Helpful:** You've run a load test, even a naive one (`ab`, `hey`, `wrk`).
- **Helpful:** A rough memory of high-school algebra — Little's Law is one multiplication.

---

## Little's Law — the Identity That Ties It All Together

Little's Law is the single most useful equation in performance work, and it's almost embarrassingly simple:

```
L = λ × W
```

- **L** = the average number of requests *in the system* at any instant (concurrency in flight).
- **λ** (lambda) = the average arrival rate, i.e. **throughput** (requests per second).
- **W** = the average time a request *spends in the system* (response time / latency).

It holds for *any* stable system — any queue, any service, any subsystem — regardless of arrival distribution, service-time distribution, or scheduling discipline. The only requirement is that the system is in steady state (what comes in eventually goes out; the queue isn't growing without bound). That generality is what makes it a law and not a model.

Rearranged, it gives you the form you'll actually use most:

```
concurrency  =  throughput  ×  latency
        L     =      λ       ×    W
```

> **Key insight:** Throughput and latency are not independent dials you can set separately. They are joined at the hip by the concurrency you can sustain. If your latency goes up and your concurrency limit stays fixed, your throughput **must** fall. This is why "the service got slower" and "the service handles less traffic" are usually the *same event* viewed from two sides.

A concrete read: if your API handles **λ = 2,000 req/s** and each request takes **W = 50 ms = 0.05 s**, then the average number of requests being processed concurrently is `L = 2,000 × 0.05 = 100`. You need roughly 100 units of concurrency — threads, goroutines, connection slots — in flight to sustain that rate. Size your thread pool or connection pool below that and you cap throughput *before* the CPU is the bottleneck.

```go
// Little's Law as a sizing check, not an afterthought.
// Target: 2000 req/s, measured mean latency 50ms.
const targetRPS = 2000.0
const meanLatencySec = 0.050

inFlight := targetRPS * meanLatencySec // = 100
// => a worker pool / DB connection pool of ~100 is the floor.
// Provision below this and throughput is capped by queueing, not by CPU.
fmt.Printf("need ~%.0f concurrent slots\n", inFlight)
```

The law also works as a *diagnostic*. Measure any two terms and the third is forced. If you observe 100 in-flight requests and 2,000 req/s, then mean latency is *necessarily* 50 ms — if your latency dashboard disagrees, one of your instruments is wrong. Engineers waste days debugging "impossible" numbers that Little's Law would have flagged in thirty seconds.

---

## Service Time vs Wait Time vs Response Time

Before the curve makes sense, three terms have to stop being synonyms. They are not.

| Term | What it measures | Where it lives |
|---|---|---|
| **Service time** (S) | Time actually *doing the work* once started | CPU, I/O — the useful part |
| **Wait time** (Wq) | Time spent *queued*, waiting for a free server | The queue, doing nothing |
| **Response time** (W) | What the user feels: `W = Wq + S` | The sum of both |

A request that takes 50 ms might be 5 ms of real work and 45 ms sitting in a queue behind other requests. The CPU profile (see [02 — Benchmarking](../02-benchmarking-and-microbenchmarks/middle.md)) will only ever show you the 5 ms of *service* time — it is blind to the 45 ms of *wait*. This is the single most common reason a profiler says "the code is fast" while users say "the service is slow."

> **Key insight:** Profilers measure **service time**; users experience **response time**. The gap between them is **wait time**, and wait time is invisible to almost every code-level tool. When the profile looks clean but the latency is bad, stop profiling the code and start measuring the queue.

This decomposition is why "optimize the slow function" so often fails to move the dashboard. If 90% of your response time is queueing, halving your service time barely dents `W`. You don't have a code problem; you have a *capacity* problem — and the next two sections are about exactly that.

---

## The Latency–Load Curve and the Knee

Plot response time (y-axis) against load (x-axis, requests per second or utilization) and you get one of the most important shapes in systems engineering:

```
response
 time W │                                        ╱  ← latency explodes
        │                                       ╱
        │                                     ╱
        │                                  ╱    ← the "knee" / hockey stick
        │  ____________________________╱
        │ /  flat: latency ≈ service time
        └─────────────────────────────────────────► load (λ or utilization)
          low                  ~70-80%          ~100%
```

For most of the range, latency is **flat** — it sits near the bare service time because requests rarely wait. Then, somewhere past 70–80% utilization, the curve bends sharply upward (the **knee**, or **hockey stick**) and latency climbs toward infinity as utilization approaches 100%. It does not climb gently. It *explodes*.

The brutal practical consequence: the difference between a healthy service and a melting one is often a *tiny* increase in load that happens to push you over the knee. A system at 65% utilization that absorbs a 20% traffic bump moves to ~78% — and its p99 can double or triple while its *median* barely moves. Your median dashboard says "fine." Your users are timing out. This is why capacity planning targets a utilization *well below* 100% — you're not leaving the headroom idle out of waste, you're leaving it so you stay on the flat part of the curve.

> **Key insight:** Latency does not degrade linearly with load. It stays flat, then detonates at the knee. "We have 30% headroom" is a dangerous statement if that 30% is on the far side of the knee — past it, headroom is measured in latency, not in spare capacity.

---

## Queueing Intuition — Why 80% Utilization Already Hurts

Where does the knee come from? Queueing theory gives the answer in one formula. For a simple single-server queue with random arrivals (an M/M/1 model), the average time a request waits *relative to its service time* is:

```
                    ρ
wait factor  =  ─────────       where ρ (rho) = utilization (0 to 1)
                  1 − ρ
```

Plug in numbers and the shape jumps out:

| Utilization ρ | Wait ÷ service time |
|---|---|
| 50% | 1.0× (wait equals the work itself) |
| 70% | 2.3× |
| 80% | 4.0× |
| 90% | 9.0× |
| 95% | 19.0× |
| 99% | 99.0× |

At 50% utilization a request already waits about as long as it takes to serve. At 80%, it waits *four times* the service time. At 99%, it waits a hundred times. The denominator `(1 − ρ)` is the villain: as ρ approaches 1, it approaches 0, and the ratio blows up. That `1/(1−ρ)` term **is** the hockey stick.

> **Key insight:** Utilization is not a "how busy" number — it's a *latency amplifier*. The cost of the next percent of utilization is not constant; it's governed by `1/(1−ρ)`, which is cheap at 50% and ruinous at 95%. This is the mathematical reason mature teams run hot paths at 60–70%, not 95%, and treat "high utilization" as a *risk*, not an *efficiency win*.

Two refinements that matter in real systems:

1. **Variability makes it worse.** The clean formula assumes random (Poisson) arrivals and exponential service times. Real traffic is *burstier* and real service times are *more variable* (some requests hit cache, some hit disk). More variability shifts the knee *left* — you hit the wall earlier. The Kingman approximation captures this: wait time scales with `(C²a + C²s)/2`, the average of arrival and service-time variability. Cut variability and you buy back headroom for free.
2. **More servers help super-linearly near the knee.** An M/M/c queue (c parallel servers) flattens the curve dramatically compared to one big server of equivalent total capacity, because a free server can pick up a queued request instead of it waiting behind a busy one. This is the quantitative argument for horizontal scaling and for shared work queues over per-worker queues.

---

## Percentiles Done Right

Averages lie about latency because latency distributions are heavy-tailed: a few very slow requests pull the mean around while most users see something much faster. So we report **percentiles** — p50 (median), p99, p99.9. But percentiles are easy to compute *wrong*, and wrong percentiles are worse than no percentiles because they look authoritative.

**How a percentile is actually computed.** Sort all latencies; pX is the value below which X% of samples fall. The naive way — store every sample and sort — is correct but uses unbounded memory at scale. So real systems use **bounded-error data structures**:

- **HdrHistogram** (High Dynamic Range Histogram): pre-allocated buckets across a configured value range, with *guaranteed* relative error (e.g. ±0.1%). It records billions of values in fixed memory and computes any percentile in O(buckets). This is the gold standard for latency.
- **Prometheus histograms**: fixed, *manually chosen* buckets (`le="0.005"`, `le="0.01"`, …). Percentiles are *interpolated* between bucket boundaries — so your p99 is only as accurate as your bucket layout. Put no buckets between 100 ms and 1 s and your p99 in that range is a guess.
- **Prometheus summaries**: compute percentiles *client-side* per instance over a sliding window. Cheap to read, but — critically — **you cannot aggregate them across instances**.

> **Key insight:** **You cannot average percentiles.** The mean of host A's p99 and host B's p99 is *not* the fleet p99 — there is no arithmetic that recovers it from the two numbers, because a percentile is a property of a *distribution*, not a value you can average. To get a real fleet-wide p99 you must merge the underlying *histograms* (add the bucket counts) and recompute. This is the entire reason Prometheus histograms beat summaries for distributed systems: histograms are mergeable; summaries are not.

```go
import "github.com/HdrHistogram/hdrhistogram-go"

// Range 1µs..60s, 3 significant digits of precision.
h := hdrhistogram.New(1, 60_000_000, 3) // values in microseconds

for _, latency := range observed {
    h.RecordValue(latency.Microseconds())
}

fmt.Printf("p50  = %d µs\n", h.ValueAtQuantile(50))
fmt.Printf("p99  = %d µs\n", h.ValueAtQuantile(99))
fmt.Printf("p99.9= %d µs\n", h.ValueAtQuantile(99.9))

// Two hosts? Merge histograms, THEN read the percentile — never average p99s.
fleet := hdrhistogram.New(1, 60_000_000, 3)
fleet.Merge(hostA)
fleet.Merge(hostB)
fmt.Printf("fleet p99 = %d µs\n", fleet.ValueAtQuantile(99))
```

```java
// Java: HdrHistogram (Gil Tene's reference implementation).
Histogram h = new Histogram(60_000_000_000L, 3); // 1ns..60s range, 3 sig digits
for (long nanos : observed) h.recordValue(nanos);
System.out.printf("p99   = %d ns%n", h.getValueAtPercentile(99.0));
System.out.printf("p99.9 = %d ns%n", h.getValueAtPercentile(99.9));
```

One more trap, named by the same author: **coordinated omission**. If your load generator sends a request, waits for the (slow) response, and only *then* sends the next, it never measures the latency that the *backlogged* requests would have seen — it accidentally stops sending during the slow period. The result wildly understates the tail. `wrk2` exists specifically to fix this: it sends at a *fixed schedule* regardless of when responses arrive, and attributes the full intended-vs-actual delay to each request. Use `wrk2`, not `wrk`, for any latency claim.

---

## Moving the Curve — Batching, Pipelining, Concurrency

The whole point of understanding the curve is to *move* it. Three levers do most of the work, and each trades latency and throughput differently:

**Batching** amortizes per-operation fixed cost across many items — one round trip, one syscall, one transaction for N items. It *raises throughput* but *adds latency* to the items that wait for the batch to fill. A 10 ms batch window can 5× your throughput while adding up to 10 ms to each request. Good when throughput is the goal (ingestion, logging, bulk writes); bad on an interactive path.

```go
// Batching: trade a little latency for a lot of throughput.
batch := make([]Item, 0, 100)
ticker := time.NewTicker(10 * time.Millisecond) // max latency added
for {
    select {
    case item := <-in:
        batch = append(batch, item)
        if len(batch) == cap(batch) {
            flush(batch); batch = batch[:0]
        }
    case <-ticker.C:
        if len(batch) > 0 { flush(batch); batch = batch[:0] }
    }
}
```

**Pipelining** overlaps the stages of independent requests so a stage isn't idle waiting for the previous request to finish all stages. It raises throughput *without* the latency penalty of batching — request latency stays roughly constant while throughput rises toward the slowest stage's rate. HTTP/2 multiplexing and Redis pipelining are the canonical examples.

**Concurrency** is the Little's Law lever: raise `L` (more workers/connections) and you raise the throughput `λ` you can sustain at a given latency `W`. But only up to the point where a *shared resource* saturates — then adding concurrency just lengthens the queue and `W` climbs (see [06 — Concurrency and Contention](../06-concurrency-and-contention/middle.md)). There's an optimal concurrency: at it, throughput peaks; past it, throughput is flat or falling while latency keeps rising. Finding that point empirically (a load sweep) beats guessing.

> **Key insight:** Batching trades latency *for* throughput. Pipelining and concurrency try to buy throughput *without* paying latency — until a shared resource saturates, after which more concurrency buys only longer queues. Know which lever you're pulling and what it costs on the *other* axis.

---

## Worked Example — A Capacity Calculation with Little's Law

You're sizing a payment service. Requirements and measurements:

- Target throughput: **λ = 5,000 req/s** at peak.
- Measured mean response time at low load: **W = 40 ms = 0.04 s** (service time ≈ 30 ms, network ≈ 10 ms).
- Each request holds one database connection for its full duration.
- Your DB connection pool is currently **80** connections.

**Step 1 — How much concurrency does the target demand?**

```
L = λ × W = 5,000 × 0.04 = 200 in-flight requests
```

You need ~200 requests in flight on average. With each holding a connection, you need ~200 connections — but you have 80.

**Step 2 — What happens with only 80 connections?** The pool caps concurrency at `L = 80`. Rearranging Little's Law, the *maximum* throughput the pool can sustain at 40 ms latency is:

```
λ_max = L / W = 80 / 0.04 = 2,000 req/s
```

The pool throttles you to 2,000 req/s — **40% of target** — purely from connection starvation, long before the database CPU is stressed. The remaining 3,000 req/s queue *waiting for a connection*, so their response time balloons (wait time, not service time). Your DB looks healthy; your service is dying.

**Step 3 — Right-size, with headroom.** To hit 5,000 req/s at 40 ms you need `L = 200`. But you don't size for the *average* — bursts and variance push instantaneous concurrency higher, and you want to stay on the flat part of the curve. Add ~30–50% headroom:

```
pool size ≈ 200 × 1.4 ≈ 280 connections
```

**Step 4 — Sanity-check the *other* side.** 280 connections × the DB's per-connection memory and the DB's own connection limit must both be affordable. If the database can't handle 280 connections, the bottleneck moves *into* the DB and you need a different fix — connection multiplexing (PgBouncer), read replicas, or cutting `W` so each connection frees up faster. Little's Law doesn't tell you *which* fix; it tells you *how big the gap is* and where to look.

The discipline here is the lesson: **measure two terms, solve for the third, then check the constraint on every resource the third term touches.** That turns "the service feels slow under load" into "the pool caps us at 2,000 req/s; we need 280 connections or a 16 ms latency."

---

## Mental Models

- **Little's Law is a conservation law, not a tuning tip.** You cannot cheat `L = λ × W` any more than you can cheat conservation of mass. If two of the three move, the third *must* move to balance. Most performance "mysteries" are this identity being honored while you weren't watching one of the terms.

- **Utilization is a latency multiplier, not a fuel gauge.** A fuel gauge at 90% means 10% left. Utilization at 90% means latency is ~9× the service time and one bad burst from the cliff. Read ρ as risk, not as spare capacity.

- **The profiler sees the work; the queue sees the wait.** Service time is what your CPU profile shows. Response time is what the user feels. The difference is queueing, and it's invisible to code-level tools. When the profile is clean and the latency is bad, the problem is upstream of the code.

- **A percentile is a property of a distribution, not a number you can average.** You merge the histograms, then read the percentile. Averaging p99s across hosts is a category error that produces a confident, wrong number.

- **The load test that doesn't pace itself is lying to you.** Coordinated omission makes a closed-loop generator skip exactly the slow moments you care about. Open-loop, fixed-rate generation (`wrk2`) is the only kind whose tail numbers you can trust.

---

## Common Mistakes

1. **Reporting the average latency.** The mean is dominated by neither the typical user (median) nor the suffering ones (tail). It describes nobody. Report p50/p99/p99.9, always.

2. **Averaging percentiles across hosts or time windows.** There is no arithmetic that recovers a fleet p99 from per-host p99s. Merge histograms and recompute, or use a mergeable representation (Prometheus histograms) from the start.

3. **Sizing pools for average concurrency with no headroom.** `L = λ × W` gives the *average*; bursts and variance run hotter. Size above the average so you stay on the flat part of the curve, not on the knee.

4. **Load-testing with a closed-loop generator (`wrk`, naive `ab` loops).** Coordinated omission hides the tail. Use `wrk2` or any fixed-rate (open-loop) generator for latency numbers.

5. **Targeting high utilization as an efficiency win.** Running a latency-sensitive service at 90% looks "efficient" and behaves like a time bomb — `1/(1−ρ)` says latency is already ~9× service time and the next burst is the cliff. Plan for 60–70% on hot paths.

6. **Optimizing service time when the cost is wait time.** If 80% of `W` is queueing, halving the code's runtime barely moves the dashboard. Decompose `W` into wait + service *before* deciding what to optimize.

7. **Trusting Prometheus histogram percentiles with bad buckets.** Interpolation is only as good as your bucket boundaries. If your real latency lives in a range with no buckets, the computed percentile is fiction. Set buckets to straddle your SLO.

---

## Test Yourself

1. State Little's Law and define each term operationally (what you'd measure for each).
2. A service handles 4,000 req/s with a mean response time of 25 ms. How many requests are in flight on average? How big should the worker pool be, roughly?
3. Why does a CPU profiler often show "fast" code for a service whose users report slow responses? Name the missing quantity.
4. At 90% utilization, roughly how much longer does a request wait (relative to its service time) than at 50%? Why is the growth not linear?
5. Why can't you compute a fleet-wide p99 by averaging each host's p99? What must you do instead?
6. What is coordinated omission, and which tool avoids it?

<details>
<summary>Answers</summary>

1. `L = λ × W`. **L** = average requests in flight (count them, e.g. active connections/goroutines). **λ** = throughput (requests completed per second). **W** = mean response time (arrival to completion, including queue wait).
2. `L = 4,000 × 0.025 = 100` in flight. The pool floor is ~100; with headroom for bursts, ~130–150.
3. The profiler measures **service time** (work on the CPU); users feel **response time** = wait + service. The missing quantity is **wait time** — time queued waiting for a free server — which code-level profilers don't see.
4. At 50%, wait ≈ 1.0× service (`ρ/(1−ρ) = 0.5/0.5`). At 90%, wait ≈ 9.0× (`0.9/0.1`). It's not linear because the denominator `(1−ρ)` shrinks toward zero, so cost per extra percent of utilization grows explosively — that's the knee.
5. A percentile is a property of a distribution; there's no formula to recombine two p99s into the merged distribution's p99. You must merge the underlying **histograms** (sum bucket counts) and recompute the percentile from the merged histogram.
6. A closed-loop load generator waits for each (slow) response before sending the next, so it stops sending exactly during slow periods and never measures the backlog the tail would have seen — understating the tail. **`wrk2`** sends at a fixed schedule and corrects for it.

</details>

---

## Cheat Sheet

```
LITTLE'S LAW (any stable system)
  L = λ × W        L = in-flight,  λ = throughput,  W = response time
  concurrency = throughput × latency
  λ_max = L / W    ← max throughput a fixed pool sustains at latency W
  pool size ≈ (λ × W) × 1.3–1.5   (average + headroom for bursts)

TIME DECOMPOSITION
  response time W = wait time Wq + service time S
  profiler sees S;  user feels W;  the gap (Wq) is queueing, invisible to code tools

UTILIZATION → WAIT (M/M/1)
  wait ÷ service = ρ / (1 − ρ)
  50%→1×   70%→2.3×   80%→4×   90%→9×   95%→19×   99%→99×
  run hot paths at 60–70%; treat high ρ as RISK, not efficiency

PERCENTILES
  never average percentiles across hosts/windows — merge histograms, recompute
  HdrHistogram   → bounded relative error, mergeable        (gold standard)
  Prom histogram → fixed buckets, interpolated, MERGEABLE   (use across instances)
  Prom summary   → client-side, NOT mergeable               (single instance only)
  set buckets to straddle your SLO

MEASURING UNDER LOAD
  use wrk2 (open-loop, fixed rate) — avoids COORDINATED OMISSION
  closed-loop (wrk/ab loop) hides the tail

LEVERS
  batching     +throughput, +latency  (amortize fixed cost)
  pipelining   +throughput, ~latency  (overlap stages)
  concurrency  +throughput up to shared-resource saturation, then +latency only
```

---

## Summary

- **Little's Law** (`L = λ × W`) binds throughput, latency, and in-flight concurrency into one identity that holds for any stable system. Rearranged as `concurrency = throughput × latency`, it sizes pools and diagnoses "impossible" numbers in seconds.
- **Response time = wait time + service time.** Profilers measure only service time; the wait time is queueing and is invisible to code-level tools. When the profile is clean but latency is bad, the problem is the queue.
- The **latency–load curve** is flat until ~70–80% utilization, then bends sharply upward at the **knee**. Latency degrades non-linearly, governed by `1/(1−ρ)` — at 90% utilization a request waits ~9× its service time. Run hot paths well below 100% on purpose.
- **Percentiles** describe the distribution; the average describes nobody. You cannot average percentiles across hosts — merge histograms and recompute. Use **HdrHistogram** or mergeable Prometheus histograms, never client-side summaries, for fleet-wide tails.
- Measure under **realistic, open-loop load** (`wrk2`) to avoid **coordinated omission**, which silently hides the tail you most need to see.
- **Batching, pipelining, and concurrency** move the curve with different latency/throughput trade-offs; know which lever you're pulling and what it costs on the other axis.

---

## Further Reading

- *The Tail at Scale* — Dean & Barroso. The canonical paper on why p99 dominates user experience at scale and how to fight it.
- *How NOT to Measure Latency* — Gil Tene (talk). Coordinated omission, HdrHistogram, and why your latency numbers are probably wrong.
- *Systems Performance* — Brendan Gregg. The USE method, utilization, saturation, and queueing in practice.
- *Performance Modeling and Design of Computer Systems* — Mor Harchol-Balter. The rigorous treatment of queueing theory behind the intuition here.
- `wrk2` and `HdrHistogram` repositories — the tools, with READMEs that double as primers on correct latency measurement.

---

## Related Topics

- [junior.md](junior.md) — the definitions and dashboards this page formalizes.
- [senior.md](senior.md) — tail-tolerance techniques, hedged requests, SLOs, and load-shedding at the architecture level.
- [02 — Benchmarking and Microbenchmarks](../02-benchmarking-and-microbenchmarks/middle.md) — measuring service time honestly, the input to every latency calculation here.
- [06 — Concurrency and Contention](../06-concurrency-and-contention/middle.md) — what saturates when you push the concurrency lever past its optimum.
