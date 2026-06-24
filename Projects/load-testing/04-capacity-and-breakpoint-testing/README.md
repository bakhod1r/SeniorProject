# Capacity Planning & Breakpoint Testing

> Take a service that "feels slow under load" and turn it into a defensible
> number: the request rate at which p99 crosses SLO, the throughput knee where
> adding load stops adding work, the breakpoint where it falls over — and the
> one resource that binds all three.

| | |
|---|---|
| **Tier** | Load-testing (meta-skill) |
| **Primary domain** | Capacity & scalability analysis |
| **Skills exercised** | Step-ramp load profiles, throughput-vs-latency curves, Universal Scalability Law, Little's Law, USE method, bottleneck attribution, autoscaling-threshold design, fleet sizing, Go (pprof, `runtime/metrics`) |
| **Interview sections** | 17 (performance engineering), 22 (scalability & HA), 14 (system design) |
| **Builds on** | `load-testing/01-distributed-load-generator` (you need a rig that holds an open-model arrival rate) |
| **Est. effort** | 2–4 focused days |

---

## 1. Context

You own a stateless HTTP service — call it `orders-api`. It does request
validation, one Postgres read, one Redis lookup, and one downstream gRPC call,
then returns JSON. Capacity planning today is folklore: "one pod handles maybe a
few hundred requests a second," autoscaling fires on 70% CPU because that's the
template default, and the last incident postmortem said "the service got slow"
with no number attached.

Your job is to **characterize** `orders-api` under controlled, increasing load
until it breaks, and from that produce a **capacity model**: *X req/s per
instance at SLO, bound by resource R, with H% headroom, therefore N instances
for a Y req/s peak.* You will replace "it's slow" with a curve, a knee, a
breakpoint, and a named binding resource — numbers you could defend to a staff
panel and stake an autoscaling policy on.

## 2. Goals / Non-goals

**Goals**
- Find the **throughput knee** (where latency starts climbing faster than linear)
  and the **breakpoint** (where p99 crosses SLO and/or errors begin) for a single
  instance, expressed in req/s.
- Identify and **prove** the binding resource at saturation (CPU, memory, IO,
  lock contention, or a downstream dependency) using the USE method.
- Cross-check the measured curve against **Little's Law** and the **Universal
  Scalability Law** — predicted vs measured concurrency should agree.
- Derive a **per-instance capacity number at SLO** with explicit headroom, then a
  **fleet-sizing** recommendation and an **autoscaling threshold** anchored to the
  knee — not to a stock 70% CPU rule.
- Demonstrate that removing the proven bottleneck **moves the knee** in the
  predicted direction.

**Non-goals**
- Tuning the application's algorithms. You characterize the service as-is; the
  one allowed change is the targeted bottleneck-removal experiment (§10.5).
- Multi-service / full-system load testing. Single service, controlled
  dependencies — isolate the unit before composing the fleet.
- Chaos / failure injection. That's the resilience lab; here the system is
  *healthy* and we push it to its honest limit.
- Beating a vendor benchmark. The deliverable is *your* number and *why*.

## 3. Functional requirements

1. A **target service** (`cmd/target`) — `orders-api` or a faithful stand-in —
   with one knob that lets you deliberately constrain a resource: e.g. DB
   connection-pool size (`-pool`), worker count (`-workers`), and `GOMAXPROCS`.
2. A **load profile runner** built on the `01-distributed-load-generator` rig,
   driving an **open model** (fixed arrival rate, not closed-loop "as fast as it
   answers"). It must support staged step-ramps: hold a rate for a dwell, step
   up, repeat.
3. The runner emits, per step: offered rate (req/s), achieved rate (req/s),
   p50/p90/p99/p999 latency, error rate, and in-flight concurrency.
4. A **resource sampler** (`cmd/use` or sidecar) capturing, per step and aligned
   to the load timeline: CPU utilization, run-queue/saturation, memory + GC
   pressure, IO wait, lock/mutex contention (Go mutex profile), and downstream
   call latency + saturation.
5. An **analysis step** (script or notebook) that plots throughput-vs-latency,
   marks the knee and breakpoint, and computes the Little's Law and USL fits.

## 4. Load & data profile

- **Profile shape:** step-ramp. Start well below capacity (e.g. 50 req/s), step
  in fixed increments (e.g. +50 req/s) with a **≥ 60 s dwell** per step so the
  system reaches steady state (queues stabilize) before you read the numbers.
  Continue **past** the breakpoint — you must see the cliff, not stop at the knee.
- **Coverage of the six load-test types**, each with its purpose:
  | Type | Profile | What it answers |
  |------|---------|-----------------|
  | Smoke | 1–5 req/s, 1 min | Does it even work; baseline latency floor |
  | Average | sustained ~expected peak | Behavior at normal load |
  | Stress / **breakpoint** | step-ramp until SLO breach / errors | Where it breaks, and on what resource |
  | Spike | flat baseline → instant **10×** → back | Recovery after sudden surge |
  | Soak | knee-ish rate for **≥ 1 h** | Leaks, GC creep, slow resource drift |
  | Capacity (this lab's synthesis) | the ramp, read at SLO | The per-instance number you ship |
- **Request mix:** representative read/write ratio (e.g. 90/10). Don't ramp a
  single trivial endpoint — the knee must reflect real work.
- **Determinism:** fixed seed for payloads and key distribution so two ramps are
  comparable. Keep the dependency (Postgres/Redis) warm and at fixed size.
- **One variable at a time:** instance size, pool size, and `GOMAXPROCS` are
  pinned across a ramp; change exactly one between ramps.

## 5. Non-functional requirements / SLOs

The SLO is the contract that *defines* "broken." Pick it first; the breakpoint is
where you cross it.

| Metric | Target / what to report |
|--------|-------------------------|
| **Latency SLO** (the line) | p99 < **200 ms** at the offered rate (state your own; everything below is relative to it) |
| **Knee throughput** | The req/s where p99 begins rising faster than linear (latency derivative inflects). Report the number. |
| **Breakpoint throughput** | The req/s where p99 first crosses the SLO **or** error rate exceeds 0.1%. Report the number — this is the hard ceiling. |
| **Binding resource at breakpoint** | Named and **proven** (CPU / mem / IO / lock / downstream), with USE evidence attached. |
| **Per-instance capacity at SLO** | Max sustained req/s with p99 < SLO **and** error rate < 0.1%, held for the dwell. |
| **Headroom target** | Operate at **≤ 70% of knee throughput** (or a stated target); state the autoscale-out threshold derived from it. |
| **Little's Law agreement** | Predicted concurrency `L = λ·W` within **±10%** of measured in-flight at 2–3 ramp points. |
| **USL fit** | Throughput curve fits the Universal Scalability Law; report contention σ and coherency κ coefficients and the predicted peak. |

> The goal is not a leaderboard number. It's to **find** this service's number
> and **explain** which resource sets it.

## 6. Architecture constraints & guidance

- **Open-model load only.** Closed-loop generators throttle themselves when the
  service slows, which *hides* the breakpoint (offered load silently drops as
  latency rises). Use the `01` rig's fixed-arrival-rate mode and verify the
  generator itself is not the bottleneck (it must sustain offered rate with
  headroom — check its own CPU and the send-timestamp skew).
- **Isolate the unit under test.** Pin the target to known resources
  (`--cpus`, `--memory` in Docker, or a dedicated node) so the curve reflects the
  service, not a noisy neighbor. Record the exact instance shape — the capacity
  number is meaningless without it.
- **Steady state before you read.** Latency must plateau within the dwell;
  if it's still rising when the step ends, the dwell is too short and your knee
  is an artifact of a growing queue, not capacity.
- **Instrument both sides.** Load side (offered/achieved/latency/concurrency)
  and resource side (USE signals) on **one aligned clock**. Prometheus +
  Grafana, plus Go `net/http/pprof` for CPU and mutex profiles at saturation.
- **Coordinated omission:** measure latency from intended send time, not from
  when the generator got around to sending. The `01` lab covers this; if you got
  it wrong there, every curve here is optimistic.

## 7. Data model

The deliverable is a small, tidy results table per ramp — this *is* the model.

```
ramp_step:  { offered_rps, achieved_rps, p50_ms, p99_ms, p999_ms,
              err_rate, inflight, cpu_util, sat_runq, mem_mb, gc_pct,
              io_wait, mutex_wait_ms, downstream_p99_ms, downstream_util }

capacity_model (derived, one row):
  { instance_shape, knee_rps, breakpoint_rps, slo_rps_per_instance,
    binding_resource, headroom_pct, autoscale_threshold,
    usl_sigma, usl_kappa, usl_peak_rps }
```

USE attribution per resource at the breakpoint step:

```
use_row: { resource, utilization, saturation, errors, verdict }
         -- the resource whose util→~100% OR saturation climbs while
            throughput flattens is the binding one
```

## 8. Interface contract

- Runner config: `-target`, `-start-rps`, `-step-rps`, `-dwell`, `-max-rps`,
  `-mix` (read/write ratio), `-seed`, `-out results.csv`.
- Target knobs (for the bottleneck-removal experiment): `-pool`, `-workers`,
  `-cpus`, `GOMAXPROCS`.
- `GET /metrics` on both target and runner → Prometheus exposition.
- Output: one `results.csv` per ramp (the `ramp_step` rows) + a derived
  `capacity_model.json` (the single row in §7). Every run reproducible from a
  committed command line + config.

## 9. Key technical challenges

- **Reading the latency curve correctly.** It has three regimes: a flat floor
  (latency ≈ service time, queueing negligible), a **gentle rise → knee** (queues
  forming; latency now service time + wait), then the **cliff** (utilization → 1,
  latency → ∞ in theory, timeouts in practice). The knee is an *inflection*, not
  a threshold — find it by the second derivative, not by eyeballing where it
  "looks bad."
- **Attributing the bottleneck, not guessing it.** High CPU might be *effect*,
  not cause — if the real limit is a 20-connection DB pool, threads spin waiting
  and CPU looks busy. USE (Utilization, Saturation, Errors) per resource
  disambiguates: the binding resource is the one whose **saturation** climbs (run
  queue, pool wait, IO wait) while **throughput flattens**.
- **Little's Law as a lie-detector.** `L = λ·W`: in-flight concurrency = arrival
  rate × residence time. At any steady step, predicted `L` must match measured
  in-flight. A mismatch means coordinated omission, a closed-loop generator, or a
  measurement bug — fix it before you trust the curve.
- **The USL knee vs the cliff.** The Universal Scalability Law predicts that
  throughput rises, bends (contention σ), then can *retrograde* (coherency κ) —
  more load yields *less* work (lock convoy, GC thrash, retry storms). Distinguish
  a flat-topped knee (saturation) from a retrograde collapse (negative scaling).
- **Spike ≠ ramp.** A service can pass a slow ramp to 5k req/s yet die on an
  instant 0→5k spike: cold pools, cold caches, autoscaler lag, and queue overflow
  all bite at once. Recovery time after the spike is its own number.

## 10. Experiments to run (break it / tune it)

Record before/after numbers and attach the curve for each.

1. **Step-ramp to knee + breakpoint.** Ramp `orders-api` from 50 req/s in +50
   steps, 60 s dwell, until p99 crosses SLO and error rate climbs. Plot
   throughput (achieved req/s) on x vs p50/p99/p999 on y. Mark the knee (latency
   inflection) and the breakpoint (SLO crossing). *Measure:* knee_rps,
   breakpoint_rps, the latency floor, and the multiplier between them.
2. **USE bottleneck identification at saturation.** At the breakpoint step,
   sample every resource. *Measure:* utilization + saturation + errors for CPU,
   memory/GC, IO, mutex, and the downstream gRPC call. Fill the USE table; name
   the one resource whose saturation rises while throughput flattens. Capture a
   pprof CPU + mutex profile as evidence.
3. **Little's Law cross-check.** At three steps (below knee, at knee, past knee),
   compute predicted `L = λ·W` from achieved rate and measured residence time;
   compare to measured in-flight. *Measure:* the % error at each point. >10%
   error ⇒ investigate (likely coordinated omission or a closed generator).
4. **Spike test + recovery.** Hold baseline (e.g. 30% of knee), then jump
   instantly to **10×** for 60 s, then back. *Measure:* peak p99 during the
   spike, error count, and **recovery time** (seconds until p99 returns to
   baseline). Compare to where the same rate sat on the slow ramp.
5. **Remove the bottleneck → move the knee.** Based on §10.2, relieve the proven
   binding resource (e.g. raise DB pool 20→60, or `GOMAXPROCS` 2→4, or scale the
   downstream). Re-run the ramp. *Measure:* new knee_rps and breakpoint_rps —
   they must move in the predicted direction, and a *new* binding resource should
   appear (you moved the bottleneck, you didn't delete it).
6. **Soak at the knee.** Hold knee-ish rate for ≥ 1 h. *Measure:* p99 drift, RSS
   trend, GC pause trend, connection/file-descriptor counts. A rising line means
   the "capacity" number is only valid for a few minutes — disqualifying.
7. **Derive the capacity model + fleet sizing.** From the SLO-bounded rate,
   produce: per-instance capacity at SLO, headroom-adjusted operating rate,
   autoscale-out threshold (as a % of knee or a CPU/saturation proxy that
   *correlates* with the knee), and **N = ceil(peak_rps / slo_rps_per_instance /
   headroom)** for a stated peak. *Measure:* write the one-row model in §7.

## 11. Milestones

1. Target up with the one constrain-knob; `01` rig wired in open model; Grafana
   board showing offered/achieved/p99/in-flight on one timeline.
2. First clean step-ramp with proper dwell and steady state per step (experiment
   1); knee and breakpoint marked on the curve.
3. USE sampler aligned to the load clock; bottleneck named with pprof evidence
   (experiment 2); Little's Law check passing within ±10% (experiment 3).
4. Spike + recovery and soak runs (experiments 4, 6); USL fit computed.
5. Bottleneck-removal ramp showing the knee moved (experiment 5); capacity model
   + fleet-sizing note written (experiment 7).

## 12. Acceptance criteria (definition of done)

- [ ] A throughput-vs-latency curve, ramped **past** the breakpoint, with knee
      and breakpoint marked and their req/s stated.
- [ ] The binding resource named **and proven** at the breakpoint (USE table +
      pprof/`iostat`/pool-wait evidence), not asserted.
- [ ] Little's Law cross-check within ±10% at ≥ 3 points; deviations explained.
- [ ] USL fit reported with σ, κ, and predicted peak; curve overlaid on data.
- [ ] Spike test recovery time measured; soak shows **flat** p99/RSS over ≥ 1 h.
- [ ] Bottleneck-removal ramp shows the knee moved in the predicted direction and
      a new binding resource identified.
- [ ] A one-row **capacity model**: per-instance req/s at SLO, instance shape,
      binding resource, headroom %, autoscale threshold, and fleet size N for a
      stated peak — every number reproducible from a committed command.

## 13. Stretch goals

- **Two instance shapes:** run the ramp on 2 vCPU and 4 vCPU; show whether
  capacity scales linearly per core or the binding resource doesn't follow CPU
  (it usually doesn't past the knee).
- **Validate fleet sizing for real:** run N instances behind the `01` rig at the
  predicted peak and confirm the fleet holds SLO with the planned headroom.
- **Autoscaling signal selection:** test whether CPU%, in-flight concurrency, or
  queue depth best *tracks* the knee, and recommend the autoscale metric with
  evidence (CPU often lags the true saturation signal).
- **Closed vs open model side-by-side:** run the same target under a closed-loop
  generator and show how it under-reports the breakpoint.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Curve reading | Produces a throughput-vs-latency curve and points at the knee | Locates the knee by inflection, separates floor/knee/cliff regimes, ramps past the cliff |
| Bottleneck attribution | Notices what's saturated | Proves the binding resource via USE + profiles; predicts and confirms the *next* one after relief |
| Quantitative models | Knows Little's Law and USL exist | Uses Little's Law as a measurement check (±10%) and fits USL (σ, κ) to predict the peak |
| Load-test design | Runs a ramp | Picks the right test type per question; runs open-model; defends dwell and steady-state |
| Capacity output | States a req/s number | Ships a defensible capacity model: per-instance at SLO + headroom + autoscale threshold + fleet size, each justified |
| Communication | Clear findings note | Could defend every number — knee, breakpoint, binding resource, fleet N — to a staff panel |

> **Staff bar, in one line:** you walk out with a capacity model you would stake
> an on-call rotation and a cloud bill on — and you can show your work.

## 15. References

- Brendan Gregg — **The USE Method** (Utilization, Saturation, Errors) for
  systematic bottleneck identification; *Systems Performance* (Ch. 2).
- **Little's Law** (`L = λ·W`) — relating concurrency, throughput, and latency at
  steady state; the load-tester's lie-detector.
- Neil Gunther — **Universal Scalability Law** (contention σ, coherency κ); the
  throughput-knee and retrograde-scaling model.
- Grafana k6 — load-test type taxonomy (smoke / average / stress / spike / soak /
  breakpoint) and when each applies.
- Gil Tene — "How NOT to Measure Latency" (coordinated omission; why open-model
  matters).
- See also: `Interview Question/17-performance-engineering/`,
  `Interview Question/22-scalability-and-high-availability/`,
  `Interview Question/14-system-design/`.
- Builds on: `load-testing/01-distributed-load-generator`.
