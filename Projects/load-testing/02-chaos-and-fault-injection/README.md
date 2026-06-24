# Chaos & Fault-Injection Lab

> Load tells you how the system behaves when everything works. Chaos tells you
> how it behaves when something doesn't. Put a multi-service system under
> sustained, realistic load, then deliberately break a piece of it — inject
> 200 ms of latency, kill a node, drop packets, skew a clock — and prove the
> system stays inside its SLO. If it doesn't, learn *exactly* how it fails before
> production teaches you the same lesson at 3 a.m.

| | |
|---|---|
| **Tier** | Load-testing (meta-skill) |
| **Primary domain** | Resilience verification / distributed systems |
| **Skills exercised** | Chaos-engineering method, fault injection (`toxiproxy`, `tc`/`netem`, `cgroups`, process kill, clock skew), steady-state hypotheses, blast-radius control, game days, Go, Prometheus, observability-driven analysis |
| **Interview sections** | 13 (distributed systems), 22 (scalability & high availability), 18 (observability) |
| **Est. effort** | 4–6 focused days |

---

## 1. Context

You own a small constellation of services: an `api` gateway in front of an
`orders` service, which calls a `payments` dependency and reads/writes a
Postgres primary with one replica, all fronted by Redis. It works fine in the
happy path. Then last quarter a single slow dependency — `payments` started
taking 800 ms instead of 40 ms — turned into a full outage: `orders` ran out of
goroutines waiting on it, the `api` gateway's connection pool filled, health
checks went red, and the whole thing fell over. Nobody had a timeout. Nobody had
a circuit breaker. Nobody knew, because nobody had ever tested it.

Your job in this lab is to stop *guessing* whether the system is resilient and
start *proving* it. You will define what "healthy" means as a measurable
hypothesis, run the system under load, inject one fault at a time, and watch
whether the SLO holds. Where it doesn't, you'll add a mitigation (timeout,
retry-with-budget, circuit breaker, bulkhead, graceful degradation) and
re-measure. You produce evidence — blast-radius numbers and recovery curves —
not assurances.

## 2. Goals / Non-goals

**Goals**
- Practice the chaos-engineering loop as a discipline: **steady-state hypothesis
  → inject fault → measure → learn → mitigate → re-measure.**
- Inject the canonical fault families against a live, loaded system: network
  latency, packet loss, dependency errors, dependency full outage, process kill,
  CPU/memory starvation, disk-full, and clock skew.
- Quantify **blast radius** (which SLIs degrade, by how much, for how many
  tenants/endpoints) and **MTTR** (time from fault removal to SLO recovery).
- Show the difference between **resilience** (absorb the fault, stay in SLO) and
  **recovery** (heal after the fault) — and demonstrate at least one of each.
- Tie every failure you find to a concrete mitigation in the `resilience/` track.

**Non-goals**
- A managed chaos platform (Gremlin, AWS FIS). Run the injectors yourself so you
  understand the mechanism (`tc`, `toxiproxy`, `cgroups`).
- Kubernetes-native chaos (LitmusChaos, Chaos Mesh) — that's a follow-on. Here you
  inject at the process/network layer so the mechanics are visible.
- Building the resilience patterns from scratch — import them from `resilience/`;
  this lab is about *verifying* them under fault, not authoring them.

## 3. Functional requirements

1. A **system under test** (`docker-compose`): `api` → `orders` → `payments`
   (stub), plus Postgres (primary + replica) and Redis. Every service is a Go
   binary instrumented with Prometheus.
2. A **load harness** (`cmd/load`) drives a realistic open-model workload (mixed
   read/write, defined endpoint mix) so faults are exercised *under* traffic, not
   on an idle box.
3. A **fault controller** (`cmd/chaos`) injects and reverts each fault type on
   command, with a precise start/stop timestamp written to the metrics stream so
   experiments are correlatable:
   - **Network:** latency, jitter, packet loss, bandwidth cap (via `tc`/`netem`)
     and connection-level faults (via `toxiproxy`: latency, slow-close, reset).
   - **Process:** SIGKILL a node; rolling restart.
   - **Resource:** CPU pin / memory cap / disk-full (via `cgroups` + `fallocate`).
   - **Clock:** skew a container's clock forward/back.
   - **Dependency:** make `payments` return 5xx, time out, or hang.
4. A **hypothesis runner** that, for each experiment, records the steady-state
   SLI baseline, applies the fault for a fixed window, and emits a verdict:
   **held** (stayed in SLO), **degraded** (out of SLO, recovered), or **failed**
   (cascaded / did not recover).

## 4. Load & data profile

- **Sustained load:** ≥ 30-minute runs at a target rate that puts the system at
  ~60–70% of its breakpoint (so there's headroom to absorb a fault, like
  production). Find that rate first with a ramp.
- **Endpoint mix:** 80% reads (`GET /orders/{id}`, replica-served), 20% writes
  (`POST /orders`, primary + `payments` call). Writes are the ones that hurt under
  dependency faults — by design.
- **Open model:** fixed arrival rate (not closed-loop), so when the system slows
  you see **queueing and lag build**, not an artificially throttled client.
- **Fault window:** each fault is applied for a fixed, repeatable interval
  (e.g. 120 s) with ≥ 60 s of clean baseline before and ≥ 120 s of recovery
  observation after.
- **Determinism:** the load generator is seed-deterministic; the chaos schedule
  is a committed file so any run is reproducible command-for-command.

## 5. Non-functional requirements / SLOs

The steady-state SLO is what the system must hold **while** a single fault is
active. The recovery targets bound what happens **after** it's removed.

| Metric | Steady state (no fault) | Under single fault | After fault removed |
|--------|-------------------------|--------------------|---------------------|
| Request error rate (`api`, write path) | < 0.1% | **< 1%** (degrade, don't collapse) | back < 0.1% within MTTR |
| End-to-end p99 latency (`POST /orders`) | < 250 ms | **< 1 s** (bounded, no unbounded growth) | back < 250 ms within MTTR |
| Read-path availability (`GET`, replica) | ≥ 99.9% | **≥ 99.9%** (reads must not depend on `payments`) | unchanged |
| **MTTR** (fault removed → SLIs back in SLO) | — | — | **< 60 s** for node kill; **< 30 s** for dependency restore |
| **Blast radius** (fraction of endpoints/tenants breaching SLO during fault) | 0% | **quantified & bounded** — write path may degrade, read path must not | 0% |
| Cascading failure | none | **none** — one slow dependency must not exhaust the caller's pool | none |

> The goal is not "no impact." A 200 ms dependency latency injection *should*
> show up. The goal is **bounded, contained, recoverable** impact — and a number
> for each. If the read path falls over because the write-path dependency is
> slow, that's a found defect, not a passing run.

## 6. Architecture constraints & guidance

- **Observability is a prerequisite, not a nice-to-have.** You cannot do chaos
  blind. Before injecting anything, you must have, per service: request rate,
  error rate, p50/p99/p999, in-flight requests, goroutine count, connection-pool
  saturation, and dependency-call latency — all in Prometheus, on a Grafana board
  with the fault windows annotated. If you can't *see* the blast radius, you
  haven't measured it.
- **One fault at a time, under load, with a clean baseline.** Confounding two
  faults makes the result uninterpretable. Automate the baseline → inject →
  recover sequence so it's identical every run.
- **Inject at the layer that reveals the mechanism.** `tc qdisc add ... netem
  delay 200ms` on the `payments` egress shows you the real socket-level behavior;
  `toxiproxy` lets you script connection resets and slow-closes the client must
  survive.
- **Blast-radius control / game days.** Treat each experiment as a mini game day:
  a written hypothesis, a defined stop condition ("abort if read-path error rate
  > 1%"), and a one-command revert. The discipline of *being able to stop* is the
  point.
- **Resilience patterns come from `resilience/`.** Import the circuit breaker /
  bulkhead / timeout from `resilience/03-circuit-breaker-bulkhead-timeout`, the
  load-shedder from `resilience/02-adaptive-concurrency-and-load-shedding`. This
  lab measures whether they actually contain the blast radius.

## 7. Data model

```
hypothesis:   { name, sli, steady_state, slo_threshold, fault, window_s, stop_condition }
fault_event:  { fault_type, target, params, t_start, t_stop }   # emitted as Prometheus annotations
verdict:      { hypothesis, baseline_p99, fault_p99, fault_err_rate,
                blast_radius_endpoints, mttr_s, result: held|degraded|failed }
```

The `fault_event` start/stop timestamps are the join key: every SLI panel is
overlaid with the fault window so "what changed, and by how much" is read
directly off the graph, not inferred.

## 8. Interface contract

- `POST /chaos/inject` `{ type, target, params }` → starts a fault, returns an id
  and `t_start`.
- `POST /chaos/revert/{id}` → stops the fault, returns `t_stop` and observed MTTR.
- `GET /chaos/experiments` → the committed schedule and last verdicts.
- `GET /metrics` on every service → Prometheus exposition.
- Fault params are explicit and reproducible, e.g.
  `{ "type": "latency", "target": "payments", "params": { "delay_ms": 200, "jitter_ms": 50 } }`,
  `{ "type": "loss", "target": "payments", "params": { "pct": 5 } }`,
  `{ "type": "kill", "target": "orders-2" } }`.

## 9. Key technical challenges

- **Faults only matter under load.** Killing an idle node proves nothing. The hard
  part is sustaining a realistic, *steady* load so the fault lands on a system
  with real queues, real connection pools, and real lag dynamics.
- **Containment vs cascade.** A 200 ms dependency delay is harmless *if* the caller
  has a 150 ms timeout and a bounded worker pool; it's an outage if it doesn't.
  The challenge is proving the timeout/circuit-breaker/bulkhead actually fires and
  bounds the blast radius — with a before/after number.
- **Retry amplification.** Naive retries turn 5% packet loss into a self-inflicted
  load spike: every dropped request becomes 2–3 more in flight, and now the
  *retries* are the outage. You must measure offered load vs effective load under
  loss.
- **Resilience vs recovery are different properties.** Absorbing a fault (stay in
  SLO during a dependency error → serve a degraded response) is *resilience*.
  Healing after a node death (failover + lag drain) is *recovery* with an MTTR.
  Many systems have one and not the other; you must demonstrate and distinguish
  both.
- **The clock and the GC.** Clock skew breaks token expiry, leader leases, and
  cache TTLs in non-obvious ways. CPU starvation doesn't just slow handlers — it
  starves the Go GC and scheduler, so p99 explodes super-linearly. These failure
  modes are invisible without the right metrics in place first.

## 10. Experiments to run (break it / tune it)

Each experiment: state the steady-state hypothesis, baseline ≥ 60 s, inject for
the window, observe ≥ 120 s of recovery, record the verdict. Measure
**before/after p99, error rate, blast radius (which SLIs breached), and MTTR.**

1. **Dependency latency (the cascade test).** Inject `netem`/`toxiproxy` 200 ms
   latency into `payments` under load. *Measure:* does the `orders` worker pool
   and `api` connection pool saturate? Does the write-path p99 grow *bounded* or
   *unbounded*? Then enable the timeout + circuit breaker from `resilience/03` and
   re-run — show the breaker opening contains the blast radius to the write path
   and the read path stays at 99.9%.
2. **Node kill + failover (recovery test).** SIGKILL one `orders` replica
   mid-load. *Measure:* failover time, requests dropped/5xx'd during the gap, and
   MTTR back to steady-state p99. Compare with vs without graceful draining.
3. **Packet loss vs retry amplification.** Apply 1%, 5%, 10% loss on the
   `payments` link. *Measure:* offered vs effective request rate. Show how
   unbounded retries amplify load; then add a retry budget + exponential backoff
   with jitter (`resilience/`) and show effective load flatten.
4. **Dependency full outage + graceful degradation.** Make `payments` return 100%
   5xx / hang. *Measure:* can `orders` shed the write path and still serve reads?
   Does it return a fast, correct degraded response (e.g. "payment pending")
   instead of hanging? Quantify the read-path availability held at ≥ 99.9%.
5. **CPU starvation → GC/scheduler effect.** Pin the `orders` container to a
   fraction of a core via `cgroups` under load. *Measure:* p99 vs CPU quota, GC
   pause time, goroutine scheduling latency. Show the super-linear latency cliff
   and where load-shedding (`resilience/02`) should cut in.
6. **Memory pressure / disk-full.** Cap memory until GC thrashes / OOM looms;
   `fallocate` the Postgres volume near full. *Measure:* behavior at the edge —
   does the service fail fast and cleanly, or corrupt/hang?
7. **Clock skew.** Skew a container clock ±5 min. *Measure:* what breaks — JWT
   expiry, cache TTLs, replication/lease logic — and whether the failure is
   contained.
8. **Recovery-time characterization.** For each fault above, after removal, plot
   the SLI recovery curve and extract MTTR. *Measure:* which faults self-heal and
   which need intervention; rank by MTTR.

## 11. Milestones

1. Compose system up; Prometheus + Grafana board with rate/error/p99/pool-
   saturation per service; **prove you can see** a manually induced slowdown.
2. Load harness; ramp to find the breakpoint; settle on a ~65%-of-breakpoint
   steady-state rate with flat lag.
3. Fault controller (`cmd/chaos`) with `tc`/`netem`, `toxiproxy`, kill, `cgroups`,
   clock skew — each with one-command inject/revert and timestamp annotations.
4. Baseline (no-mitigation) chaos run: experiments 1–4. Document every cascade
   and blast radius — these are the "before" numbers.
5. Wire in `resilience/` mitigations; re-run 1–5; produce before/after containment
   and MTTR deltas. Findings note + annotated dashboards.

## 12. Acceptance criteria (definition of done)

- [ ] Observability proven first: a dashboard showing per-service error rate,
      p99, and pool saturation, with fault windows annotated. No blind runs.
- [ ] Steady-state rate chosen with evidence (breakpoint ramp attached).
- [ ] Each fault family (latency, loss, kill, outage, CPU, memory/disk, clock)
      injected under load with a recorded **held/degraded/failed** verdict.
- [ ] Cascade demonstrated **and contained**: experiment 1 before/after shows the
      circuit breaker bounding the write-path blast radius while the read path
      holds ≥ 99.9%.
- [ ] Retry amplification shown, then bounded by a retry budget (effective-load
      curve flattened).
- [ ] Graceful degradation under full dependency outage demonstrated (reads
      served, write path sheds cleanly — not a hang).
- [ ] MTTR reported for node kill and dependency restore, against the SLO targets.
- [ ] Findings note distinguishing **resilience** (absorbed) from **recovery**
      (healed) for each fault, with numbers. Every result reproducible from a
      committed schedule + config.

## 13. Stretch goals

- **Combined / correlated faults:** latency + a node kill at once (real incidents
  are rarely single-cause). Measure whether mitigations compose.
- **Automated game-day runner:** a CI job that runs the chaos schedule nightly and
  fails the build if any verdict regresses from `held` to `degraded`.
- **Blast-radius budget:** define a per-experiment error budget and have the
  runner auto-abort when the stop condition trips — prove the abort works.
- **Kubernetes-native port:** re-implement two experiments with Chaos Mesh /
  LitmusChaos and compare the injection fidelity to the raw `tc`/`toxiproxy`
  version.
- **Steady-state-hypothesis library:** codify the hypotheses as reusable assertions
  so adding a new service comes with a default chaos suite.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Method | Runs faults and watches dashboards | Frames every test as a falsifiable steady-state hypothesis with a stop condition; treats it as a game day |
| Blast radius | Notices the write path degraded | **Quantifies** the radius (which SLIs, how much, how many endpoints) and proves the read path was isolated |
| Cascade containment | Knows timeouts/breakers help | Shows the breaker firing under fault and the measured before/after containment delta |
| Retry behavior | Knows retries can amplify | Measures offered vs effective load; sizes a retry budget from data |
| Resilience vs recovery | Conflates the two | Demonstrates one of each, with MTTR for recovery and SLO-adherence for resilience |
| Observability | Has some metrics | Built the visibility *first*; can read blast radius and MTTR straight off annotated panels |
| Communication | Lists what broke | Could defend each verdict and mitigation to a staff resilience review |

## 15. References

- Basiri et al., "Chaos Engineering" (the Netflix paper) — steady-state
  hypothesis, blast radius, and running experiments in production.
- *Chaos Engineering* (Rosenthal & Jones) — the discipline, game days, and the
  experiment loop.
- *Designing Data-Intensive Applications* — Ch. 8 (unreliable networks, clocks)
  and Ch. 5 (replication & failover).
- `tc`/`netem` and `toxiproxy` docs — network and connection-level fault
  injection; Linux `cgroups` for CPU/memory starvation.
- Google SRE Book — error budgets, MTTR, and graceful degradation.
- See also: the `resilience/` track — `02-adaptive-concurrency-and-load-shedding`,
  `03-circuit-breaker-bulkhead-timeout`, and retry-with-budget patterns are the
  mitigations this lab verifies.
- See also: `Interview Question/13-distributed-systems/` (failure modes, failover,
  cascading failures) and `Interview Question/22-scalability-and-high-availability/`
  (blast radius, MTTR, graceful degradation, observability under fault).
