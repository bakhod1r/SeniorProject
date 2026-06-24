# Adaptive Concurrency Limiting & Load Shedding

> A fixed rate limit is a guess that's wrong twice: too low and you waste
> capacity, too high and you walk the service off the latency cliff. Build a
> limiter that *discovers* the safe in-flight count from latency feedback — the
> way TCP discovers a path's capacity — and sheds load **before** the service
> collapses, not after.

| | |
|---|---|
| **Tier** | Resilience (overload protection) |
| **Primary domain** | Admission control / congestion control |
| **Skills exercised** | Adaptive concurrency limits (AIMD & gradient/Vegas), Little's Law, load shedding vs queueing, priority/brownout degradation, Go middleware, `golang.org/x/sync/semaphore` |
| **Interview sections** | 13 (distributed systems), 17 (performance engineering), 22 (scalability & HA) |
| **Est. effort** | 3–5 focused days |

---

## 1. Context

You own a Go service behind a load balancer. Capacity planning gave it a static
limit — say `1000 req/s` — set a year ago from a benchmark on a machine that no
longer exists. Since then the dependency mix changed, a GC pause got longer, a
downstream got slower, and the box was resized. Nobody re-derived the number.

Last week a marketing push doubled traffic for twenty minutes. The service
didn't return 503s — it accepted *everything*, queued it, and **throughput
collapsed**: as offered load rose past the knee, goodput went *down* while p99
went from 40 ms to 11 s. Every client retried, which added load, which made it
worse. The on-call paged at 02:00 and "fixed" it by restarting pods, which
dropped the queue on the floor.

Your job: replace the guess with a controller that **measures** the service's
safe concurrency from its own latency signal and **rejects early** when it can't
serve more — so throughput stays flat at the knee and p99 stays bounded, no
matter how hard the offered load pushes. You will produce the throughput-vs-load
curve that proves it, not an opinion that it "feels more stable."

## 2. Goals / Non-goals

**Goals**
- Reproduce **congestion collapse**: drive an unprotected service past capacity
  and show goodput *falling* as offered load rises (the classic cliff), with p99
  exploding.
- Build an **adaptive concurrency limiter** as Go middleware that learns the
  in-flight limit from latency feedback (AIMD *and* a gradient/Vegas estimator),
  and prove it holds throughput at the knee with bounded p99.
- Implement **load shedding**: reject over-limit requests *immediately* with
  `429`/`503` + `Retry-After`, instead of queueing them into a latency cliff.
- Implement **priority shedding**: under overload, drop low-priority traffic
  first so high-value requests keep their SLO.
- Be explicit about **rate limiting (req/s) vs concurrency limiting (in-flight)**
  and show why the latter self-tunes to capacity and the former does not.

**Non-goals**
- A distributed/global limiter coordinated across N replicas (that's the
  hierarchical-quotas lab). Here the limiter is **per-instance** and local.
- General rate-limiting algorithm comparison (token bucket, GCRA…) — that's lab
  01. Here the input *is* concurrency, not a fixed bucket.
- Autoscaling / adding capacity. Shedding is what you do *before* new capacity
  arrives, and when it can't.

## 3. Functional requirements

1. A **target service** (`cmd/service`) with a tunable, *honest* cost model: each
   request does configurable CPU work + a downstream call with a configurable
   latency distribution, so its capacity is real and its knee is reproducible.
   It must be possible to make it slow down under contention (e.g. a fixed-size
   worker pool / lock) so the latency cliff actually exists.
2. A **limiter middleware** (`limiter/`) wrapping the service's handler. It admits
   a request only if in-flight < current limit; otherwise it **sheds**. Pluggable
   limit algorithms behind one interface:
   - `fixed` — static concurrency (baseline / the "guess").
   - `aimd` — additive-increase on success, multiplicative-decrease on
     latency-breach or rejection.
   - `gradient` — Vegas-style: compare current latency to a running
     min-latency (`RTTnoload`); shrink the limit as the latency *gradient* rises.
3. **Shedding behavior** is a strategy: `reject` (429/503 + `Retry-After`) vs
   `queue` (bounded FIFO with a max wait, then reject). Switchable by flag so you
   can measure shed-vs-queue head-to-head.
4. **Priority**: requests carry a class (`high` / `low`, via header or path).
   Under pressure, the limiter sheds `low` first; `high` gets the last admission
   slots. A separate reserved headroom for `high` is allowed.
5. A **load driver** (`cmd/load`) using an **open model** (fixed arrival rate, not
   closed-loop) so offered load is independent of how fast the service drains —
   this is what lets you see collapse. It records a full latency histogram and
   distinguishes *admitted* from *shed*.

## 4. Load & data profile

- **Offered-load sweep:** ramp arrival rate from 0.25× to **4× the service's
  measured capacity** in steps, holding each step ≥ 60 s. The 4× step is where an
  unprotected service must visibly collapse.
- **Capacity is measured, not assumed:** first find the service's knee (max
  goodput rate) empirically; express everything as a multiple of it.
- **Open model, with a retry layer:** the driver retries shed requests with
  capped exponential backoff + jitter — because real clients do, and naive
  shedding without backoff causes a **retry storm** you must observe.
- **Spike profile:** a separate run that sits at 0.8× capacity, jumps to 3× for
  90 s, then drops back — to measure **recovery speed** (how fast the limit
  re-opens after the spike ends).
- **Priority mix:** 20% `high`, 80% `low`, so priority shedding has something to
  protect.
- **Coordinated-omission–safe measurement:** the driver must record latency
  against *intended* send time, not service-receive time, or your tail is a lie.

## 5. Non-functional requirements / SLOs

The whole point is what happens **above** capacity. Targets are stated relative
to the service's measured single-instance knee (call it `C` req/s):

| Metric | Target |
|--------|--------|
| Goodput at 1.0× offered load (at the knee) | ≈ `C` (within 5%); this is the reference |
| Goodput at **3× offered load**, *unprotected* | **Collapses** — must be measurably *below* `C` (demonstrate the cliff) |
| Goodput at **3× offered load**, *adaptive limiter* | **Held flat** at ≥ 0.90× `C` (no collapse) |
| Admitted-request p99 at 3× offered load (limiter on) | Bounded: ≤ 1.5× the p99 measured at the knee |
| Shed responses | Fast: `429`/`503` returned in < 5 ms with a `Retry-After`, never queued into the cliff |
| Shed rate at 3× load (limiter on) | ≈ (1 − 1/3) ≈ 66% of offered, by design — and **reported**, not hidden |
| `high`-priority success rate at 3× load (priority on) | ≥ 99% admitted; `low` absorbs the shedding |
| Recovery after a 3× spike ends | Limit re-opens and p99 returns to knee-level within ≤ 10 s |

> The target is **not** "serve everything." It's "serve `C`, refuse the rest in
> under 5 ms, and keep the tail bounded for what you do serve." A bounded `429`
> beats an unbounded `200` that arrives 11 seconds late.

## 6. Architecture constraints & guidance

- **Concurrency limiting, not rate limiting.** Gate on *in-flight count*, not
  req/s. A `golang.org/x/sync/semaphore.Weighted` (or an atomic counter) sized to
  the *current adaptive limit* is the admission gate. `TryAcquire` = admit;
  failure = shed. Resize the limit by adjusting the semaphore's effective bound,
  not by blocking acquirers.
- **The control loop is the product.** On each completed request, feed
  `(latency, success/shed)` to the limit estimator. AIMD: `limit += α/limit` on
  success, `limit *= β` (β≈0.8) on breach. Gradient (Vegas): track
  `RTTnoload = min latency`; `gradient = RTTnoload / RTTactual`; new limit ≈
  `limit × gradient + queueSize`; clamp and smooth. Cite Netflix
  `concurrency-limits` for the canonical gradient algorithm.
- **Shed at the edge, cheaply.** The reject path must not allocate, call
  downstreams, or take the same locks as the hot path — a shed must be *cheaper*
  than a serve, or shedding itself becomes the overload.
- **Little's Law is your sanity check.** `L = λ × W`: optimal concurrency =
  throughput × *min* latency. If your learned limit drifts far from
  `C × RTTnoload`, the controller is wrong — use this to validate it.
- **Instrument everything** with Prometheus: offered rate, admitted rate, shed
  rate, current limit, in-flight, p50/p99/p999 (admitted only *and* end-to-end),
  and the latency gradient. The current-limit timeseries is the money graph.
- Keep the limiter a standalone, importable package with an `http.Handler`
  middleware adapter — it should be reusable across services, not welded in.

## 7. Data model

There's no database; the "state" is the controller's internal estimate, and the
observable artifact is the metrics timeseries:

```
LimitEstimator (per instance):
  limit        float64   // current concurrency limit (the learned number)
  inFlight     int64     // atomic; admitted-but-not-yet-completed
  rttNoLoad    float64   // running min latency  (Little's Law W)
  rttActual    EWMA      // smoothed recent latency
  // gradient = clamp(rttNoLoad / rttActual, 0.5, 1.0)
  // newLimit  = limit*gradient + queueHeadroom   (Vegas-style)

Sample (fed back per request):
  latency  time.Duration
  outcome  enum{ served, shed, errored }
  class    enum{ high, low }
```

Express the validation invariant directly from Little's Law:
`learnedLimit ≈ goodput × rttNoLoad` at steady state.

## 8. Interface contract

- Wrapped service endpoint: `POST /work` (does the configurable work).
  - `200` — served. `429`/`503` — shed, with `Retry-After: <seconds>` and a body
    naming the reason (`limit_exceeded`).
- Priority: `X-Priority: high|low` header (default `low`).
- `GET /limiter/stats` → `{ limit, in_flight, offered_rate, admit_rate,
  shed_rate, rtt_noload_ms, p99_ms }`.
- `GET /metrics` → Prometheus exposition (the graphs that prove the SLO table).
- Flags/env: `-algo=fixed|aimd|gradient`, `-shed=reject|queue`, `-queue-max`,
  `-priority`, `-reserved-high`, and the service-side `-cpu-work`,
  `-downstream-latency`, `-max-workers`.

## 9. Key technical challenges

- **Making collapse reproducible.** A toy handler that's pure CPU won't collapse
  — it just gets slower linearly. You need a contention point (bounded worker
  pool, lock, or a downstream that degrades superlinearly under load) so that
  *adding* in-flight work *reduces* goodput. Building an honest cliff is half the
  lab.
- **Tuning the controller without oscillation.** Too-aggressive AIMD oscillates
  (saw-tooth limit, saw-tooth p99); too-timid never finds capacity. The gradient
  estimator is smoother but sensitive to a bad `RTTnoload` (one lucky fast
  request poisons the baseline). Decide how you age `RTTnoload`.
- **Shed-vs-queue is a real trade.** A small bounded queue absorbs micro-bursts
  and *raises* goodput; an unbounded queue *is* the latency cliff. Find the queue
  depth where it flips from helping to hurting.
- **Retry storms.** Shedding without client backoff can *increase* offered load
  (every 429 becomes an immediate retry). Show that `Retry-After` + jitter is
  load-bearing, not cosmetic.
- **Priority inversion under reservation.** Reserving headroom for `high` wastes
  capacity when there's no `high` traffic; not reserving it means a flood of
  `low` can starve `high` for a control-loop cycle. Measure the gap.

## 10. Experiments to run (break it / tune it)

Record before/after numbers and attach the graph for each:

1. **Find the cliff (baseline).** No limiter. Sweep offered load 0.25×→4× `C`.
   Plot **goodput vs offered load** and **p99 vs offered load** on the same x-axis.
   Mark the knee. This curve — goodput turning *down* — is the headline artifact.
2. **Adaptive holds the knee.** Repeat the sweep with `gradient` limiter on.
   Overlay the goodput curve on experiment 1: it should go flat at ≈ `C` instead
   of collapsing, and p99 should stay bounded while shed rate climbs.
3. **AIMD vs gradient convergence.** Step offered load from 0.5× to 2× `C` and
   plot the **learned limit over time** for both estimators. Measure: time to
   converge, steady-state oscillation amplitude, and resulting p99 jitter.
4. **Shed vs queue under overload.** At 2× `C`, compare `reject` vs `queue`
   (sweep queue depth 0, 8, 64, 512). Plot admitted p99 and success rate. Find
   the depth where queueing stops helping and becomes the cliff.
5. **Retry storm.** At 1.5× `C` with shedding on, run the driver **with** vs
   **without** `Retry-After`-honoring backoff. Show effective offered load (and
   thus shed rate) inflating when backoff is off.
6. **Priority shedding.** At 3× `C` with the 20/80 high/low mix, turn priority
   on. Show `high` success ≥ 99% while `low` absorbs the shed. Then remove the
   reserved-headroom and show `high` taking a transient hit during the control
   cycle.
7. **Recovery speed.** Spike profile (0.8×→3×→0.8×). Measure how long after the
   spike ends until the learned limit re-opens and p99 returns to knee-level.
   Compare AIMD vs gradient recovery.
8. **Little's Law check.** At three steady states, verify
   `learnedLimit ≈ goodput × rttNoLoad`. Report the residual; a big gap means the
   controller is mis-estimating.

## 11. Milestones

1. Target service with a *real* contention point; driver in open model with a
   coordinated-omission–safe histogram; Prometheus + a Grafana board for
   offered/admitted/shed/limit/p99.
2. Baseline cliff: experiment 1 reproduced — goodput collapse + p99 explosion
   plotted and explained.
3. AIMD + gradient limiters behind one interface; experiment 2 (holds the knee)
   and 3 (convergence) done.
4. Shedding strategies: reject vs queue (4), retry storm (5).
5. Priority shedding (6) + recovery (7) + Little's Law validation (8); findings
   note.

## 12. Acceptance criteria (definition of done)

- [ ] An **unprotected** goodput-vs-offered-load curve that visibly *collapses*
      past the knee, with the contention cause named and proven (pprof / lock
      profile / downstream saturation).
- [ ] The **same curve with the adaptive limiter on**, overlaid, holding goodput
      ≥ 0.90× `C` at 3× offered load with bounded p99 (≤ 1.5× knee p99).
- [ ] Shed responses measured returning in < 5 ms with a `Retry-After`; shed rate
      reported, not hidden.
- [ ] AIMD-vs-gradient learned-limit-over-time plot with convergence and
      oscillation numbers.
- [ ] Shed-vs-queue plot identifying the queue depth where queueing flips from
      helping to hurting.
- [ ] Priority run showing `high` success ≥ 99% at 3× load while `low` absorbs
      the shed.
- [ ] Recovery-after-spike time reported for both estimators.
- [ ] Little's Law residual reported at ≥ 3 operating points.
- [ ] Every number reproducible from a committed command + config.

## 13. Stretch goals

- **Server-side adaptive concurrency on the downstream too**, so the limiter
  reacts to a *dependency's* degradation, not just its own CPU.
- **Brownout / graceful degradation:** instead of a hard shed, downgrade
  expensive requests (skip a recommendation call, serve a cached/cheaper
  response) so partial service beats no service.
- **CoDel-style adaptive shedding** on a bounded queue (drop based on sojourn
  time, not depth) and compare to fixed-depth queueing.
- **Per-endpoint limits:** a slow endpoint shouldn't consume the whole instance's
  concurrency budget — bulkhead the limit per route.
- **Closed-loop interaction with autoscaling:** emit the shed rate as a scaling
  signal and show the limiter buying time until replicas arrive.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Overload model | Reproduces the latency cliff | Names and **proves** the contention cause; ties the knee to Little's Law |
| Adaptive limiting | Limiter keeps the service alive under load | Holds goodput flat at the knee with bounded p99; explains *why* concurrency limiting self-tunes where rate limiting can't |
| Estimator design | Picks AIMD or gradient and it works | Quantifies convergence vs oscillation trade-off; tunes `RTTnoload` aging deliberately |
| Shedding | Returns 429/503 instead of falling over | Sheds in < 5 ms, honors `Retry-After`, proves shed-vs-queue trade and the retry-storm risk |
| Priority / degradation | Drops low-priority first under load | Reserves headroom with measured cost; reasons about priority inversion and brownout |
| Communication | Clear findings note + the cliff graph | Could defend the goodput-vs-load overlay and the convergence curve to a staff panel |

## 15. References

- Netflix Technology Blog — *"Performance Under Load: Adaptive Concurrency
  Limits"*; the `Netflix/concurrency-limits` library (AIMD, Gradient, Gradient2
  estimators) — the canonical implementation of this idea.
- **Little's Law** (`L = λW`): optimal in-flight concurrency = throughput × min
  service time; the validation anchor for §7's invariant.
- TCP congestion control (Reno AIMD; **TCP Vegas** delay-as-signal) — the direct
  intellectual ancestor of latency-driven concurrency limiting.
- Nichols & Jacobson, *"Controlling Queue Delay"* (CoDel) — adaptive,
  sojourn-time-based shedding for the queueing variant.
- *Site Reliability Engineering* (Google) — "Handling Overload" & "Addressing
  Cascading Failures": load shedding, graceful degradation, retry budgets.
- `golang.org/x/sync/semaphore` — the in-flight admission gate.
- See also: `Interview Question/22-scalability-and-high-availability/` and
  `Interview Question/17-performance-engineering/`.
