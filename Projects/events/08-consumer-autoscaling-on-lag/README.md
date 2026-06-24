# Consumer Autoscaling on Lag (KEDA-style)

> Make a Kafka consumer pipeline scale itself on **lag**, not CPU. Absorb a 10x
> spike, drain tens of millions of backlogged events, then prove that the
> scaling itself — every rebalance it triggers — costs less throughput than the
> backlog it clears. Find the partition ceiling where adding pods stops helping.

| | |
|---|---|
| **Tier** | Lab (event-engineering) |
| **Primary domain** | Elastic stream consumers / Kubernetes autoscaling |
| **Skills exercised** | Kafka consumer groups, consumer-group lag as a scaling signal, rebalance protocols (range vs cooperative-sticky), KEDA + HPA control loop, hysteresis/cooldowns, partition-count ceiling, Go (`twmb/franz-go`), Prometheus, kind/k8s |
| **Interview sections** | 11 (messaging), 19 (devops/k8s), 22 (scalability) |
| **Est. effort** | 3–5 focused days |

---

## 1. Context

You own a Kafka consumer that enriches and writes events to a downstream store.
Most of the day it runs comfortably on 4 pods. But twice a day — a marketing
push and an end-of-day batch from an upstream system — input rate jumps **~10x**
for 10–20 minutes. At a fixed pod count you have two bad options: provision for
the peak (idle pods burn budget 22 hours a day) or provision for the average
(lag climbs into the tens of millions of events during the spike and end-to-end
latency blows past its SLO).

The team's instinct is "just add a CPU-based HPA." It doesn't work: a consumer
that's I/O-bound on the downstream write sits at 30% CPU while lag explodes — CPU
never trips the threshold. The correct signal is **consumer-group lag itself**.

Your job in this lab is to build a pipeline that **scales its consumers up and
down on lag** (KEDA-style), absorbs the spike, drains the backlog, and scales
back to a floor when it's idle — *while accounting for the fact that every scale
event triggers a rebalance that briefly drops throughput.* You will produce
numbers: reaction time, drain time, the per-rebalance throughput dip, and the
point where adding consumers past the partition count buys you nothing.

## 2. Goals / Non-goals

**Goals**
- Drive a **10x traffic spike** onto a running pipeline and have it scale out
  **automatically on lag**, with no human in the loop.
- Build a backlog of **tens of millions of events** and measure: lag buildup
  rate, scale-out reaction time, time-to-drain-to-zero, and the throughput dip
  each scaling rebalance causes.
- Establish that **partition count is the hard ceiling** on useful consumer
  parallelism — and show empirically what over-scaling past it costs.
- Make scaling **stable**: no flapping under bursty load (cooldown/hysteresis),
  and **safe**: scale-down never drops in-flight work or loses messages.
- Quantify the difference between **eager (range)** and **cooperative-sticky**
  rebalancing on the dip per scale step.

**Non-goals**
- Building a general-purpose autoscaler. Use **KEDA + HPA** (or a small
  hand-rolled controller — your choice, but justify it). Don't reinvent KEDA.
- Producer-side autoscaling. The producer is the *load generator* here.
- Multi-cluster / cross-region scaling. Single Kafka cluster, single k8s cluster.
- Cost modeling in dollars — model it in **pod-minutes** and **idle ratio**.

## 3. Functional requirements

1. A **producer** (`cmd/producer`) emits to topic `events` at a configurable
   rate with a **scriptable traffic profile** (steady baseline, step spike,
   bursty/sawtooth). It can hold a **10x step** for a fixed window, then drop.
2. A **consumer** (`cmd/consumer`, `franz-go`) joins consumer group `enrich`,
   processes each event with a configurable **per-message cost** (simulated
   downstream write, e.g. 2–10 ms), and commits offsets after processing.
   Processing time is the knob that sets per-pod throughput.
3. The consumer runs as a **Kubernetes Deployment** on **kind**, scaled by a
   **KEDA `ScaledObject`** using the **Kafka lag trigger** (`lagThreshold`),
   with `minReplicaCount` (floor) and `maxReplicaCount` (ceiling).
4. **Scale-down safety:** on `SIGTERM`, a consumer must stop fetching, finish
   in-flight messages, commit their offsets, and leave the group *cleanly*
   (graceful `terminationGracePeriodSeconds`) — never abandoning uncommitted
   work.
5. **Observability:** export consumer-group lag (per-partition and total),
   per-pod consume rate, rebalance events/duration, in-flight count, and replica
   count to Prometheus. A Grafana board overlays **lag vs replicas vs throughput**
   on one timeline.
6. A **scaling-policy config**: `lagThreshold`, polling interval, HPA
   stabilization windows (scale-up / scale-down), and a max-replicas cap.

## 4. Load & data profile

- **Spike shape:** baseline rate `R` for ≥ 5 min, then a **10x step to `10R`**
  held for 10–15 min, then back to `R`. Choose `R` so the baseline needs ~2–4
  consumers and `10R` needs more consumers than you have partitions can usefully
  feed — that's the point.
- **Backlog target:** during the spike, let lag build to **≥ 20–50 million
  events** before (or while) the autoscaler reacts, so drain time is measurable
  in minutes, not seconds.
- **Partitions:** topic `events` has a **fixed partition count `P`** (start with
  **24**). `P` is the hard ceiling — a consumer-group member without a partition
  is idle. Run one variant with a partition-count *change* (24 → 48) to see its
  effect.
- **Message:** small (256 B) so the bottleneck is per-message processing +
  rebalance cost, not network. Key by `entity_id` (Zipfian, s≈1.1, 5M entities)
  so partition load is realistically skewed.
- **Traffic model:** **open model** (producer sends at a fixed rate regardless of
  consumer drain) — this is what makes lag build observably.
- **Generator:** `cmd/producer` is deterministic given a seed; the traffic
  profile is a committed config (timestamped steps), so a run is reproducible.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| **Scale-out reaction time** (spike start → first new pod *Ready & assigned partitions*) | < 90 s (KEDA poll + HPA stabilization + pod cold-start) — measure & report the breakdown |
| **Lag drain time** (spike ends → total lag back to ≤ 1× `lagThreshold`) | Bounded and reported; lag must **monotonically decrease** once at full parallelism, never plateau above threshold |
| **Max rebalance throughput dip** (per scale step, cooperative-sticky) | < 20% drop in group consume-rate, recovering within < 5 s; eager/range may be far worse — report both |
| **Flapping** | **Zero** scale up↔down oscillations under bursty load once cooldown/hysteresis is tuned; report replica-change count over the run |
| **Scale-down safety** | **Zero** message loss and **zero** double-processing attributable to scale-down: `processed == produced` after a full spike+drain+scale-down cycle |
| **Steady-state idle ratio** | At baseline, replicas == `minReplicaCount`; no pod scaled purely on lag noise |
| **Over-scaling guard** | Beyond `replicas == P`, additional pods sit idle (0 assigned partitions) and add **zero** throughput — demonstrate it, don't just assert it |

> The point is not to hit a magic reaction-time number — it's to **decompose**
> the reaction time (poll interval + HPA window + cold-start + rebalance) and the
> drain time (parallelism × per-pod rate), and to prove the scaling *paid for
> itself* against the backlog it cleared.

## 6. Architecture constraints & guidance

- **Kafka** via `docker-compose` or inside kind (KRaft mode, pinned version),
  topic `events` with `P` partitions. **k8s** via **kind** (single cluster).
- **KEDA** (pinned version) deployed in-cluster; consumer scaled by a
  `ScaledObject` with the **`kafka` scaler** (`bootstrapServers`,
  `consumerGroup`, `topic`, `lagThreshold`, `activationLagThreshold`). KEDA
  drives a standard **HPA** under the hood — tune the HPA `behavior`
  stabilization windows, don't fight them.
- **Go client:** `twmb/franz-go`. Use the **cooperative-sticky** group balancer
  (`kgo.Balancers(kgo.CooperativeStickyBalancer())`) for the low-dip variant and
  `kgo.RoundRobinBalancer()`/range for the eager baseline. Make it a flag.
- **Lag must be the trigger, not CPU.** Explicitly run a CPU-HPA variant and show
  it fails to react (consumer is I/O-bound at low CPU) — that's the motivating
  measurement, keep it.
- **Graceful shutdown** is load-bearing: handle `SIGTERM`, stop polling, drain
  in-flight, commit, `LeaveGroup`. Set `terminationGracePeriodSeconds` longer
  than worst-case in-flight processing.
- Instrument with Prometheus: scrape KEDA/HPA metrics, `kafka_consumergroup_lag`
  (Kafka exporter or `franz-go` admin), per-pod consume rate, and emit a
  **rebalance counter + rebalance-duration histogram** from the `franz-go`
  `OnPartitionsRevoked`/`OnPartitionsAssigned` callbacks.

## 7. Data model

```
event:   { entity_id uint64, payload []byte(256), ts int64, seq uint64 }

scaling signal (what KEDA reads):
  total_lag = Σ_partition (log_end_offset[p] - committed_offset[group, p])

control inputs (committed config):
  lagThreshold            -- target lag *per replica* KEDA aims to hold
  activationLagThreshold  -- lag below which scale-to-zero/floor is allowed
  pollingInterval         -- KEDA metric poll (s)
  hpa.behavior.scaleUp.stabilizationWindowSeconds    -- fast up
  hpa.behavior.scaleDown.stabilizationWindowSeconds  -- slow down (anti-flap)
  minReplicaCount / maxReplicaCount  -- floor / ceiling (ceiling ≤ P to start)
```
KEDA's HPA math is roughly `desiredReplicas = ceil(totalLag / lagThreshold)`,
clamped to `[min, max]` and smoothed by the stabilization windows. Internalize
that formula — it tells you exactly why a too-low `lagThreshold` over-scales and
a too-high one under-reacts.

## 8. Interface contract

- `GET /metrics` (consumer) → Prometheus: `consume_rate`, `inflight`,
  `rebalances_total`, `rebalance_duration_seconds`, `assigned_partitions`.
- KEDA `ScaledObject` (committed YAML) → the lag trigger, thresholds, min/max.
- HPA `behavior` block (committed YAML) → scale-up/down stabilization windows.
- Producer configured via flags/env: `-rate`, `-profile` (steady|step|bursty),
  `-spike-mult` (default 10), `-spike-hold`, `-seed`, `-partitions`.
- Consumer flags: `-process-ms` (per-message cost), `-balancer`
  (cooperative-sticky|range), `-commit` (auto|manual), `-drain-timeout`.

## 9. Key technical challenges

- **Lag is the only honest signal.** CPU/memory don't correlate with backlog for
  an I/O-bound consumer. Proving the CPU-HPA *fails* is half the lesson.
- **The partition ceiling.** A consumer group can have at most `P` actively
  consuming members; member `P+1` gets zero partitions and zero throughput.
  Your `maxReplicaCount` should respect `P` — and you must *show* what happens
  when it doesn't.
- **Scaling triggers rebalances, and rebalances cost throughput.** Every scale
  step changes group membership → a rebalance → a throughput dip. Eager (range)
  protocols **stop-the-world** for all members; cooperative-sticky revokes only
  the moved partitions. The autoscaler can fight itself: scaling to clear lag
  *causes* a dip that briefly *raises* lag. Measure this directly. (This is the
  same rebalance dynamic characterized in
  `labs/01-kafka-throughput-and-exactly-once` — reuse that instinct here.)
- **Flapping.** Lag is noisy; a naive controller scales up, drains, scales down,
  lag rebuilds, scales up again — thrashing pods and rebalancing constantly. The
  fix is asymmetric hysteresis: react **fast up**, **slow down** (long
  scale-down stabilization window + a sane `lagThreshold`).
- **Cold-start latency.** A new pod isn't useful at scheduling time — it must
  pull its image, become Ready, *join the group, and get partitions assigned*
  before it consumes one event. That join is itself a rebalance. Reaction time
  is dominated by this, not by KEDA's poll.
- **Scale-down safety.** Killing a pod mid-batch must not drop or double-process.
  Graceful drain + commit before `LeaveGroup` is mandatory; otherwise the
  uncommitted offsets get reprocessed (at-least-once) or, worse, work is lost if
  commits are mis-ordered.

## 10. Experiments to run (break it / tune it)

Record before/after numbers (lag curve, replica curve, group consume-rate,
rebalance count/duration) for each:

1. **Lag vs CPU as the signal.** Run a **CPU-target HPA** against the 10x spike.
   Show it under-reacts (consumer at ~30% CPU, lag into the tens of millions).
   Switch to the **KEDA lag trigger**; show it reacts. This is the baseline that
   justifies everything else.
2. **Scale-out reaction & drain.** Fire the 10x spike. Measure: (a) reaction time
   broken into KEDA poll + HPA stabilization + pod cold-start + first
   partition-assignment; (b) peak lag reached; (c) **drain-to-zero time** after
   the spike ends. Plot lag, replicas, and throughput on one timeline.
3. **Rebalance dip per scale step: range vs cooperative-sticky.** Re-run the same
   scale-out with `-balancer range` then `cooperative-sticky`. Measure the
   per-step throughput dip and its duration. Quantify how much faster the
   cooperative variant drains because it doesn't stop-the-world on each step.
4. **Over-scaling past the partition count.** Set `maxReplicaCount` to `2P` (e.g.
   48 with `P=24`) and a low `lagThreshold` so KEDA *wants* more pods. Show that
   replicas `P+1 … 2P` get **0 assigned partitions**, add **0** throughput, and
   only **add rebalance churn**. Conclude the correct `maxReplicaCount`.
5. **Flapping under bursty load.** Use the `bursty`/sawtooth profile. With a
   short scale-down stabilization window, show oscillation (count the
   up↔down flips and rebalances). Then apply **hysteresis** — long scale-down
   window + tuned `lagThreshold` — and show flips → 0 while drain SLO still holds.
6. **Scale-down without message loss.** After a spike+drain, let it scale down
   from peak to floor. With graceful drain **off**, show reprocessing / lost
   in-flight work; with graceful drain **on** (drain + commit + LeaveGroup),
   prove `processed == produced` exactly (show the offset diff / dedup count).
7. **Partition-count change mid-life.** Increase `P` from 24 → 48 on a live topic.
   Measure the rebalance it forces, how the new partitions get assigned, whether
   the autoscaler now scales higher (new ceiling), and the transient dip.
8. **`lagThreshold` sweep.** Sweep `lagThreshold` (e.g. 1k / 10k / 100k per
   replica). Show the trade-off: low → over-scales & churns; high → under-reacts
   & lag SLO breached. Recommend a value for the stated drain SLO.

## 11. Milestones

1. kind + Kafka (`P=24`) + KEDA up; `franz-go` consumer Deployment; producer with
   the step profile; Prometheus + Grafana board (lag / replicas / throughput).
2. KEDA `ScaledObject` on the lag trigger; first automatic scale-out on a 10x
   spike; reaction-time breakdown written down (experiment 2).
3. CPU-HPA-fails baseline (experiment 1); cooperative-sticky vs range dip
   measurement (experiment 3).
4. Over-scaling-past-`P` and `lagThreshold`-sweep findings (experiments 4, 8);
   pick `maxReplicaCount` and `lagThreshold`.
5. Hysteresis tuning to kill flapping (experiment 5) and graceful scale-down
   proving zero loss (experiment 6); partition-change run (experiment 7);
   findings note.

## 12. Acceptance criteria (definition of done)

- [ ] A single run where a **10x spike** auto-scales the consumer out **on lag**,
      drains a backlog of **≥ 20M events** to zero, and scales back to the floor —
      with a dashboard screenshot overlaying **lag, replicas, throughput**.
- [ ] **Reaction time decomposed** (KEDA poll + HPA window + cold-start +
      partition assignment) with each component's measured contribution.
- [ ] **Drain-to-zero time** reported and shown monotonically decreasing at full
      parallelism.
- [ ] **Per-step rebalance dip** measured for **both** range and
      cooperative-sticky, with the cooperative dip < 20% and the range dip
      reported alongside.
- [ ] **Over-scaling proof:** with `max > P`, the surplus pods show 0 assigned
      partitions and 0 added throughput (per-pod metric screenshot).
- [ ] **Flapping eliminated:** replica-flip count = 0 under the bursty profile
      after hysteresis tuning, with the before/after flip count shown.
- [ ] **Scale-down safety:** after a full spike+drain+scale-down, `processed ==
      produced` exactly (show the diff), with graceful drain on.
- [ ] Every number reproducible from a committed traffic-profile config,
      `ScaledObject` YAML, and HPA `behavior` YAML.

## 13. Stretch goals

- **Scale-to-zero** at true idle (KEDA `minReplicaCount: 0` +
  `activationLagThreshold`); measure cold-start penalty on the *first* event after
  idle and decide whether it's acceptable for this SLO.
- **Predictive / scheduled pre-scale:** KEDA `cron` scaler to pre-warm pods
  before the known daily spike; compare reaction time and peak lag vs reactive
  lag-only scaling.
- **Static-membership** (`group.instance.id`) to avoid a rebalance on rolling
  restarts; measure the dip difference vs dynamic membership.
- **Hand-rolled controller:** replace KEDA with a small Go controller that reads
  lag and patches the Deployment's replicas. Re-derive the `desiredReplicas`
  formula and the hysteresis yourself; compare stability to KEDA.
- **Multi-consumer-group fan-out:** a second independent group on the same topic;
  show its scaling is isolated and doesn't perturb the first group.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Scaling signal | Uses lag, not CPU | Proves CPU-HPA fails for an I/O-bound consumer; explains *why lag* is the correct controlled variable |
| Reaction time | Reports a number | **Decomposes** it (poll + HPA window + cold-start + assignment) and attacks the dominant term |
| Rebalance cost | Knows scaling triggers rebalances | Measures per-step dip; chooses cooperative-sticky with evidence; accounts for the scale→rebalance→lag feedback |
| Partition ceiling | Knows consumers > partitions are idle | Demonstrates the zero-gain over-scale and sets `maxReplicaCount` from `P` deliberately |
| Stability | Notices flapping | Tunes asymmetric hysteresis (fast-up/slow-down); shows flips → 0 without breaching drain SLO |
| Scale-down safety | Graceful shutdown exists | Proves `processed == produced` through scale-down; explains the drain→commit→LeaveGroup ordering |
| Communication | Clear findings note | Could defend the lag-vs-replicas-vs-throughput timeline to a staff panel |

## 15. References

- KEDA docs: **Kafka scaler** (`lagThreshold`, `activationLagThreshold`,
  `offsetResetPolicy`) and the HPA `behavior` / stabilization-window semantics.
- Kafka docs: consumer groups, partition assignment, **Incremental Cooperative
  Rebalancing** (KIP-429), static membership (KIP-345).
- `twmb/franz-go`: group consumers, `CooperativeStickyBalancer`,
  `OnPartitionsRevoked`/`OnPartitionsAssigned` callbacks, graceful `LeaveGroup`.
- Kubernetes HPA `behavior` (scale-up/scale-down policies & stabilization).
- Rebalance dynamics & throughput dip: `labs/01-kafka-throughput-and-exactly-once`.
- See also: `Interview Question/11-messaging-and-event-streaming/` and
  `Interview Question/22-scalability-and-high-availability/`.
