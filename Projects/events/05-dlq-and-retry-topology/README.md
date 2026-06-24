# Dead-Letter Queues & Retry Topology

> A downstream is flaky and some of your messages are poison. Build the retry
> topology that lets transient failures heal, parks the poison, keeps the happy
> path fast under load — and prove that *nothing* is silently lost or stuck
> retrying forever. Find the failure rate where your DLQ grows without bound.

| | |
|---|---|
| **Tier** | Lab (event-engineering) |
| **Primary domain** | Messaging reliability / consumer design |
| **Skills exercised** | Non-blocking retry topics, exponential backoff + jitter, parking-lot DLQ, idempotency, transient-vs-permanent error classification, head-of-line blocking, Go (`twmb/franz-go`) |
| **Interview sections** | 11 (messaging), 13 (distributed systems), 17 (performance) |
| **Est. effort** | 3–5 focused days |

---

## 1. Context

You own a Kafka consumer that processes `orders` and calls a downstream service
(payments, inventory, an email API) for each message. Reality intrudes:

- The downstream is **transiently flaky** — timeouts, 503s, brief partitions.
  These succeed on retry seconds later.
- A fraction of messages are **poison**: malformed payloads, references to
  deleted entities, a bug that will *always* throw on this exact message. No
  amount of retrying fixes them.
- During an incident the downstream goes **fully down**, and *every* in-flight
  message starts failing at once.

The naive consumer retries each message in place until it succeeds. That works in
a demo and collapses in production: one poison message blocks its partition
forever (head-of-line blocking), and a downstream outage turns into an
ever-growing retry spin that pins CPU and stalls every partition behind it.

Your job is to design a **retry + dead-letter topology** that separates these
three failure modes, recovers the transient ones without blocking the happy
path, parks the permanent ones for human/automated inspection, and never loses or
infinitely re-delivers a message. You will produce numbers — throughput under
failure, DLQ growth curves, ordering impact — not opinions.

## 2. Goals / Non-goals

**Goals**
- Build a **non-blocking** retry pipeline using tiered delay/retry topics, and
  show it sustains throughput while a blocking in-place retry consumer does not.
- Implement **exponential backoff with jitter** and a hard **max-retries → DLQ**
  (parking lot) boundary; prove nothing retries forever.
- Make processing **idempotent** so a message redelivered across retry tiers (or
  reprocessed after a crash) never double-applies its effect.
- **Classify** transient vs permanent errors and route them differently (retry
  vs straight-to-DLQ); measure the cost of getting that classification wrong.
- Provide **DLQ inspection + replay** (manual and automated) and prove replay is
  correct and idempotent.
- Quantify the **cost of retries** on overall throughput and on ordering.

**Non-goals**
- Building the downstream service. Use a stub whose failure rate and latency are
  injectable by flag.
- Exactly-once *produce* semantics across the whole pipeline — that's the
  `events/07-idempotent-inbox-outbox` and `staff/05` labs. Here, at-least-once
  delivery + idempotent processing is the contract.
- A managed retry framework (Spring Retry, etc.). Build the topology yourself so
  you see the topics, offsets, and ordering trade-offs.

## 3. Functional requirements

1. A **producer** (`cmd/producer`) emits messages to topic `orders` at a
   configurable rate, with a configurable share of **poison** messages
   (deterministic given a seed, so the same messages are always poison).
2. A **processor** (`cmd/processor`) consumes `orders`, calls the downstream
   stub per message, and on failure routes via the retry topology rather than
   blocking. It supports two modes by flag:
   - `blocking` (baseline) — retry in place on the main topic, blocking the
     partition until success or give-up.
   - `non-blocking` — publish failures to the next retry tier and commit the
     original offset, freeing the partition.
3. **Tiered retry topics** with increasing delay, e.g.
   `orders.retry.5s` → `orders.retry.30s` → `orders.retry.5m`. A retry consumer
   waits out the tier's delay, reprocesses, and on repeated failure promotes the
   message to the next tier.
4. After `max_retries`, the message goes to a **DLQ** (`orders.DLQ`) with its
   full failure metadata (original topic/partition/offset, attempt count, last
   error, first-seen timestamp) in headers.
5. A **downstream stub** (`cmd/downstream` or in-process) with injectable
   transient failure rate, poison detection, and latency, plus an `outage`
   switch that fails 100% for a window.
6. A **DLQ tool** (`cmd/dlq`) to **inspect** parked messages and **replay** them
   (selectively or in bulk) back onto `orders` after a fix.
7. Processing is **idempotent**: applying a message N times has the same effect
   as applying it once (dedup keyed by a business/message id).

## 4. Load & data profile

- **Throughput:** sustain **≥ 50k msg/s** through `orders` for a ≥ 20-minute run
  (tune to your hardware; state your number and hold it constant across runs).
- **Transient failure rate:** sweep **5% → 15% → 30%** of messages fail
  transiently on first attempt, then succeed within 1–3 attempts. This is the
  primary load knob.
- **Poison rate:** **1%** baseline of messages are permanently poison; in the
  DLQ-growth experiment sweep poison **0.1% → 1% → 5% → 10%** to find where the
  DLQ outpaces drain.
- **Message size:** 512 B JSON order with a unique `order_id` (idempotency key).
- **Generator:** `cmd/gen` / producer flag deterministic via seed; the *same*
  `order_id`s are poison every run so DLQ contents are reproducible.
- **Traffic model:** open-model producer (fixed send rate, not "as fast as the
  consumer drains") so retry backlog and DLQ growth are observable, not masked.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Happy-path throughput under 15% transient failure (non-blocking) | ≥ 90% of zero-failure throughput; **state and defend the number** |
| Head-of-line blocking from a single poison message (non-blocking) | **Zero** — poison message must not stall its partition |
| Transient recovery success | ≥ 99.9% of transient failures eventually succeed within the retry tiers (not in DLQ) |
| Time-to-DLQ for a poison message | Bounded and known: `Σ tier delays`; report it (e.g. ~5m35s for 5s+30s+5m) |
| DLQ growth at 1% poison, steady state | **Bounded** — DLQ arrival rate ≈ poison rate × input rate; not super-linear |
| Retries-forever | **Impossible by construction** — prove `max_retries` is hard |
| End-to-end p99 for a once-failed-then-succeeded message | < (first retry delay + tier processing); report it |
| Loss | **Zero** — every produced message ends in success **or** DLQ; `success + DLQ == produced` |

> The point is not a magic throughput number — it's to **find** where your
> topology stops being free (failure rate, poison rate, ordering) and **explain**
> each curve.

## 6. Architecture constraints & guidance

- Kafka via `docker-compose` (KRaft mode, pinned version). Topics: `orders`,
  `orders.retry.5s`, `orders.retry.30s`, `orders.retry.5m`, `orders.DLQ`.
- Go client: **`twmb/franz-go`** (good batching control, header access,
  per-record control). Keep producer, processor, retry consumers, and DLQ tool
  as separate binaries so you can scale and kill them independently.
- **Non-blocking retry mechanics:** a retry consumer must *honor the tier's
  delay* without blocking the partition. Two valid designs — pick one and
  defend it:
  - **Sleep-to-delay:** the retry consumer reads a record, sleeps until
    `record.timestamp + tier_delay`, then processes. Pause partition fetch while
    sleeping so you don't buffer unboundedly; one consumer per tier topic.
  - **Time-bucketed topics:** delay is encoded by *which* topic the message
    sits in; a scheduler promotes due messages. (More plumbing, finer control.)
- **Backoff:** exponential base with **full jitter** (`sleep =
  random(0, base·2^attempt)`), capped. State why jitter matters here
  (de-synchronizing a retry storm — see §9).
- **Idempotency:** dedup on `order_id` in the downstream store inside one
  transaction; a redelivered message is a no-op, not a double-apply.
- Instrument everything with **Prometheus**: per-topic consume rate, per-tier
  retry rate, DLQ arrival rate + total, attempt-count histogram, head-of-line
  stall time, end-to-end latency p50/p99/p999, partition lag per topic.

## 7. Data model

```
order:   { order_id string, customer_id string, amount int64, ts int64, payload []byte }

retry/DLQ headers (carried on every retried/parked record):
  x-orig-topic       string   // "orders"
  x-orig-partition   int32
  x-orig-offset      int64
  x-attempts         int32    // incremented each tier hop
  x-first-seen       int64    // ms epoch of first failure
  x-last-error       string   // classified reason
  x-error-class      string   // "transient" | "permanent"

downstream idempotency ledger:
  applied(order_id PK, applied_at TIMESTAMPTZ)   -- dedup guard, checked in the apply txn
```

A message's "attempt budget" is `len(retry_tiers)`; exceeding it routes to
`orders.DLQ` with the headers above intact, so the parked record is
self-describing for inspection and replay.

## 8. Interface contract

- **Processor flags:** `-mode={blocking|non-blocking}`, `-max-retries`,
  `-tiers=5s,30s,5m`, `-backoff-base`, `-backoff-cap`, `-jitter={none|full}`,
  `-classify={on|off}`.
- **Downstream stub flags:** `-fail-rate`, `-poison-detect`, `-latency`,
  `-outage-window` (e.g. fail 100% for 60s starting at T+5m).
- **DLQ tool:** `dlq inspect [--filter=error-class=permanent]` lists parked
  messages with headers; `dlq replay [--ids=… | --all | --since=…]` republishes
  to `orders`.
- `GET /metrics` → Prometheus exposition for every binary.

## 9. Key technical challenges

- **Head-of-line blocking.** In-place retry holds the partition offset until the
  message succeeds. One poison message → the whole partition stalls and lag on
  *good* messages climbs without bound. The non-blocking topology must commit the
  original offset and move the failure aside. Prove the difference.
- **Transient vs permanent classification.** Retrying a permanent error wastes
  the entire tier budget and delays parking by `Σ tier delays`. Sending a
  transient error straight to DLQ loses recoverable work. Build a classifier
  (error type, HTTP class, validation result) and measure the cost of
  misclassification both ways.
- **Retry storms / amplification.** When the downstream goes fully down, *every*
  message fails and floods the retry tiers at once. Without jitter, they all come
  due at the same instant and hammer the (still-recovering) downstream in a
  synchronized wave — a self-inflicted DoS. Full jitter spreads the reload; a
  **circuit breaker** in front of the downstream stops feeding it entirely while
  it's open. See the sibling
  [`resilience/03-circuit-breaker-bulkhead-timeout`](../../resilience/03-circuit-breaker-bulkhead-timeout/)
  — retry storms are exactly what circuit breaking exists to prevent.
- **Ordering.** Moving a failed message to a retry topic means later messages for
  the same key pass it. For keyed/ordered streams this breaks per-key ordering.
  Decide explicitly: sacrifice global ordering (fast), or hold a per-key "parking
  lock" so later messages for a failed key also wait (correct, slower). Measure
  both.
- **DLQ unboundedness.** DLQ is a *queue*, not a black hole. If poison arrival
  rate exceeds your replay/triage rate, it grows forever. Find the poison rate at
  which it diverges; design alerting on DLQ arrival-rate, not just total.
- **Idempotent replay.** Replaying the DLQ re-injects messages that may have
  *partially* applied before failing. Without the dedup ledger, replay
  double-applies. Prove replay is a no-op for already-applied work.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each:

1. **Blocking vs non-blocking under load.** At 15% transient failure + 1% poison,
   run both modes. **Measure:** happy-path throughput, per-partition lag, and
   head-of-line stall time (how long a good message waits behind a poison one).
   Show blocking mode's lag climbing monotonically while non-blocking stays flat.
2. **Failure-rate sweep.** Non-blocking mode at transient failure 5% → 15% → 30%.
   **Measure:** throughput, retry-topic volume, and the multiplier — at 30%
   transient, how many total broker messages per input message (amplification
   factor)?
3. **Backoff schedule tuning.** Sweep tier delays (`5s,30s,5m` vs `1s,5s,30s` vs
   `10s,1m,10m`) and `jitter={none|full}`. **Measure:** transient recovery
   success %, mean time-to-success, and whether short tiers cause re-hammering.
4. **Poison-rate → DLQ growth.** Sweep poison 0.1% → 1% → 5% → 10% with a fixed
   triage/replay rate. **Measure:** DLQ arrival rate and total over time; find
   the poison rate where DLQ growth outpaces drain and grows unbounded. Plot it.
5. **Ordering impact.** Keyed stream (orders per `customer_id`). Run with retry
   topics and **measure:** how often a later message for a key is processed
   before an earlier failed one (out-of-order rate). Then enable per-key parking
   lock and re-measure ordering vs throughput cost.
6. **DLQ replay correctness.** Let the DLQ fill with 1% poison; "fix" the
   downstream (poison now succeeds); replay `--all`. **Prove:** every replayed
   message applies exactly once (`applied` ledger has no duplicates), and
   `success + remaining_DLQ == produced`.
7. **Retry storm.** At T+5m trigger a 60s full downstream outage. **Measure:**
   the synchronized retry wave when it recovers (with `jitter=none`), then repeat
   with `jitter=full` and with a circuit breaker in front. Show the breaker/jitter
   flattening the reload spike and preventing amplification.
8. **Misclassification cost.** Run `-classify=off` (everything retries) vs `on`.
   **Measure:** wasted retry volume on permanent errors and the delay-to-park
   difference (`Σ tier delays` vs immediate DLQ).

## 11. Milestones

1. Compose cluster + topics; producer with injectable poison; blocking-mode
   processor; Prometheus + Grafana board for per-topic rate/lag/DLQ.
2. Non-blocking tiered retry topology + max-retries→DLQ; experiment 1 (the
   head-of-line proof).
3. Backoff+jitter and error classification; experiments 2–3, 8.
4. Idempotent apply + DLQ inspect/replay tool; experiment 6 (replay correctness).
5. Ordering, DLQ-growth, and retry-storm investigations; experiments 4, 5, 7;
   findings note.

## 12. Acceptance criteria (definition of done)

- [ ] Side-by-side run proving non-blocking holds **flat** lag while blocking
      mode's lag climbs under one poison message (dashboard screenshot).
- [ ] No-loss invariant shown: `success + DLQ == produced` exactly, after a run
      with mixed transient + poison + a downstream outage (show the counts).
- [ ] `max_retries` proven hard: no message exceeds the tier budget; time-to-DLQ
      equals `Σ tier delays` and is reported.
- [ ] DLQ-growth curve plotted across poison rates, with the divergence point
      named.
- [ ] Replay proven idempotent: replay `--all`, then `applied` ledger has zero
      duplicate `order_id`s (show the SQL/diff).
- [ ] Retry-storm experiment shows jitter + circuit breaker flattening the
      synchronized reload (before/after spike).
- [ ] Ordering trade-off measured both ways (out-of-order rate vs per-key-lock
      throughput cost).
- [ ] Every number reproducible from a committed command + config + seed.

## 13. Stretch goals

- **Adaptive max-retries:** vary the attempt budget by `x-error-class` (more
  patience for transient, immediate park for permanent).
- **Auto-replay with guardrails:** a controller that drains the DLQ at a capped
  rate once the downstream is healthy, with a kill-switch if failures recur.
- **DLQ alerting on arrival-rate** (not total) + a "DLQ growing unbounded" SLO
  burn alert; show it firing in the poison-sweep.
- **Bloom-filter dedup** instead of the `applied` table; measure memory vs the
  correctness window and the false-positive risk on replay.
- **Per-tenant DLQs / fair triage** so one noisy producer can't starve another's
  replay budget (ties into `resilience/04-hierarchical-multitenant-quotas`).

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Topology design | Builds tiered retry + DLQ that works | Defends non-blocking over blocking with head-of-line numbers; justifies tier delays |
| Head-of-line blocking | Knows in-place retry blocks the partition | Proves it with lag curves; shows non-blocking eliminates it |
| Error classification | Splits transient vs permanent | Measures misclassification cost both ways; tunes the boundary |
| No-loss / no-spin | Messages end in success or DLQ | Proves `success+DLQ==produced` and `max_retries` hard through an outage |
| Retry storms | Adds backoff + jitter | Explains synchronized reload; pairs jitter with a circuit breaker and measures the flattened spike |
| Ordering | Notices retry topics reorder a key | Quantifies out-of-order rate; chooses (and defends) sacrifice-vs-lock |
| Idempotent replay | Replay works in happy path | Proves replay is a no-op for partially-applied work |
| Communication | Clear findings note | Could defend every curve (DLQ growth, storm reload) to a staff panel |

## 15. References

- Kafka docs: consumer offset management, headers, `pause`/`resume` fetch.
- Uber Engineering — "Building Reliable Reprocessing and Dead Letter Queues with
  Apache Kafka" (the canonical tiered-retry-topic pattern).
- Confluent — "Error Handling Patterns for Apache Kafka" (retry topics, DLQ).
- AWS Builders' Library — "Timeouts, retries, and backoff with jitter" (full
  jitter and why synchronized retries form a storm).
- *Designing Data-Intensive Applications* — Ch. 11 (stream processing,
  at-least-once + idempotence).
- `twmb/franz-go` consumer + producer + record-header examples.
- See also: sibling [`resilience/03-circuit-breaker-bulkhead-timeout`](../../resilience/03-circuit-breaker-bulkhead-timeout/)
  (retry storms ↔ circuit breaking) and
  [`senior/03-durable-job-queue`](../../senior/03-durable-job-queue/)
  (retries/backoff/DLQ in a non-Kafka queue).
- See also: `Interview Question/11-messaging-and-event-streaming/`.
