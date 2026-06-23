# Performance & Load Testing — Interview Level

> **Roadmap:** [Testing](../README.md) → Performance & Load Testing

*Interviewers probe performance testing to find two things fast: do you report tail latency or hide behind averages, and do you know that coordinated omission and environment parity quietly make most reports wrong?*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Workload Models & Percentiles](#workload-models--percentiles)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **answering performance-and-load-testing interview questions with the precision that distinguishes someone who has *run and interpreted* load tests from someone who has only read about them.**

The tells of depth are specific: you say "p99," not "average"; you name the test type that fits the question; you know that closed-model tools under-report the tail (coordinated omission); and you treat a load test as a *prediction under synthetic load*, paired with production observability. This page is a question bank in **Q / what's really being tested / A** format. Keep answers concrete — name tools, quote numbers, state limits.

---

## Prerequisites

- The four metric families: throughput, latency distribution, error rate, saturation.
- Percentiles vs. average; why tail latency is the user experience.
- The test family: load, stress, spike, soak, scalability, capacity.
- Closed vs. open workload models and coordinated omission.
- Where fixing lives: `../../performance/`. Where the gap is covered: `../13-testing-in-production/`.

---

## Fundamentals

**Q1. What is the difference between a load test, a stress test, and a soak test?**
*What's really being tested: do you know these answer distinct questions, or do you treat "load testing" as one thing?*
**A.** A **load test** verifies the system meets its SLOs at *expected peak* — "can we serve 500 req/s under p99 < 300 ms?" A **stress test** pushes *past* peak to find the breaking point and observe *how* it fails (graceful shedding vs. crash). A **soak/endurance test** holds moderate load for *hours* to expose slow killers — memory leaks, connection-pool exhaustion, log disks filling — that a short test never sees. Different goals; not interchangeable. I'd add spike (sudden surge), scalability (does adding capacity help?), and capacity (how many users until SLO breach?).

**Q2. Why is the average latency a misleading metric?**
*What's really being tested: the single most important concept in the topic.*
**A.** Latency is heavy-tailed and right-skewed, not normally distributed, so the mean is dragged by outliers and represents *no actual user*. Example: nine requests at 50 ms and one at 2000 ms average to 247 ms — but nobody experienced 247 ms; nine had a fast 50 ms and one waited 2 s. The average *hides* the slow tail. The user experience lives in the tail, so I report p50/p95/p99/p99.9. At a page making 20 backend calls, one call hits p95 — so p95 is roughly "the slowest part of a typical page."

**Q3. Why does p99 matter more than it looks, especially at scale?**
*What's really being tested: tail-latency intuition.*
**A.** p99 means 1 in 100 requests is at least that slow. Power users who click a lot hit it constantly, and fan-out amplifies it: a request that calls 100 services and waits for all of them will *usually* hit one service's p99 — so the *system* tail is dominated by the *component* tails. At a million requests, p99.9 is a thousand affected requests. Tail latency, not the median, defines perceived reliability at scale.

**Q4. What are the four golden signals you read in a load test?**
*What's really being tested: structured result interpretation.*
**A.** Throughput (completed req/s — not injected), latency distribution (percentiles, not average), error rate (broken down by 4xx/5xx/timeout/conn-reset), and saturation (CPU/memory/pool/queue from the *server's* telemetry). I read latency and errors *together*: low latency with a high error rate is a failing test wearing a smile — fast failures are still failures. Saturation is the cause; latency and errors are the symptom.

---

## Technique

**Q5. Walk me through designing a sound load test.**
*What's really being tested: methodology, not tool trivia.*
**A.** (1) State the question and the SLO as the pass criterion. (2) Model a realistic workload: production request mix (e.g., 80% browse / 20% checkout), think time between actions, and data variety so I'm not just testing the cache. (3) Shape the load: warm-up (exclude from measurement so JIT/caches don't pollute it), steady state (measure here, for minutes), ramp-down. (4) Isolate the variable — change one thing per run. (5) Run on a prod-like environment, especially data volume. Without an SLO it has no verdict; without realism it has no validity.

**Q6. Show me a minimal k6 test and a Locust test.**
*What's really being tested: hands-on familiarity.*
**A.** k6 (JavaScript, open model via arrival-rate):
```javascript
import http from 'k6/http';
import { check } from 'k6';
export const options = {
  scenarios: { rate: {
    executor: 'constant-arrival-rate',
    rate: 500, timeUnit: '1s', duration: '5m',
    preAllocatedVUs: 200, maxVUs: 1000,
  }},
  thresholds: { http_req_duration: ['p(99)<300'], http_req_failed: ['rate<0.001'] },
};
export default function () {
  const r = http.get('https://api.example.com/products');
  check(r, { '200': (x) => x.status === 200 });
}
```
Locust (Python, weighted tasks = request mix, `wait_time` = think time):
```python
from locust import HttpUser, task, between
class U(HttpUser):
    wait_time = between(1, 4)
    @task(8)
    def browse(self):  self.client.get("/products/1", name="/products/[id]")
    @task(2)
    def checkout(self): self.client.post("/cart/checkout", json={"item": "p-1"})
```
I'd note k6's `thresholds` make the run self-gating for CI, and that Locust is closed-model by default.

**Q7. How do you put a performance test into CI without it being flaky?**
*What's really being tested: the noise problem.*
**A.** Two tiers: fast micro-benchmarks per PR, a full load test nightly/pre-release. The killer is noise from shared runners — a naive "fail if p99 rose" gate fires constantly and gets disabled. Fixes: compare *distributions* over N runs with a significance test (e.g., Go's `benchstat`), set the threshold *above* the measured CI noise floor (measure variance by running the same commit 20×), use pinned/quiet runners, exclude warm-up, and track the *trend* over time, not just the single gate. A gate that cries wolf is worse than no gate.

**Q8. A load test passes but production is slow. What went wrong?**
*What's really being tested: knowing the limits of the test.*
**A.** Likely candidates: (1) **Coordinated omission** — a closed tool hid the tail. (2) **Environment parity** — small test dataset kept everything cached; prod has 50M rows and slow scans. (3) **Unrealistic workload** — wrong mix, no data variety, no real session flow, missing data hotspots. (4) **Synthetic ≠ real** — real traffic patterns, dependency brownouts, retry storms the test never modelled. A load test predicts under synthetic load in a test env; the gaps are exactly why you pair it with testing-in-production and observability.

---

## Workload Models & Percentiles

**Q9. Explain closed vs. open workload models and why it matters.**
*What's really being tested: the subtle concept that separates depth from surface.*
**A.** **Closed:** a fixed number of virtual users, each waits for its response before sending the next — in-flight requests are capped at N, so the system *self-throttles*; if it slows, VUs send less. **Open:** requests arrive at a fixed *rate* regardless of responses — if the system slows, arrivals pile up. Open models real traffic (users keep showing up; they don't wait for your server to recover) and exposes queue collapse; closed *hides* overload. So capacity planning and SLO validation should use open (k6 `constant-arrival-rate`, Gatling). In k6 that's `arrival-rate` executors vs. `constant-vus`.

**Q10. What is coordinated omission, and how do you avoid it?**
*What's really being tested: the marquee measurement bug — strong signal of real experience.*
**A.** When a closed tool's request stalls (say the server pauses 1 s during GC), the tool is *blocked waiting* and doesn't send the requests it was scheduled to send during that second — it *omits* exactly the requests that would have shown the tail, recording one slow request instead of the ~10 that real clients would have suffered. The error is always optimistic and can be 10–90× in the tail. Avoid it with an open/arrival-rate generator (and provision enough `maxVUs` so it never stalls — watch `dropped_iterations`), or use wrk2/vegeta which are rate-based and back-fill the omitted latencies. Plain wrk has CO; wrk2 exists specifically to fix it.

**Q11. Worked example — give the honest p99 for a stall.**
*What's really being tested: can you reason about CO numerically?*
**A.** 10,000 requests at 1000 req/s, all 10 ms except one 1 s server stall. A naive closed tool records 9,999 × 10 ms + one 1000 ms → p99 ≈ 10 ms; the stall is 1 in 10,000 and vanishes. But during that 1 s stall, ~100 requests at the 10 ms cadence were in-flight or due, waiting 1000, 990, ..., 10 ms — so the *honest* p99 is ~900 ms. Same system, 90× difference, and the optimistic one is what naive tools report.

---

## Scenarios

**Q12. We're launching a flash sale with autoscaling. How do you load-test it?**
*What's really being tested: distributed-systems and transient awareness.*
**A.** A **spike test**, and critically I test the *transient*, not just the plateau — autoscaling lag (60–300 s to warm capacity) is where SLOs breach even though steady-state capacity is fine. I'd model the real surge shape, watch SLOs during the ramp, verify backpressure (429/503, circuit breakers, rate limits) engages gracefully, and confirm the *shared* tier (DB, cache, queue) survives — the bottleneck often moves off the app nodes. Generators must be distributed so they're not the limit. Then validate fixes: pre-warming, faster scaling policies.

**Q13. How do you turn a load test into a capacity number?**
*What's really being tested: capacity planning from results.*
**A.** From a capacity test, find per-unit throughput at the SLO — e.g., one node sustains 800 req/s at p99 = 250 ms. For 5000 req/s peak: 5000/800 ≈ 7 nodes; divide by a utilisation target for headroom (÷0.6 ≈ 12 nodes) to cover spikes, failover, deploys. Two cautions: linear per-node math breaks once a *shared* resource saturates (a scalability test checks whether adding nodes actually raises throughput or the DB caps it), and never provision for exactly the measured peak. I'd use the `system-design-estimation` skill's method here.

**Q14. You found p99 is too high. What's your next step?**
*What's really being tested: do you respect the testing/fixing boundary?*
**A.** Locate the bottleneck by correlating the load tool's latency/error timeline with the server's saturation telemetry on the same clock — at the instant p99 bends up, see what hit a limit: CPU pegged (hot path), pool at max with low CPU (connection starvation), DB CPU high (slow query/missing index), sawtooth memory (GC). That tells me *where*. The actual fix — index, cache, pool size, algorithm — is the Performance section's job (`../../performance/`); the load test's job is to measure and localise, then verify the fix moved the number.

**Q15. How is load testing in production different, and when would you do it?**
*What's really being tested: maturity about the synthetic-vs-real gap.*
**A.** Synthetic tests can't reproduce real traffic patterns, data hotspots, exact topology, or emergent failures. Testing in production — canary releases, shadow/dark traffic, careful controlled load — uses real infrastructure and real requests, closing that gap (and saving the cost of a separate prod-scale fleet). It's higher-risk: needs feature flags, a kill switch, synthetic-traffic tagging, and blast-radius control. I'd use it for what staging fundamentally can't replicate, alongside (not instead of) pre-prod load tests. Details in `../13-testing-in-production/`.

---

## Rapid-Fire

**Q16. Throughput: injected or completed — which do you report?** Completed; injected RPS during overload is fiction.

**Q17. One tool that fixes coordinated omission?** wrk2 (or vegeta; k6 arrival-rate executors).

**Q18. Default model in k6 `constant-vus`?** Closed. `constant-arrival-rate` is open.

**Q19. Why exclude warm-up from measurement?** JIT compilation, cache fill, and pool opening pollute the window with non-steady-state latency.

**Q20. Soak test catches what load test misses?** Slow accumulation: memory leaks, pool/FD/disk exhaustion over hours.

**Q21. p50=50 ms, p99=2 s — what does the spread tell you?** Something punishes a minority hard — GC, lock contention, a cold path. Wide spread = inconsistency.

**Q22. SLA vs SLO?** SLO is the internal target; SLA is the external, contractual promise (with penalties). Load tests validate against the SLO.

**Q23. Testing the same product ID 10,000 times measures what?** Your cache, not your system. Need data variety.

**Q24. Stress test in production without coordination — problem?** It's a self-inflicted DoS; on-call mistakes it for a real incident. Coordinate, tag, keep a kill switch.

**Q25. Gatling's defining feature?** Open workload model by design (and Scala DSL).

**Q26. Why per-endpoint SLOs?** Checkout and a health check don't share a latency budget; tag and threshold separately.

**Q27. The classic cultural anti-pattern?** The one-time pre-launch load test, never re-run as code/data/traffic evolve.

---

## Red Flags / Green Flags

**Red flags**
- Reports the **average** latency; never mentions percentiles or the tail.
- Has never heard of **coordinated omission**, or trusts a beautiful p99.9 from a closed tool at high load.
- Treats load/stress/soak as synonyms.
- Quotes laptop or tiny-dataset numbers as production guarantees.
- Reports low latency while ignoring a high error rate.
- Thinks a load test *proves* production will be fine.
- Load-tests once before launch and considers it done.

**Green flags**
- Reports the **distribution** (p50/p95/p99/p99.9) and reads latency with errors together.
- Names coordinated omission unprompted and reaches for open/arrival-rate tools or wrk2.
- Picks the test *type* that fits the question and states the SLO as the verdict first.
- Treats a load test as a **prediction under synthetic load**, paired with testing-in-production.
- Talks about environment parity (especially data volume) and warm-up vs. steady state.
- Knows where measuring ends and fixing (the Performance section) begins.
- Frames performance testing as a continuous, SLO-driven, cost-aware practice.

---

## Cheat Sheet

```text
ALWAYS say percentiles, never average. Tail latency = the UX.

TEST TYPES: load(SLO@peak) stress(break point) spike(surge)
            soak(leaks/hours) scalability(does +capacity help) capacity(#users→breach)

GOLDEN SIGNALS: throughput(completed) · latency(p50/95/99/99.9) · errors(by kind) · saturation
  read latency + errors TOGETHER (fast failures are failures)

MODELS: closed=fixed VUs wait (self-throttles, HIDES overload)
        open=fixed rate (piles up, EXPOSES collapse) → use for capacity/SLO

COORDINATED OMISSION: closed tool blocks in a stall → omits slow requests
  → tail under-reported 10–90×, always optimistic
  FIX: open/arrival-rate (watch dropped_iterations) · wrk2 · vegeta

SOUND TEST: SLO first → realistic mix+think-time+data-variety
            → warm-up(exclude)+steady(measure) → one variable → prod-like env

CI: micro-bench per PR (benchstat, N runs, sig test) + full test nightly
    gate ABOVE noise floor · pinned runners · track trend (noisy gate → ignored)

CAN'T PROVE: real traffic, data hotspots, exact topology, emergent failures
  → pair with testing-in-production + observability

MEASURE here; FIX in ../../performance/. Practice = continuous, SLO-driven, cost-aware.
```

---

## Summary

Performance-testing interviews reward precision about two things above all: the latency *distribution* (you say p99 and explain why the average lies and why tail latency is the user experience), and the measurement traps that make most reports wrong — coordinated omission (closed tools under-report the tail by up to 90×; fix with open/arrival-rate generators, wrk2, or vegeta) and environment parity (small datasets flatter every query). Know the test family as distinct questions, closed vs. open workload models, the four golden signals read together, how to localise a bottleneck (and that *fixing* it is the Performance section's job), and that a load test is a prediction under synthetic load that must be paired with testing-in-production. Frame the whole thing as a continuous, SLO-driven, cost-aware practice — not a pre-launch ritual.

---

## Further Reading

- Gil Tene, *"How NOT to Measure Latency"* — coordinated omission and percentiles.
- k6, Locust, Gatling, wrk2, and vegeta documentation.
- Google SRE Book / Workbook — SLOs and error budgets.
- *Systems Performance*, Brendan Gregg — the USE method for saturation.

---

## Related Topics

- [`../13-testing-in-production/`](../13-testing-in-production/) — what synthetic load can't prove.
- [`../11-test-data-management/`](../11-test-data-management/) — realistic data at scale.
- [`../01-test-strategy-and-the-pyramid/`](../01-test-strategy-and-the-pyramid/) — where performance tests fit.
- [`../../performance/`](../../performance/) — profiling and fixing the bottleneck.
- [`../../engineering-metrics-and-dora/`](../../engineering-metrics-and-dora/) — SLOs and error budgets.
- Skills: `system-design-estimation`, `monitoring-alerting`, `load-balancing`.
