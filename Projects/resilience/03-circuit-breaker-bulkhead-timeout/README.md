# Circuit Breaker, Bulkhead & Timeout Budgets

> One slow dependency should cost you *that* dependency — not your whole service.
> Build the three primitives that contain a partial failure (breaker, bulkhead,
> timeout/retry budget), then prove under load that they turn a cascade into a
> bounded, fast-failing brownout. Numbers, not vibes.

| | |
|---|---|
| **Tier** | Resilience |
| **Primary domain** | Cascading-failure isolation |
| **Skills exercised** | Circuit breakers, bulkhead pools, `context` deadline propagation, timeout/retry budgets, fallbacks, load-shedding, Go (`sony/gobreaker`, `golang.org/x/sync/semaphore`, `context`) |
| **Interview sections** | 13 (distributed systems), 22 (scalability & HA), 9 (networking) |
| **Est. effort** | 3–4 focused days |

---

## 1. Context

You own `checkout-api`. It calls three downstreams synchronously per request:
`pricing` (fast, critical), `recommendations` (slow-ish, *optional*), and
`fraud` (medium, critical). It runs on a fixed worker budget — a Go HTTP server
with a bounded number of in-flight goroutines and a connection pool of 100 to
each downstream.

At 02:00 `recommendations` GCs badly and its p99 jumps from 40 ms to 8 s.
Within ninety seconds `checkout-api` is fully down — even though `recommendations`
is *optional* and was never on the critical path. Every worker is parked waiting
on a `recommendations` call, the connection pool is drained, new requests queue,
and the load balancer health check times out. One non-critical, slow dependency
took the whole service offline. **That is a cascading failure**, and it is the
single most common way distributed systems die.

Your job: reproduce that cascade on purpose, then add circuit breakers, bulkheads,
and timeout/retry budgets and *prove* the service stays serving (degraded but up)
while the same dependency is just as broken. You will produce before/after numbers
for the cascade, not a description of one.

## 2. Goals / Non-goals

**Goals**
- Reproduce a real cascade: inject latency into one downstream and show
  `checkout-api` goes from healthy to fully unavailable, and explain the exact
  exhaustion mechanism (goroutines / connection pool / accept queue).
- Add a **circuit breaker** (closed/open/half-open) per downstream and show the
  caller fast-fails instead of parking workers once the dependency is unhealthy.
- Add **bulkhead** isolation (separate concurrency pools per downstream) and show
  one bad dependency can no longer starve calls to the healthy ones.
- Implement **timeout budgets** via `context` deadline propagation across the
  call chain, not fixed per-hop timeouts, and show the difference under a slow
  chain.
- Add a **retry budget** and demonstrate the retry-storm amplification it prevents.
- Add **fallbacks / graceful degradation** so optional dependencies failing
  degrade the response instead of failing the request.

**Non-goals**
- A general service mesh (Istio/Linkerd/Envoy). You may *reference* how they do
  it, but implement the primitives yourself so you understand the state machine.
- Async/queue-based decoupling — that is a different mitigation (see `events/`).
  Here the calls are synchronous and request-scoped on purpose.
- Autoscaling your way out. The whole point is a *fixed* capacity envelope.

## 3. Functional requirements

1. A **`checkout-api`** service (`cmd/checkout`) that, per request, calls three
   downstream stubs (`pricing`, `recommendations`, `fraud`) and returns a quote.
   `recommendations` is optional; the other two are required.
2. **Fault-injectable downstreams** (`cmd/downstream`) whose per-endpoint latency,
   error rate, and error type are controllable at runtime (flag/env/HTTP admin
   endpoint), so you can dial in "slow", "erroring", or "slow + erroring".
3. A **resilience layer**, toggleable by flag so you can run *with* and *without*
   protection on identical load:
   - **Circuit breaker** per downstream: closed → open on a trip condition,
     half-open probing, close on probe success. Expose state transitions.
   - **Bulkhead** per downstream: a bounded concurrency permit pool
     (`semaphore.Weighted` or a buffered-channel token pool); reject/shed when full.
   - **Timeout budget**: a per-request deadline set at ingress and *propagated*
     via `context.Context` to every hop; each hop spends from the remaining budget.
   - **Retry budget**: retries gated by a token-bucket / ratio cap so retries can
     never exceed e.g. 10% of base traffic to a downstream.
   - **Fallback**: on `recommendations` open-circuit or shed, return a cached /
     empty recommendation set and serve the request anyway.
4. A **load driver** (`cmd/load`) that holds a fixed open-model request rate while
   you inject and remove faults.

## 4. Load & data profile

- **Base load:** sustained **2,000 req/s** to `checkout-api` for runs of ≥ 10 min,
  open-model (fixed arrival rate, *not* closed-loop — closed-loop hides cascades
  because it self-throttles when the service slows).
- **Fan-out:** each checkout request makes 3 downstream calls; `recommendations`
  ~30% of total downstream call volume.
- **Capacity envelope (fixed, documented):** `checkout-api` runs with a known
  in-flight ceiling and per-downstream pool of **100** connections. Write the
  envelope down — the cascade math depends on it (Little's Law below).
- **Healthy baseline latencies:** `pricing` p50 8 ms, `fraud` p50 25 ms,
  `recommendations` p50 40 ms.
- **Fault profile:** inject `recommendations` p99 → **5–8 s** (slow), and a
  separate run at **40% error rate** (errors), and a combined run.

> Little's Law is the whole lab in one line: in-flight = arrival_rate × latency.
> At 2,000 req/s, if a dependency's effective latency goes from 0.04 s to 8 s, the
> in-flight count for *that* call balloons by 200×. Without isolation, that
> in-flight demand consumes your shared worker/connection budget and everything
> behind it starves.

## 5. Non-functional requirements / SLOs

The contract is about what the *caller* does while a downstream is broken.

| Metric | Target |
|--------|--------|
| `checkout-api` availability while `recommendations` is fully down (slow or erroring) | **≥ 99%** of requests succeed (degraded, no recommendations) — the cascade must not happen |
| `checkout-api` p99 while a non-critical downstream is broken | **≤ 1.5×** the healthy-baseline p99 (you fast-fail, you don't park) |
| Fast-fail latency once a breaker is **open** | **< 5 ms** to reject/fallback (no network attempt, no timeout wait) |
| Required-dependency (`pricing`/`fraud`) success rate while `recommendations` is broken | **Unaffected** — bulkhead proves isolation (≥ 99.9%) |
| Retry-induced extra load on a struggling downstream | **≤ 1.1×** base call rate (retry budget caps amplification at ≤ 10%) |
| Recovery: time from downstream-healthy to breaker-closed & full throughput | **< 30 s**, and *measured*, with no thundering-herd re-open |
| Without protection (control run) | Reproduce **full outage**: availability → ~0%, all workers parked. This is a required deliverable, not a failure. |

> The win condition is not "no errors." It's: the broken dependency's blast radius
> is *the broken dependency*. The service degrades and survives; the SLOs above are
> how you prove the blast radius was contained.

## 6. Architecture constraints & guidance

- **Go, synchronous calls.** This is the realistic and dangerous case. Each
  downstream call is an HTTP round-trip from a request goroutine.
- **Breaker:** `sony/gobreaker` is the canonical choice (closed/open/half-open
  with `ReadyToTrip`, `Interval`, `Timeout`, `MaxRequests` for half-open). You may
  hand-roll one to show you understand the state machine — but then justify your
  trip math.
- **Bulkhead:** `golang.org/x/sync/semaphore.Weighted` per downstream, or a
  buffered-channel token pool. Acquire a permit *before* the call with the request
  `context`; if `Acquire` fails fast (full pool), shed or fall back. **One pool per
  dependency** — never a single shared pool, that defeats the point.
- **Timeout budget:** set one deadline at ingress (`context.WithTimeout`), pass
  that `ctx` down every hop. Each downstream client uses `ctx`, so a hop that runs
  late shortens the budget for later hops automatically. Compare against the naive
  "every hop gets a fixed 2 s" design and show how fixed timeouts overshoot a chain.
- **Retry budget:** a per-downstream token bucket; a retry costs a token, tokens
  refill at a fraction of success rate. When the bucket is empty, do **not** retry.
  This is what keeps a struggling downstream from getting retry-stormed into the
  ground.
- **Order of the wrappers matters:** breaker → bulkhead → timeout → call. Decide
  and justify the nesting (e.g. don't burn a bulkhead permit on a call the breaker
  would reject; don't let a retry re-enter a tripped breaker).
- **Instrument everything** with Prometheus: per-downstream breaker state,
  bulkhead permits in use / rejected, retries attempted / budget-denied, in-flight
  goroutines, connection-pool wait time, and caller p50/p99/p999 + success rate.

## 7. Data model / state

```
breaker (per downstream):  state ∈ {closed, open, half_open}
                           consecutive_failures, failure_ratio over Interval,
                           opened_at, half_open_inflight
bulkhead (per downstream): permits_total, permits_in_use, rejected_total
retry_budget (per dep):    tokens (token-bucket), ratio_cap (e.g. 0.10),
                           denied_total
request context:           deadline (absolute), remaining_budget = deadline - now
```

`opened_at + Timeout` is when the breaker allows a half-open probe; `MaxRequests`
caps how many probes run concurrently so recovery isn't a thundering herd.

## 8. Interface contract

- `POST /checkout` → `{ quote, recommendations?, degraded: bool }`. `degraded:true`
  when an optional dependency was breaker-open/shed and a fallback was served.
- `GET /metrics` → Prometheus exposition (all the gauges/counters in §6).
- Downstream admin: `POST /admin/fault {endpoint, latency_ms, error_rate, ...}` to
  inject and clear faults at runtime.
- Resilience configured via flags/env: `-breaker`, `-bulkhead-size`, `-budget-ms`,
  `-retry-ratio`, `-fallback`, and a master `-protection=off|on` for control runs.

## 9. Key technical challenges

- **Reproducing the cascade honestly.** You must *see* the exhaustion: in-flight
  goroutines climbing, connection-pool acquire-wait climbing, then accept-queue
  overflow and health-check failure. A cascade you can't measure isn't a cascade.
- **Trip thresholds that aren't twitchy.** Too sensitive → the breaker opens on
  normal jitter and you lose availability you didn't need to. Too loose → it opens
  after the cascade already started. Tune on failure *ratio over a window*, not a
  raw count, and justify the numbers.
- **Half-open without a thundering herd.** When the breaker probes, a flood of
  queued requests must not all rush the recovering downstream and re-trip it.
  `MaxRequests` + jitter; measure the recovery shape.
- **Timeout budgets across a chain.** Fixed per-hop timeouts sum up: three hops at
  2 s each can make a request wait 6 s before failing, well past the client's
  patience. A propagated budget fails fast and correctly; show the distribution
  difference.
- **Retry storms.** Naive retry-on-error *adds* load exactly when the downstream is
  already failing — a positive feedback loop that turns a blip into an outage. The
  budget breaks the loop; you must demonstrate the amplification with and without it
  (this is the same failure mode as `events/05-dlq-and-retry-topology`).
- **Interaction effects.** Breaker + bulkhead + retry + timeout interact. A retry
  inside a bulkhead double-spends permits; a retry into an open breaker is wasted;
  a too-short budget makes the breaker trip on your *own* impatience. Get the
  composition right and prove it.

## 10. Experiments to run (break it / tune it)

Record before/after numbers and a dashboard screenshot for each.

1. **The cascade (control, no protection).** Steady 2,000 req/s healthy. Inject
   `recommendations` p99 → 8 s. **Measure:** time-to-full-outage,
   in-flight goroutines, connection-pool acquire-wait, and `checkout-api`
   availability collapsing to ~0%. Name the exhausted resource. This is your
   baseline horror.
2. **Circuit breaker fast-fail.** Same fault, breaker on (no bulkhead yet).
   **Measure:** breaker trip time, fast-fail latency (< 5 ms once open), and
   caller availability holding ≥ 99%. Plot breaker state vs caller success rate.
3. **Bulkhead isolation.** Same fault, bulkhead on. Hold steady load to *all three*
   downstreams. **Measure:** `pricing`/`fraud` success rate and p99 while
   `recommendations` is fully broken — prove they're unaffected (the permit pool for
   the bad dep fills and sheds; the others never see it).
4. **Timeout budget vs fixed timeouts.** Build a slow chain (`fraud` p99 → 1.5 s).
   Run (a) fixed 2 s-per-hop and (b) one propagated 800 ms request budget.
   **Measure:** the p99 *waiting* time before a request gives up, and how many
   requests wait far longer than the client's patience under (a).
5. **Retry storm.** `recommendations` at 50% error rate. Run (a) naive retry-3x and
   (b) retry budget capped at 10%. **Measure:** downstream call-rate amplification
   factor and whether the retries push the downstream from "degraded" into "down".
6. **Half-open recovery tuning.** After tripping the breaker, heal the downstream.
   Sweep `Timeout` (open duration) and half-open `MaxRequests`. **Measure:**
   recovery time to full throughput, and whether the breaker re-trips
   (thundering-herd) on first probe. Find the setting that recovers < 30 s with no
   flap.
7. **Everything together, combined fault.** `recommendations` slow + erroring,
   `fraud` mildly slow, at full load. Turn the whole stack on. **Measure:** the §5
   SLO table end-to-end and show `degraded:true` responses served instead of
   failures.

## 11. Milestones

1. `checkout-api` + 3 fault-injectable downstreams + load driver + Prometheus/Grafana
   board (in-flight, pool-wait, p99, success rate).
2. **Reproduce the cascade** (experiment 1) and write down the exhaustion mechanism.
   You cannot move on until you've made it fall over and explained why.
3. Circuit breaker + fast-fail (experiment 2); breaker-state dashboard.
4. Bulkhead isolation (experiment 3) proving the blast radius is contained.
5. Timeout budget + retry budget (experiments 4–5); fallbacks for the optional dep.
6. Half-open tuning + the combined run (experiments 6–7); findings note.

## 12. Acceptance criteria (definition of done)

- [ ] **Cascade reproduced**: a control run showing `checkout-api` going to ~full
      outage from one slow non-critical downstream, with the exhausted resource
      named and proven (goroutine count / pool acquire-wait graph).
- [ ] **Containment proven**: the same fault with protection on keeps caller
      availability ≥ 99% and required-dependency success ≥ 99.9% (bulkhead).
- [ ] **Fast-fail measured**: open-breaker reject/fallback latency < 5 ms.
- [ ] **Timeout budget** beats fixed-per-hop timeouts on a slow chain, with the
      latency distributions plotted.
- [ ] **Retry storm** demonstrated and tamed: amplification ≤ 1.1× with the budget,
      and shown to be much worse without it.
- [ ] **Recovery**: breaker closes < 30 s after the downstream heals, with no
      re-trip flap, on a graph.
- [ ] Every number reproducible from a committed command + config; resilience knobs
      documented with the reasoning behind each chosen value.

## 13. Stretch goals

- **Adaptive / latency-based bulkhead** (concurrency limit that shrinks as observed
  latency rises, à la Netflix `concurrency-limits` / TCP-Vegas) instead of a fixed
  permit count — and compare it to the fixed bulkhead under a ramping fault.
- **Hedged requests** for the critical path (`fraud`): send a second request after
  p95 and take the first answer — measure tail-latency gain vs added load, and the
  interaction with the retry budget.
- **Deadline-aware shedding**: drop requests at ingress whose remaining budget is
  already too small to plausibly succeed, before they consume any permit.
- **Breaker on partial signals**: trip on rising latency (saturation) *before* hard
  errors appear, and measure how much earlier you contain the fault.
- Wire the whole thing into `load-testing/02-chaos-and-fault-injection` so the fault
  schedule is driven by the chaos harness rather than manual `admin/fault` calls.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Cascade understanding | Reproduces the outage | Explains it via Little's Law; names the *first* resource to exhaust and predicts it before measuring |
| Circuit breaker | Trips and fast-fails | Justifies trip math (ratio-over-window), tunes half-open to avoid thundering-herd, proves recovery shape |
| Bulkhead | Separate pools per dep | Proves isolation with numbers; sizes pools from the capacity envelope, not by guessing |
| Timeout budgets | Uses `context` deadlines | Propagates a budget across the chain; shows why fixed per-hop timeouts overshoot; deadline-aware shedding |
| Retry safety | Knows retries can amplify | Quantifies the storm; caps it with a budget; knows where retries must *not* re-enter a tripped breaker |
| Composition | Stacks the primitives | Gets the nesting order right and defends it; reasons about permit/breaker/retry interactions |
| Communication | Clear before/after numbers | Could defend every threshold and curve to a staff panel and tie each to an SLO |

## 15. References

- **Go:** `context` deadline propagation; `sony/gobreaker` (closed/open/half-open,
  `ReadyToTrip`, `MaxRequests`); `golang.org/x/sync/semaphore` for bulkheads.
- Michael Nygard, *Release It!* — circuit breaker, bulkhead, timeout, and the
  cascading-failure / "integration point" failure modes (the canonical source).
- Google SRE Book — "Handling Overload" and "Addressing Cascading Failures"
  (retry budgets, deadline propagation, load shedding).
- Netflix Hystrix (history) and `concurrency-limits` (adaptive bulkheads); Envoy's
  outlier-detection / circuit-breaking docs for how a mesh does the same job.
- See also: `events/05-dlq-and-retry-topology` (retry storms & backpressure),
  `load-testing/02-chaos-and-fault-injection` (driving the faults), and
  `resilience/02-adaptive-concurrency-and-load-shedding` (the adaptive sibling).
- Interview prep: `Interview Question/13-distributed-systems/` (cascading failure,
  timeouts, idempotent retries) and
  `Interview Question/22-scalability-and-high-availability/` (bulkheads, graceful
  degradation, blast-radius containment).
