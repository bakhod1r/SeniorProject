# Performance & Load Testing — Senior Level

> **Roadmap:** [Testing](../README.md) → Performance & Load Testing

*Most load-test reports are wrong by an order of magnitude in the tail, and the team never knows. Coordinated omission, environment mismatch, and noisy regression gates quietly corrupt the numbers. The senior job is to produce results that survive scrutiny.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Coordinated omission: why your tail is a lie](#core-concept-1--coordinated-omission-why-your-tail-is-a-lie)
5. [Core Concept 2 — Avoiding coordinated omission in practice](#core-concept-2--avoiding-coordinated-omission-in-practice)
6. [Core Concept 3 — Realistic workload modelling](#core-concept-3--realistic-workload-modelling)
7. [Core Concept 4 — Environment parity, or your numbers are fiction](#core-concept-4--environment-parity-or-your-numbers-are-fiction)
8. [Core Concept 5 — Performance regression testing in CI](#core-concept-5--performance-regression-testing-in-ci)
9. [Core Concept 6 — The noise problem in benchmark gates](#core-concept-6--the-noise-problem-in-benchmark-gates)
10. [Core Concept 7 — Interpreting results and finding the bottleneck](#core-concept-7--interpreting-results-and-finding-the-bottleneck)
11. [Core Concept 8 — What load tests cannot prove](#core-concept-8--what-load-tests-cannot-prove)
12. [Real-World Examples](#real-world-examples)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **producing load-test numbers that are *correct* — defeating coordinated omission, achieving environment parity, and building regression gates that fail on real regressions and not on noise.**

By now you can design a sound test. The senior failure mode is more insidious: a *well-run* test that produces *wrong numbers* and a team that trusts them. The headline cause is **coordinated omission** — a measurement bug baked into most naive load tools that under-reports the latency tail by factors of 10 or more. Add environment mismatch and noisy CI gates, and you have a performance practice that is confidently misleading.

This level makes your measurements trustworthy and operationalises them: regression gates in CI, realistic modelling, and a clear-eyed account of what a load test fundamentally *cannot* prove. The fixing — profiling, query plans, caching — is still `../../performance/`; here we get the measurement right and locate the bottleneck.

---

## Prerequisites

- You can design an open-model load test with realistic mix, think time, and SLO thresholds (middle level).
- You understand percentiles and the latency-vs-concurrency curve (knee/cliff).
- Comfort with CI pipelines and reading server telemetry (CPU, GC, pool depth).
- Conceptual grasp of queueing: utilisation drives queue length nonlinearly.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Coordinated omission** | Measurement error where the load tool stops the clock during stalls, omitting the latency that real clients would have felt. |
| **Service time** | Time the server actually spends on a request. |
| **Response time** | Service time **+** time spent waiting in queue (what the user feels). |
| **Schedule / intended start** | When a request *should* have been sent at the target rate. |
| **Backpressure** | The system signalling it cannot accept more work. |
| **Environment parity** | Test env matching prod in instance size, data volume, topology, config. |
| **Regression gate** | A CI check that fails the build on a performance drop. |
| **Noise / variance** | Run-to-run latency differences from shared hardware, GC, neighbours. |
| **Confidence interval** | Statistical range; used to distinguish a real regression from noise. |
| **Bottleneck** | The single most-saturated resource that limits throughput. |

---

## Core Concept 1 — Coordinated omission: why your tail is a lie

This is the most important measurement bug in load testing, named by Gil Tene. It silently corrupts the tail of nearly every naive load test.

**Setup.** A closed-model VU is supposed to send a request every 100 ms (10 req/s). It sends, waits for the response, then sends the next. Normally requests take ~10 ms, so the rhythm holds.

Now the server stalls for **1 second** (GC pause, lock, failover). What does a naive tool record?

```
Intended schedule (every 100ms):  t=0, t=100, t=200, ..., t=900, t=1000
Reality during a 1s stall:
  t=0    send req A ──────────────────────[stall]──────────▶ responds at t=1000
                                                              A's latency = 1000ms ✓ recorded
  The tool was BLOCKED waiting for A. It did NOT send the
  requests scheduled at t=100, 200, ... 900.
  Those 9 requests are simply OMITTED.
```

The tool records **one** 1000 ms request. But in the real world, requests do not pause politely while your server is stuck — 9 more would have arrived during that second, and they would have waited 900 ms, 800 ms, 700 ms, ... each. By blocking, the tool **coordinated** with the server's stall and **omitted** the very requests that would have shown the tail.

**The damage, with numbers.** Suppose 10,000 requests, all 10 ms except one 1000 ms stall.

```
Naive tool (coordinated omission):
  9,999 × 10ms + 1 × 1000ms
  p99   ≈ 10ms    ← the stall is 1 in 10,000, vanishes from p99
  p99.99≈ 1000ms
  "Looks great!"

Corrected (count the omitted requests — what users actually felt):
  During the 1s stall, ~100 requests (at 10ms cadence) were in-flight or
  would-have-arrived, with latencies 1000, 990, 980, ..., 10ms.
  p99   ≈ 900ms    ← the truth: ~1% of users had a near-second wait
```

Same system, same stall. The naive p99 is **10 ms**; the honest p99 is **~900 ms** — a 90× error, and it is *always in the optimistic direction*. Coordinated omission never makes you look worse than reality; it always flatters you. That is what makes it dangerous: it hides exactly the tail problems you ran the test to find.

---

## Core Concept 2 — Avoiding coordinated omission in practice

Three defences, in order of preference:

**1. Use an open-model / constant-arrival-rate generator.** If the tool injects requests on a fixed *schedule* regardless of responses, a stall causes real pile-up and the omitted requests are actually sent (and recorded as slow). k6's `constant-arrival-rate` and `ramping-arrival-rate` executors do this; Gatling is open by design.

```javascript
// CORRECT for tail measurement: arrivals on a schedule, not gated by responses
export const options = {
  scenarios: {
    fixed_rate: {
      executor: 'constant-arrival-rate',
      rate: 1000, timeUnit: '1s',     // 1000 req/s on a SCHEDULE
      duration: '5m',
      preAllocatedVUs: 500, maxVUs: 2000, // enough VUs so arrivals are never gated
    },
  },
};
```

The subtlety: you must allocate **enough VUs** (`maxVUs`) that the generator never runs out and starts waiting — if it exhausts its VU pool during a stall, coordinated omission sneaks back in. Watch the `dropped_iterations` metric; non-zero means you under-provisioned and your tail is again understated.

**2. Use a tool that corrects after the fact.** `wrk2` (Tene's own) takes a target rate and back-fills the latency of requests that *should* have been sent during a stall. Plain `wrk` does **not** — it has coordinated omission. This is the entire reason wrk2 exists.

```bash
# wrk2: -R is the target throughput; it corrects for coordinated omission
wrk2 -t4 -c100 -d5m -R2000 --latency https://api.example.com/products
```

`vegeta` (Go) is also rate-based (`-rate`) and reports honest tails.

**3. If you must use a closed tool, account for it.** Record the *intended* start time (schedule), not the actual send time, and compute latency from the schedule. Some libraries (HdrHistogram with `recordValueWithExpectedInterval`) do this for you.

**The senior tell:** if a team reports a beautiful p99.9 from JMeter or Locust in closed mode at high load, ask "what about coordinated omission?" If they blink, the tail is fiction.

---

## Core Concept 3 — Realistic workload modelling

Beyond middle-level mix/think-time/variety, senior modelling captures the *texture* of real traffic:

- **Arrival distribution.** Real arrivals are bursty (often Poisson-ish), not perfectly even. Constant-rate is a fine baseline, but a spike test should model bursts because evenly-spaced load hides queueing that bursts expose.
- **Session/stateful flows.** Users log in, carry a token, browse, then check out — a *correlated sequence*, not independent hits. Model sessions: extract the auth token from the login response and reuse it (k6 `group` + variable capture; Locust `on_start`).
- **Data distribution, not just variety.** Real access is Zipfian — a few hot keys dominate. Uniformly random IDs *under*-stress hot partitions and caches; production has hotspots. Model the skew (see `../11-test-data-management/`).
- **Caching realism.** Decide deliberately whether you are testing cold-cache (worst case, after deploy) or warm-cache (steady state). Both are valid; conflating them is not.
- **Geographic / network reality.** Load from one machine in the same datacentre omits real latency, TLS handshakes, and connection churn. Distributed load generators (cloud k6, Locust workers) approximate it.

The governing principle: **a load test is a model of production traffic, and every simplification is an assumption.** Senior work is making those assumptions explicit and defensible.

---

## Core Concept 4 — Environment parity, or your numbers are fiction

> If the test environment does not resemble production, your numbers do not predict production. They predict the test environment.

The parity dimensions that most often invalidate results:

| Dimension | The fiction it creates if mismatched |
|-----------|--------------------------------------|
| **Instance size / CPU** | A 2-vCPU test box behaves nothing like a 16-vCPU prod node (GC, parallelism, cache). |
| **Data volume** | A 1,000-row test DB has every query hitting cache and no slow index scans. Prod has 50M rows. This is the #1 fiction. |
| **Topology** | Single node vs. multi-AZ behind a load balancer changes latency, failover, connection limits (the `load-balancing` skill). |
| **Dependencies** | Mocked downstreams remove the real bottleneck; real ones add real latency and failure. |
| **Config** | Connection-pool sizes, timeouts, JVM flags, kernel limits must match. |
| **Noisy neighbours** | Prod shares hardware; an idle test box does not. |

You will rarely get *perfect* parity (full prod-scale is expensive — see professional level on cost). The senior move is to be explicit about the gaps and their direction: a smaller test env will generally show worse numbers (less headroom) — useful as a conservative lower bound — but a too-small *dataset* shows *better* numbers (everything cached), which is dangerous because it flatters. Know which way each gap biases the result.

The honest alternative when parity is unaffordable is to load-test *in* production carefully — canaries, shadow traffic, dark launches — which is `../13-testing-in-production/`.

---

## Core Concept 5 — Performance regression testing in CI

A load test run once before launch is a ritual; run on every change, it is a *regression gate*. Two granularities:

**1. Micro-benchmark gates** (function/endpoint level, fast, in the unit-test pipeline). Run on every PR; cheap. Catch a function that went from O(n) to O(n²).

```yaml
# pseudo-CI: fail the PR if a key path regresses beyond a threshold
benchmark:
  run: go test -bench=. -benchmem -count=10 ./... > new.txt
  compare: benchstat baseline.txt new.txt   # statistical comparison
  gate: fail if any benchmark slower by >10% with p<0.05
```

**2. Full load-test gates** (system level, slower, prod-like env). Run nightly or pre-release, not on every PR (too slow/expensive). k6 `thresholds` make the run self-gating:

```javascript
thresholds: {
  http_req_duration: ['p(99)<300', 'p(95)<150'],
  http_req_failed:   ['rate<0.001'],
  // compare to a stored baseline in the pipeline step that follows
}
```

The pattern: **establish a baseline, run the test, fail the build if the new result is statistically worse than baseline by more than a threshold.** Store baselines per-branch; update them deliberately when an intentional change shifts performance.

---

## Core Concept 6 — The noise problem in benchmark gates

The reason most performance gates get disabled is **noise**: run-to-run variance from shared CI hardware, neighbouring jobs, GC timing, thermal throttling, and turbo boost. A naive gate ("fail if p99 increased") fires constantly on noise, the team learns to ignore it, and it dies.

Defences:

- **Compare distributions, not single runs.** Run N times (e.g., 10) and compare with a statistical test. Go's `benchstat` reports a delta *with significance* — it will say "no significant change" when the difference is within noise. Treat a single number as meaningless.
- **Set the threshold above the noise floor.** First measure your CI's run-to-run variance (run the *same* commit 20 times). If variance is ±8%, a 5% gate is pure noise; set it to, say, 15%.
- **Dedicated, quiet runners.** Shared cloud runners are noisy; a pinned, isolated machine (consistent CPU, disabled turbo, performance governor) cuts variance dramatically. Worth it for a serious gate.
- **Track trends, not just gates.** Even when a single run passes, a slow upward drift over weeks is a real regression. Chart p99 over time; alert on the trend (the `monitoring-alerting` skill).
- **Warm-up and pinning.** Exclude warm-up; pin the process; run long enough to average out transients.

The senior judgement: a gate that cries wolf is worse than no gate, because it trains the team to ignore the signal. Tune for *trust*, not maximum sensitivity.

---

## Core Concept 7 — Interpreting results and finding the bottleneck

A load test that found slowness has done its job; the next step is *locating* the constraint (then handing the fix to `../../performance/`). Read symptom → cause:

| Symptom in the load test | Likely bottleneck to investigate |
|--------------------------|----------------------------------|
| Throughput flat as VUs rise; CPU ~100% | CPU-bound: hot code path, serialization, crypto. |
| Latency rises but CPU low; pool at max | Connection-pool / thread starvation (`connection-pooling` skill). |
| Periodic p99 spikes, sawtooth memory | GC pauses or a cache eviction storm. |
| Latency grows over hours, memory climbs | Memory leak (soak test) → `memory-leak-detection`. |
| DB CPU high, app CPU low | Slow queries / missing index → `database-performance`. |
| Errors are 503/429 under load | Backpressure / rate limit kicking in (often correct). |
| One downstream call dominates p99 | A slow dependency; consider caching / circuit breaker. |

The discipline is **correlate the load tool's latency/error timeline with the server's saturation telemetry on the same clock.** The moment p99 bends upward, look at what hit a limit *at that instant*. That resource is your bottleneck. The actual fix — index, cache, pool size, algorithm — is the Performance section's domain.

---

## Core Concept 8 — What load tests cannot prove

Senior credibility comes partly from stating the limits plainly. A load test demonstrates behaviour under **synthetic** load in a **test** environment. It therefore *cannot* prove:

- **Real traffic patterns.** You modelled the mix you *imagined*; production will surprise you with a flow you did not script.
- **Data-dependent hotspots.** Synthetic data lacks the exact skew, the one user with 2M rows, the pathological query that real data produces.
- **Exact production topology.** Real load balancers, multi-AZ latency, noisy neighbours, real network — approximated, never identical.
- **Emergent and rare failures.** Cascading failures, retry storms, thundering herds on cache expiry, dependency brownouts — some only appear with real concurrency and real failure timing.
- **Third-party behaviour under your real load.** Your payment provider's rate limits and latency under *your production* volume.

This is precisely why mature teams pair load testing with **testing in production** (`../13-testing-in-production/`) — canary releases, shadow/dark traffic, and rich observability. The load test shrinks the unknown before launch; production observability handles the rest. A load test is a *prediction*, and you must hold it as one.

---

## Real-World Examples

- **The 90× tail.** A team's JMeter report showed p99 = 12 ms; production p99 was ~1.1 s. Re-running with wrk2 at the same target rate immediately showed p99 ≈ 1 s. Coordinated omission had hidden every GC pause.
- **The cached-dataset deploy.** Staging (10k rows) passed at p99 = 40 ms. Production (60M rows) breached SLO on day one: a query did a full scan that staging never triggered because everything fit in cache. Pure data-volume parity failure.
- **The gate everyone ignored.** A 5% p99 regression gate on shared GitHub runners fired on ~40% of PRs from noise. The team added `[skip-perf]` to every PR. Switching to `benchstat` over 10 runs on a pinned runner with a 15% threshold cut false positives to near zero and the gate regained trust.
- **The retry storm only prod saw.** Load tests passed; a real dependency brownout triggered client retries that the test never modelled, tripling effective load. Caught only by production observability and a circuit breaker.

---

## Mental Models

- **Coordinated omission is optimism baked into the tool.** It only ever makes you look better. Distrust any beautiful tail from a closed tool at high load.
- **Response time = service time + queue time.** Naive tools measure service time and call it response time. Users feel the queue.
- **A load test is a model; every simplification is an assumption.** State them.
- **A noisy gate is worse than no gate.** It trains the team to ignore the alarm.
- **The test predicts; production decides.** Pair it with observability.

---

## Common Mistakes

- **Reporting tails from a closed-model tool at high load** without correcting for coordinated omission.
- **Under-provisioning `maxVUs`** so the arrival-rate generator stalls and CO returns (ignore `dropped_iterations` at your peril).
- **Tiny test datasets** that keep everything cached and flatter every query.
- **Single-run benchmark gates** that fire on noise until disabled.
- **Quoting load-test numbers as production guarantees** instead of predictions.
- **Mocking the very downstream that is the real bottleneck.**
- **Setting a gate threshold below the CI noise floor.**

---

## Test Yourself

1. A naive closed tool reports p99 = 9 ms for a system with one 800 ms GC pause per minute at 1000 req/s. Roughly what is the *honest* p99, and why is the tool's number so wrong?
2. You switch to `constant-arrival-rate` but still see a suspiciously clean tail. What metric do you check, and what might be wrong?
3. Staging passes; production fails the same SLO immediately. List three parity gaps that flatter staging, and say which direction each biases the result.
4. Why does a 5% regression gate on shared CI runners usually get disabled, and what are two fixes?
5. Your test shows flat throughput with the connection pool at max and CPU at 30%. What is the bottleneck, and where does the *fix* live?
6. Name three things a load test fundamentally cannot prove, and the practice that covers each gap.

---

## Cheat Sheet

```text
COORDINATED OMISSION (the #1 tail bug)
  closed tool blocks during a stall → omits the requests that would've waited
  → tail UNDER-reported, always optimistic (often 10–90×)
  FIX: open/arrival-rate generator (k6 constant-arrival-rate, Gatling),
       or wrk2 / vegeta (rate-based, CO-corrected). Watch dropped_iterations.

response time = service time + QUEUE time   (users feel the queue)

ENVIRONMENT PARITY (or numbers are fiction)
  data volume = #1 fiction (small DB → all cached → flattering)
  match: CPU/instance, topology, deps, config, pool sizes
  smaller env → worse numbers (conservative); smaller DATA → better (dangerous)

REGRESSION GATES
  micro-bench per PR (benchstat, N runs, significance test)
  full load test nightly/pre-release (k6 thresholds vs baseline)
  noise: compare distributions, threshold ABOVE noise floor, pinned runners, track trend
  a noisy gate gets ignored → tune for TRUST

BOTTLENECK: correlate latency/error timeline with server saturation on same clock
  (fix lives in ../../performance/)

CANNOT PROVE: real traffic, data hotspots, exact topology, emergent failures
  → pair with testing-in-production + observability
```

---

## Summary

Senior load testing is about *correctness of measurement*, not just test design. Coordinated omission silently understates the latency tail by up to two orders of magnitude in any closed tool that blocks during stalls; defeat it with open/arrival-rate generators (watching `dropped_iterations`) or CO-corrected tools like wrk2 and vegeta. Realistic modelling means sessions, Zipfian data skew, and deliberate cache state — every simplification is a stated assumption. Without environment parity, especially data volume, numbers predict the test box, not production. Regression gates earn trust only when they compare distributions, sit above the noise floor, and track trends — a gate that cries wolf gets disabled. Read results by correlating latency with saturation to find the bottleneck, then hand the fix to the Performance section. And state the limits plainly: a load test is a prediction under synthetic load, paired with testing-in-production for everything it cannot prove.

---

## Further Reading

- Gil Tene, *"How NOT to Measure Latency"* — the definitive coordinated-omission talk.
- wrk2 README and HdrHistogram docs (expected-interval correction).
- *Systems Performance*, Brendan Gregg — saturation, the USE method.
- Go `benchstat` docs — statistical benchmark comparison.

---

## Related Topics

- [`../13-testing-in-production/`](../13-testing-in-production/) — covers what synthetic load cannot.
- [`../11-test-data-management/`](../11-test-data-management/) — realistic data skew and volume.
- [`../01-test-strategy-and-the-pyramid/`](../01-test-strategy-and-the-pyramid/) — performance tests in the strategy.
- [`../../performance/`](../../performance/) — profiling and fixing the located bottleneck.
- [`../../engineering-metrics-and-dora/`](../../engineering-metrics-and-dora/) — SLOs and error budgets.
- Skills: `monitoring-alerting`, `load-balancing`, `connection-pooling`, `database-performance`, `memory-leak-detection`, `system-design-estimation`.
