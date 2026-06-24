# Event-Sourced Order System: CQRS + Saga + Outbox

> Make the append-only event log the *only* source of truth, derive every read
> from it, and orchestrate a multi-service order/payment/inventory workflow with
> sagas — then live with the consequences at billions of events: replay cost,
> projection lag, schema evolution, and the eventual consistency your UI can no
> longer hide from.

| | |
|---|---|
| **Tier** | Staff (architecture / distributed) |
| **Primary domain** | Event sourcing & distributed transactions |
| **Skills exercised** | Event sourcing, CQRS, optimistic concurrency, snapshots, event versioning/upcasting, sagas & process managers, transactional outbox, idempotent projections, Go (`pgx`, Kafka) |
| **Interview sections** | 11 (messaging & event streaming), 12 (architecture), 13 (distributed systems) |
| **Est. effort** | 5–8 focused days |

---

## 1. Context

You own the order domain at a marketplace processing **~3M orders/day** across
order, payment, and inventory services. The current design is a CRUD `orders`
table with a `status` column that three services race to update; nobody can
answer "what did this order look like at 14:03?", a refund bug last quarter was
unauditable, and a new finance read-model means another team wants its own
denormalized view of the same data without taking a lock on your write path.

You're going to rebuild the order lifecycle as a **fully event-sourced** system.
State is a fold over an append-only event log. Writes go through aggregates that
emit events under optimistic concurrency; reads are served by **independently
scaled CQRS projections** that the UI must tolerate as *eventually consistent*.
Cross-service workflows (reserve stock → charge card → confirm, or compensate)
run as **sagas**. Events leave the building through a **transactional outbox**.

This is a staff lab because the hard part isn't the happy path — it's replay at
scale, versioning a schema while billions of old events sit immutable on disk,
and knowing when event sourcing is the *wrong* answer. You will produce numbers,
not opinions.

## 2. Goals / Non-goals

**Goals**
- Build an event store (append-only, per-aggregate streams) holding **≥ 500M
  events** and exercise it to **billions** via replay.
- Enforce correctness on the write side with **optimistic concurrency** keyed on
  stream version; measure the conflict rate on a hot aggregate.
- Serve reads from **≥ 2 independent projections** kept in sync with **bounded
  lag**, and rebuild one from the full log on demand.
- Bound replay cost with **snapshots**; quantify the saving.
- Evolve the event schema with **upcasting** without rewriting history.
- Run a **saga / process manager** across order/payment/inventory with
  **compensation** on a mid-workflow failure.
- Publish via a **transactional outbox**; keep projections **idempotent**.

**Non-goals**
- A full event-store product (EventStoreDB/Marten). Build the mechanics on
  Postgres (+ Kafka for transport) so you see the knobs.
- UI work beyond a thin read API and a staleness probe.
- Global multi-region (that's `staff/04-multi-region-active-active`).

## 3. Functional requirements

1. A **command side** (`cmd/orderd`) accepts commands (`PlaceOrder`,
   `AddItem`, `Pay`, `Cancel`), loads the aggregate by folding its stream,
   validates, and appends new events under an **expected version**.
2. An **append API** rejects a write whose `expected_version` no longer matches
   the stream head (optimistic-concurrency conflict → caller retries).
3. A **projector** (`cmd/projector`) consumes the event log and maintains read
   models: at minimum `order_summary` (UI) and `finance_daily` (rollup). Each
   projection tracks its own checkpoint and is **independently restartable**.
4. A **read API** (`cmd/queryd`) serves projections and exposes the projection's
   `as_of` position so callers can reason about staleness.
5. A **saga** (`cmd/saga`) drives `OrderPlaced → ReserveStock → ChargePayment →
   ConfirmOrder`, with compensations (`ReleaseStock`, `RefundPayment`) when a
   downstream step fails or times out.
6. An **outbox relay** (`cmd/outbox`) publishes appended events to Kafka exactly
   once per event from the relay's perspective (at-least-once delivery + dedup
   downstream).
7. A **replay tool** (`cmd/replay`) rebuilds any projection from event 0 (or from
   the latest snapshot) and reports throughput and total time.
8. A **chaos hook** can kill the payment service mid-saga and inject a malformed
   payload to force a poison-message path.

## 4. Load & data profile

- **Event volume:** seed **≥ 500M** events; demonstrate replay tooling against
  **≥ 2B** (replayed, not all resident as distinct aggregates).
- **Aggregates:** ~50M order streams; **average 8–12 events/stream**, but a
  **Zipfian hot tail** — a few "house account" aggregates accrue **10k+ events**
  each (this is what makes optimistic concurrency bite and snapshots matter).
- **Command throughput:** drive **≥ 5,000 commands/s** sustained for ≥ 20 min,
  with a deliberately **hot aggregate** receiving a concentrated share to provoke
  version conflicts.
- **Generator:** `cmd/gen` is deterministic given a seed; emits a realistic mix
  of place/add/pay/cancel and the occasional already-stale command.
- **Traffic model:** open-model (fixed command rate) so projection lag can build
  and be observed, not hidden by a closed-loop.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Command append p99 (cold aggregate, fold + append) | < 25 ms at 80% of command-throughput ceiling |
| Command append p99 (hot aggregate, 10k+ events, **with** snapshot) | < 40 ms; **without** snapshot, report the blowup |
| Optimistic-concurrency conflict rate (hot aggregate) | Measured & explained; retry policy keeps effective success ≥ 99% |
| Projection lag at steady state (rate below ceiling) | Bounded and flat; p99 event→projected < 2 s |
| Read-after-write staleness window | Measured distribution (p50/p99/max); UI strategy stated |
| Projection rebuild throughput (replay) | ≥ 50k events/s/projector; report total time for the full log |
| Snapshot saving | Replay time **with** vs **without** snapshots, same projection, quantified |
| Saga correctness under failure | After mid-saga payment kill: **no stock leaked, no double charge**; system reaches a consistent terminal state (confirmed or fully compensated) |

> The point isn't a magic number — it's to **find** your system's numbers
> (conflict rate, lag, replay time, staleness window) and **explain** them.

## 6. Architecture constraints & guidance

- **Event store on Postgres**: a single `events` table, append-only, with a
  per-stream monotonic version and a global sequence. Use `pgx` (v5) with the
  binary protocol; batch appends in one transaction per command.
- **Transport via Kafka** for the outbox → projector/saga path. The DB is the
  source of truth; Kafka is *derived* and replayable from it.
- Keep command, query, projector, saga, and outbox as **separate binaries** so
  you can scale and kill them independently — that separation *is* the CQRS
  story.
- **No reads off the write tables in the hot path.** If the UI reads from
  `events`, you've defeated the exercise.
- Instrument with Prometheus: command rate, append p50/p99, conflict rate,
  per-projection lag (global-seq head − checkpoint), event→projected latency,
  outbox backlog, saga in-flight/compensating counts.

## 7. Data model

```sql
-- Append-only event store; per-aggregate streams + global ordering.
events (
  global_seq   BIGINT GENERATED ALWAYS AS IDENTITY,   -- global order for projectors
  stream_id    UUID    NOT NULL,                       -- aggregate id (one order)
  version      INT     NOT NULL,                       -- per-stream, 1..N (gapless)
  event_type   TEXT    NOT NULL,                       -- "OrderPlaced", ...
  event_schema INT     NOT NULL DEFAULT 1,             -- payload schema version (upcasting)
  payload      JSONB   NOT NULL,
  metadata     JSONB   NOT NULL,                       -- correlation_id, causation_id, actor
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (stream_id, version)                     -- optimistic concurrency guard
);
CREATE UNIQUE INDEX ON events (global_seq);
-- Append is: INSERT ... where version = expected+1; a duplicate (stream_id,version)
-- raises unique violation => concurrency conflict => caller reloads & retries.

snapshots (                                            -- bound replay cost per aggregate
  stream_id   UUID PRIMARY KEY,
  version     INT  NOT NULL,                            -- snapshot is valid up to this version
  state       JSONB NOT NULL,                           -- folded aggregate state
  taken_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Read models (CQRS). Each owns its checkpoint; independently rebuildable.
order_summary (                                         -- UI projection
  order_id UUID PRIMARY KEY, status TEXT, total_cents BIGINT,
  item_count INT, updated_seq BIGINT
);
finance_daily (day DATE, gross_cents BIGINT, refunds_cents BIGINT, PRIMARY KEY(day));
projection_checkpoint (name TEXT PRIMARY KEY, last_seq BIGINT NOT NULL);

outbox (                                                -- written in the SAME tx as events
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  global_seq BIGINT NOT NULL, topic TEXT, key BYTEA, value BYTEA,
  published_at TIMESTAMPTZ                              -- NULL until relay confirms
);

-- Saga / process manager state.
saga_instance (
  saga_id UUID PRIMARY KEY, order_id UUID NOT NULL,
  step TEXT NOT NULL,                                   -- reserving|charging|confirming|compensating|done
  state JSONB NOT NULL,                                 -- reservation_id, payment_id, attempts
  timeout_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The **idempotency rule for projectors**: apply only events with
`global_seq > checkpoint.last_seq` and advance the checkpoint **in the same
transaction** as the projected write. Re-delivery is then a no-op.

## 8. Interface contract

**Command API** (`cmd/orderd`)
```
POST /orders            { items:[...] }                  -> 201 { order_id, version }
POST /orders/{id}/pay   { amount_cents, idempotency_key } -> 200 { version } | 409 (version conflict)
POST /orders/{id}/cancel                                  -> 200 { version }
```
- Commands carry an `expected_version` (or `If-Match`); a stale write returns
  **409** and the body states the current head version.

**Query API** (`cmd/queryd`)
```
GET /orders/{id}        -> { order_id, status, total_cents, item_count, as_of_seq }
GET /finance/daily/{d}  -> { day, gross_cents, refunds_cents, as_of_seq }
GET /staleness          -> { write_head_seq, projection_seq, lag_events, lag_ms }
```

**Event schema (versioned, upcastable)**
```jsonc
// event_schema = 1
{ "type":"OrderPlaced", "order_id":"…", "customer_id":"…", "items":[{"sku":"…","qty":2}] }
// event_schema = 2  (added currency; v1 upcasts to v2 by defaulting currency="USD")
{ "type":"OrderPlaced", "order_id":"…", "customer_id":"…", "currency":"USD", "items":[…] }
```
Aggregates and projectors **only ever read upcasted events**: a single
`upcast(raw) -> latestEvent` stage runs before any fold. Old bytes on disk are
never rewritten.

## 9. Key technical challenges

- **Optimistic concurrency on a hot aggregate.** Concentrated writes to one
  stream collide on `(stream_id, version)`. You must measure the conflict rate,
  choose a retry policy (bounded retries + jitter), and decide whether the hot
  "house account" should be **modeled differently** (split aggregate, or a
  counter that isn't event-sourced). Knowing when the aggregate boundary is wrong
  is the staff signal.
- **Replay cost vs snapshots.** Folding a 10k-event stream on every command is
  the latency killer. Snapshot cadence (every N events / on size) trades write
  amplification against replay cost — find the knee.
- **Projection lag & idempotency.** Re-delivery, restarts, and rebuilds must not
  double-apply. The checkpoint-in-same-transaction discipline is the only thing
  standing between you and a corrupted read model.
- **Eventual consistency the UI must tolerate.** Read-after-write can show stale
  state. You must measure the staleness window and pick a strategy
  (read-your-writes via command-returned version, optimistic UI, or sticky read).
- **Schema evolution without rewriting history.** Upcasting must be correct for
  *every* historical version and cheap enough to run on the full-log replay path.
- **Saga compensation correctness.** A failure between "stock reserved" and
  "payment charged" must leave **no leaked reservation and no orphan charge**.
  Compensations are themselves events and must be idempotent.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each:

1. **Command throughput & conflict rate.** Drive 5k cmd/s with a hot aggregate
   taking 20% of traffic. Plot append p99 and the **optimistic-concurrency
   conflict rate** vs hot-key concentration. At what concentration does retry
   storm dominate?
2. **Snapshot saving.** Take a 10k-event aggregate. Measure command p99 and
   replay time **without** snapshots, then with snapshots every {100, 1k, 5k}
   events. Plot replay time and snapshot write-amplification; pick the cadence.
3. **Projection lag under write load.** Ramp command rate to the ceiling and
   measure per-projection lag (events and ms). Where does the projector fall
   behind, and is it CPU, DB write, or single-partition ordering?
4. **Replay to rebuild a projection.** Drop `order_summary` and rebuild it from
   the full log; report events/s and total time **with vs without** snapshots as
   the read source. Does the system stay available (old projection serving) during
   rebuild?
5. **Event-version upcasting.** Ship `event_schema=2` (add `currency`). Prove old
   `v1` events fold correctly via upcasting, then replay the full log through the
   new upcaster and confirm read models are identical for unaffected fields.
6. **Saga compensation under injected failure.** Kill the payment service after
   stock is reserved but before charge confirms. Prove the saga compensates
   (`ReleaseStock`) and reaches a consistent terminal state. Show **no leaked
   reservation, no double charge** via the event log.
7. **Read-after-write staleness window.** Issue a command, then immediately poll
   the read API; record time-to-visibility distribution (p50/p99/max). Compare a
   naive read vs read-your-writes using the command-returned version.

## 11. Milestones

1. Event store on Postgres (append + optimistic version); `cmd/orderd` folds and
   appends; `cmd/gen` deterministic load; Prometheus board for append p99 + conflicts.
2. Projector + two read models with checkpoint-in-tx idempotency; `queryd`;
   first lag-under-load run (experiment 3).
3. Snapshots + replay tool; snapshot-cadence and rebuild experiments (2, 4).
4. Outbox relay to Kafka; saga across order/payment/inventory with compensation;
   chaos run (experiment 6).
5. Event versioning/upcasting (experiment 5); staleness measurement (7);
   findings note.

## 12. Acceptance criteria (definition of done)

- [ ] Event store holds ≥ 500M events; append enforces optimistic concurrency
      (show a 409 on a stale write and the gapless `(stream_id, version)`).
- [ ] Two independent projections served by `queryd`, each rebuildable from the
      log; rebuild of one while the other serves traffic, with throughput reported.
- [ ] Conflict-rate curve for the hot aggregate, with the chosen retry policy and
      its measured effective success rate.
- [ ] Snapshot experiment: replay time and command p99 **with vs without**
      snapshots, knee identified.
- [ ] Upcasting demonstrated across a real `event_schema` bump; full-log replay
      through the new upcaster verified.
- [ ] Saga chaos: payment killed mid-workflow → **no leaked stock, no double
      charge**, consistent terminal state, shown from the event log.
- [ ] Staleness window distribution reported, with the UI strategy named.
- [ ] Every number reproducible from a committed command + config.

## 13. Stretch goals

- **Competing-consumer projectors:** partition the log by `stream_id` and run N
  projector instances; measure ordering guarantees and lag at N×.
- **Snapshot-on-read vs background snapshotter:** compare write amplification and
  tail latency.
- **Choreography vs orchestration:** re-implement the saga as choreography
  (services react to events directly) and compare failure-mode clarity.
- **Bi-temporal queries:** "what did order X look like as of <ts>?" served by
  folding to a point in time — and the cost of doing it at scale.
- **Outbox vs CDC:** replace the polling outbox relay with logical-decoding CDC
  (cross-reference `events/01-cdc-pipeline-debezium`) and compare publish latency.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Event-sourcing fundamentals | Commands→events, fold to state | Defends append-only as source of truth; **knows when ES is the wrong choice** (CRUD-shaped domain, no audit need, high-cardinality hot aggregate) and says so |
| Optimistic concurrency | Detects version conflicts | Measures conflict rate; chooses retry policy *and* re-models the hot aggregate when retries don't pay |
| CQRS / projections | Separate read model exists | Multiple independently-scaled projections, rebuilt from log with bounded lag; explains the eventual-consistency contract to the UI |
| Snapshots | Knows snapshots speed replay | Quantifies the cadence knee; balances write-amp vs replay cost |
| Versioning | Adds a field | Upcasts every historical version correctly without rewriting history; proves it on full-log replay |
| Sagas | Happy-path orchestration | Compensation is correct and idempotent under mid-workflow failure; no leaked/double effects, proven from the log |
| Outbox / idempotency | Publishes events | Checkpoint-in-transaction idempotent projections; survives re-delivery and rebuild |
| Communication | Clear findings note | Could defend every curve — and the *decision not to event-source* a sub-domain — to a staff panel |

## 15. References

- Fowler: *Event Sourcing*, *CQRS*; Vernon: *Implementing Domain-Driven Design*
  (aggregates, sagas/process managers).
- *Designing Data-Intensive Applications* — Ch. 11 (stream processing, derived
  state), Ch. 12 (the future of data systems).
- Microsoft patterns: *Transactional Outbox*, *Saga*, *Compensating Transaction*.
- `pgx` v5 (binary protocol, batch); Kafka transactions/idempotent producer.
- See also: `events/03-event-replay-and-reprojection` (replay & reprojection at
  scale), `senior/07-event-driven-order-payment-service` (the service-level
  version of this domain), `events/07-idempotent-inbox-outbox`.
- Interview prep: `Interview Question/11-messaging-and-event-streaming/`,
  `Interview Question/12-architecture/`,
  `Interview Question/13-distributed-systems/`.
