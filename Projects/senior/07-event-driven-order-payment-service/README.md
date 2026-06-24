# Event-Driven Order & Payment Service ⭐ Flagship

> Two services — Order and Payment — talking only through Kafka, never sharing a
> database. Make a write to your DB and a publish to Kafka happen as if they were
> one atomic act (they aren't — that's the **dual-write problem**). Then make the
> consumer idempotent, the cross-service workflow a **saga** with compensations,
> and the whole thing observable end-to-end. This is the project you tell STAR
> stories about.

| | |
|---|---|
| **Tier** | Senior — flagship, end-to-end reference build |
| **Primary domain** | Event-driven microservices done correctly (DDD + messaging + distributed consistency) |
| **Skills exercised** | DDD bounded contexts & aggregates, transactional Outbox, idempotent consumers (Inbox), choreographed Saga + compensations, eventual consistency & read models, sync-command/async-event API design, full testing pyramid (unit → testcontainers → contract → e2e), observability (correlation IDs, traces, metrics, structured logs), Go (`pgx`, `franz-go`, `testcontainers-go`, OpenTelemetry) |
| **Interview sections** | 1 (Go), 5 (Postgres), 11 (messaging), 12 (architecture/DDD), 13 (distributed), 15 (testing), 18 (observability) |
| **Est. effort** | 10–15 focused days (this is the centerpiece — budget for it) |

---

## 1. Context

You're the engineer asked to carve "checkout" out of a monolith. When a customer
places an order, the system must reserve the order, charge the payment, and hand
off to fulfilment — and it must never lose an order, never double-charge a card,
and never leave money taken with no order to show for it. Finance audits this.

The naive version is a single service with one transaction that writes the order
**and** calls the payment gateway **and** publishes a Kafka event. That version
is wrong in three independent ways, and each way is a senior interview question:

1. **Dual write.** You cannot commit a Postgres row and publish a Kafka message
   in one atomic step. If the DB commits and the broker publish fails, you have a
   paid order nobody downstream knows about. If you publish first and the DB
   rolls back, you've announced an order that doesn't exist.
2. **At-least-once delivery.** Kafka redelivers. A consumer that charges a card on
   every delivery will double-charge on the first retry.
3. **No distributed transaction.** Order and Payment live in different services
   with different databases. There is no `BEGIN`/`COMMIT` spanning both. The
   workflow has to be a **saga** with explicit **compensations**.

Your job is to build the *correct* version: an **Order service** and a **Payment
service**, separate bounded contexts, separate databases, communicating only over
Kafka, using the **transactional Outbox** to solve the dual write, an **Inbox**
to make consumers idempotent, and a **choreographed saga** to drive
order → payment → fulfilment with compensation when payment fails. Then you
instrument it so you can stand in front of a panel and trace a single order's
correlation ID from the HTTP request through every event hop to the final state.

This is the project that ties the whole library together. It reuses the building
blocks from `events/07-idempotent-inbox-outbox`, scales toward
`staff/02-event-sourced-cqrs-saga`, and runs on a Kafka cluster you already
characterized in `labs/01-kafka-throughput-and-exactly-once`.

## 2. Goals / Non-goals

**Goals**
- Model **two bounded contexts** (Order, Payment) as **separate services with
  separate databases** and justify the boundary in DDD terms.
- Solve the **dual-write problem** with a **transactional Outbox**: the business
  row and the outbound event commit in the **same local DB transaction**; a relay
  publishes to Kafka after commit.
- Make every consumer **idempotent** via an **Inbox / dedup ledger** so duplicate
  delivery produces a **single effect**.
- Implement the order lifecycle as a **choreographed saga** with **compensating
  actions**: payment failure cancels the order and releases nothing it shouldn't.
- Maintain a **read model** updated from events, with **eventual consistency**
  the caller can reason about (and an SLO on convergence lag).
- Be **observable end-to-end**: a `correlation_id` (and W3C trace context)
  threads HTTP → Order → Kafka → Payment → Kafka → fulfilment; traces, RED
  metrics, and structured logs all join on it.
- Survive **broker outages and service restarts** mid-saga with no lost orders,
  no double charges, and no stuck-forever sagas.

**Non-goals**
- A real payment gateway. Use a **simulated gateway** with injectable
  latency/failure/timeout. The interesting problem is the distributed protocol
  around it, not Stripe's API.
- Full event sourcing / CQRS as the baseline — that's a **stretch goal** (§13)
  and the subject of `staff/02`.
- An orchestrated saga engine (Temporal/Camunda). Build the **choreography by
  hand** so you understand it; note where orchestration would change the design.
- UI. The deliverable is the API, the events, the tests, and the findings note.

## 3. Functional requirements

1. **Order service** (`cmd/order`):
   - `POST /orders` — accepts a place-order **command**, validates it, writes an
     `orders` row (status `PENDING`) **and** an `OrderPlaced` event into the
     `outbox` table **in one transaction**, returns `201` with the order id and a
     `correlation_id`. The HTTP call returns **before** payment is resolved.
   - Consumes `PaymentAuthorized` → moves order `PENDING → CONFIRMED`, emits
     `OrderConfirmed`. Consumes `PaymentFailed` → **compensates**: order
     `PENDING → CANCELLED`, emits `OrderCancelled`.
   - `GET /orders/{id}` — reads from the **read model** (current status + a short
     event history), and reports the order's saga state.
2. **Payment service** (`cmd/payment`):
   - Consumes `OrderPlaced` → calls the simulated gateway → writes a `payments`
     row **and** a `PaymentAuthorized` or `PaymentFailed` event to **its own**
     outbox in one transaction. Idempotent on `order_id` (an `OrderPlaced`
     redelivery must not produce a second charge).
3. **Outbox relay** (`cmd/relay`, or an in-process worker per service): polls (or
   tails via logical replication — see §6) each service's `outbox`, publishes to
   Kafka, marks rows published. Must keep relay lag bounded under write load.
4. **Inbox / dedup**: every consumer records processed message ids in an `inbox`
   table inside the same transaction as its effect, so reprocessing is a no-op.
5. **Read model** (`cmd/projector` or in-service): an `order_read` projection
   updated from the order event stream, serving `GET /orders/{id}` cheaply.
6. **Fault injection** (`cmd/chaos` or flags): kill a service mid-saga, pause the
   broker, force the gateway to fail/timeout, and inject duplicate deliveries.

## 4. Load & data profile

- **Throughput:** sustain **≥ 2,000 orders/s** placed for ≥ 20 minutes (target;
  find and report your machine's real ceiling as in `labs/01`). Each order fans
  out to ≥ 4 events across the saga, so the bus carries ≥ 8,000 events/s.
- **Volume:** drive **≥ 5M orders** total across runs so the outbox, inbox, and
  read-model tables reach realistic size (tens of millions of event rows) and you
  see index/bloat/vacuum behavior, not toy-table behavior.
- **Key distribution:** `customer_id` is **Zipfian** (s≈1.1) over 1M customers so
  some customers (and thus some partitions, if keyed by customer) are hot.
- **Generator:** `cmd/gen` (or load harness) is **deterministic given a seed**;
  open-model traffic (fixed place rate, not closed-loop) so you can watch saga
  backlog and relay lag build.
- **Failure mix:** a configurable fraction of payments **fail** (e.g. 5%) and a
  fraction **time out** (e.g. 1%) so compensations and retries run continuously,
  not just in a contrived test.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| `POST /orders` p99 (command accepted → `201`) | < 50 ms (it only writes order + outbox locally; it does **not** wait on payment) |
| Order throughput sustained | ≥ 2,000 orders/s for ≥ 20 min, **flat** saga backlog; report ceiling + bottleneck |
| **Outbox relay lag** (row committed → published to Kafka) p99 | < 1 s at target rate; **bounded, not monotonically rising** |
| Saga completion latency (OrderPlaced → terminal state CONFIRMED/CANCELLED) p99 | < 2 s at 80% of throughput ceiling |
| **Read-model convergence lag** (event committed → visible in `GET /orders`) p99 | < 500 ms |
| **Idempotency invariant** | Under duplicate delivery, **exactly one** payment per order and **exactly one** state transition per event — `charges == orders_paid`, zero double-charges |
| **Saga consistency invariant** | After any chaos: **no** order is `CONFIRMED` without a matching authorized payment, and **no** payment is captured for a `CANCELLED` order. Money moved ⇔ order confirmed |
| **No-loss invariant** | Every accepted `POST /orders` reaches a terminal state; zero orders stuck `PENDING` after the in-flight window drains |
| Broker outage tolerance | A broker (or the whole bus) down for 60 s loses **zero** events; the outbox drains and the saga catches up on recovery |

> As in every lab: the point isn't a magic number, it's to **find** your numbers
> and **prove the invariants hold under failure**. The invariants are
> non-negotiable; the throughput number is whatever you can defend.

## 6. Architecture constraints & guidance

- **Two services, two databases, shared-nothing.** Order and Payment each own a
  Postgres database. They communicate **only** via Kafka events. No service
  reads another's tables — a cross-DB read would defeat the whole exercise.
- **Bounded contexts (DDD).** Order and Payment are separate contexts because
  they have different invariants, change for different reasons, and have
  different consistency needs. The Order aggregate guards the order lifecycle;
  the Payment aggregate guards "charge a card at most once per authorization."
  Keep the domain model free of Kafka/SQL types; events crossing the boundary are
  an explicit **published language** (versioned contracts), not leaked internals.
- **Outbox over dual-write, always.** Never publish to Kafka inside request
  handling and hope it lands. Write the event to `outbox` in the **same
  transaction** as the business change; a separate **relay** publishes it. Pick
  and justify one relay mechanism:
  - **Polling relay** — `SELECT … WHERE published_at IS NULL ORDER BY id LIMIT N FOR UPDATE SKIP LOCKED`, publish, mark. Simple, at-least-once. Start here.
  - **Logical-replication / CDC relay** — tail the WAL (Debezium-style, cf.
    `events/01-cdc-pipeline-debezium`). Lower latency, no polling load, but more
    moving parts. Note the trade.
- **Idempotency everywhere consumers run.** Producers are at-least-once and the
  relay may republish on crash, so the order/payment events carry a stable
  `message_id` (and `order_id`), and every consumer dedups via the `inbox`
  table **inside the effect's transaction**. Idempotency is the consumer's job,
  not the broker's.
- **Choreography, not orchestration (baseline).** Each service reacts to events
  and emits the next event; the saga is the emergent sequence. Document the saga
  as a state machine even though no single component owns it. Note explicitly
  where a central orchestrator would simplify reasoning (and where it wouldn't).
- **Kafka:** 3 brokers via `docker-compose` (KRaft, pinned version). Go client
  `twmb/franz-go`. Topics: `orders.events`, `payments.events` (consider
  `*.dlq`). Key by `order_id` so all events for one order land on one partition
  and stay **ordered** — saga correctness leans on per-order ordering.
- **Postgres** via `jackc/pgx` (v5), one pool per service; outbox writes use the
  business transaction's `pgx.Tx`. No ORM hiding the transaction boundary.
- **Observability:** OpenTelemetry SDK; export traces to an OTLP collector +
  Jaeger/Tempo, metrics to Prometheus. **Propagate W3C `traceparent` through
  Kafka headers** so a trace spans services. Every log line is structured
  (`slog`) and carries `correlation_id` + `order_id` + `trace_id`.

## 7. Data model

Each service owns its schema. Outbox and inbox are **per service**.

```sql
-- ===== Order service DB =====
orders(
  id            UUID PRIMARY KEY,
  customer_id   BIGINT NOT NULL,
  amount_cents  BIGINT NOT NULL,
  status        TEXT   NOT NULL,           -- PENDING|CONFIRMED|CANCELLED
  saga_state    TEXT   NOT NULL,           -- AWAITING_PAYMENT|CONFIRMED|COMPENSATED
  version       INT    NOT NULL DEFAULT 0, -- optimistic concurrency on the aggregate
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL
);

-- read model (projection) for cheap GET /orders/{id}
order_read(
  id            UUID PRIMARY KEY,
  status        TEXT NOT NULL,
  amount_cents  BIGINT NOT NULL,
  last_event    TEXT NOT NULL,
  history       JSONB NOT NULL,            -- compact event log for the UI/audit
  updated_at    TIMESTAMPTZ NOT NULL
);

-- transactional OUTBOX (written in the SAME tx as the orders row)
outbox(
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id    UUID NOT NULL UNIQUE,      -- dedup key carried to consumers
  aggregate_id  UUID NOT NULL,             -- = order id; becomes Kafka key
  topic         TEXT NOT NULL,
  event_type    TEXT NOT NULL,             -- OrderPlaced|OrderConfirmed|OrderCancelled
  payload       JSONB NOT NULL,
  trace_context TEXT,                      -- W3C traceparent captured at write time
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ                -- NULL = not yet relayed
);
CREATE INDEX outbox_unpublished ON outbox (id) WHERE published_at IS NULL;

-- INBOX / dedup ledger (consumed PaymentAuthorized/PaymentFailed)
inbox(
  message_id    UUID PRIMARY KEY,          -- seen-before → skip
  consumer      TEXT NOT NULL,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Payment service DB =====
payments(
  id            UUID PRIMARY KEY,
  order_id      UUID NOT NULL UNIQUE,      -- AT MOST ONE payment per order (idempotency anchor)
  amount_cents  BIGINT NOT NULL,
  status        TEXT NOT NULL,             -- AUTHORIZED|FAILED|CAPTURED|VOIDED
  gateway_ref   TEXT,
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL
);
-- payment service has its OWN outbox(...) and inbox(...) (same shape as above)
```

**Saga state** lives on the `orders` aggregate (`saga_state` column) in the
choreographed design — there is no separate orchestrator table at baseline. For
the orchestrated stretch (§13) you'd add a `saga_instances` table tracking step,
status, and the compensation needed per failed step.

The two anchors that make the whole thing correct: `outbox.message_id UNIQUE`
(no duplicate publish of the same logical event) and `payments.order_id UNIQUE`
(no second charge for the same order — the database enforces idempotency even if
the application logic has a bug).

## 8. Interface contract

**Synchronous commands (HTTP, Order service):**

- `POST /orders` →
  ```json
  // request
  { "customer_id": 8123, "items": [{"sku":"A1","qty":2}], "amount_cents": 4999 }
  // 201 response — returns immediately, payment NOT yet resolved
  { "order_id": "uuid", "status": "PENDING", "correlation_id": "uuid" }
  ```
  Accepts an `Idempotency-Key` header; a repeated key returns the original order
  rather than creating a second one (client-facing idempotency).
- `GET /orders/{id}` → `{ "order_id", "status", "saga_state", "history": [...] }`
  served from `order_read` (eventually consistent — document the staleness bound).
- `GET /healthz`, `GET /readyz`, `GET /metrics` (Prometheus).

**Asynchronous events (Kafka, keyed by `order_id`):**

| Topic | Event | Emitted by | Consumed by |
|-------|-------|------------|-------------|
| `orders.events` | `OrderPlaced` | Order | Payment, projector |
| `payments.events` | `PaymentAuthorized` | Payment | Order, projector |
| `payments.events` | `PaymentFailed` | Payment | Order (compensate), projector |
| `orders.events` | `OrderConfirmed` | Order | fulfilment, projector |
| `orders.events` | `OrderCancelled` | Order (compensation) | fulfilment, projector |

**Event envelope (all events share it — this is the published language):**
```json
{
  "message_id": "uuid",          // dedup key (also Kafka header)
  "event_type": "OrderPlaced",
  "occurred_at": "RFC3339",
  "aggregate_id": "order-uuid",
  "version": 1,                  // schema version of THIS event type
  "correlation_id": "uuid",
  "traceparent": "00-...-01",    // W3C trace context, also mirrored to Kafka header
  "data": { /* event-specific */ }
}
```
Events are a **versioned contract**: additive changes only without a version bump;
breaking changes get a new `version` and consumers handle both during rollout
(cf. `events/04-schema-registry-and-evolution`).

## 9. Key technical challenges

- **The dual-write problem (the whole reason this project exists).** Committing a
  Postgres row and publishing to Kafka are two systems; there is no shared
  transaction. The Outbox makes the publish a *consequence* of a single local
  commit: write event-to-`outbox` and business-row together, relay afterward. You
  must be able to explain, at a whiteboard, every failure window — relay crashes
  after publish but before marking `published_at` (→ at-least-once → consumer
  must dedup), relay crashes before publish (→ retried), DB commits but process
  dies (→ relay picks it up on restart). This is *the* senior story.
- **Idempotent consumers under at-least-once.** The relay republishes on crash
  and Kafka redelivers on rebalance, so the Payment consumer **will** see
  `OrderPlaced` more than once. `payments.order_id UNIQUE` + the `inbox` check
  inside the charge transaction must collapse N deliveries to one charge. Prove
  it: inject duplicates and show `charges == distinct order_ids`.
- **Saga + compensation, no distributed transaction.** order → payment →
  fulfilment crosses two services and a gateway with no global commit. Model it
  as a state machine; design the **compensating action** for each forward step
  (payment fails → cancel order; later, if you add inventory, release the
  reservation). The hard part is that compensations must themselves be idempotent
  and safe to run after a crash mid-saga.
- **Eventual consistency the caller can reason about.** `POST /orders` returns
  `PENDING` before payment resolves; `GET /orders` reads a projection that lags
  the event stream. You must state the staleness bound (read-model convergence
  SLO), and decide what a client sees while the saga is in flight (`PENDING` +
  `saga_state`), avoiding the trap of pretending the system is synchronous.
- **Ordering and partitioning.** Saga correctness assumes per-order event
  ordering. Keying by `order_id` keeps one order's events on one partition — but
  Zipfian `customer_id` and any cross-aggregate keying can reintroduce skew. Pick
  the key deliberately and defend it.
- **Stuck sagas & timeouts.** A payment that never answers leaves an order
  `PENDING` forever. You need a timeout/sweeper that compensates abandoned sagas —
  and that sweeper must not race a late `PaymentAuthorized` (idempotency again).

## 10. Experiments to run (break it / tune it)

Record before/after numbers, dashboards, and the exact command/config for each.

1. **Throughput & relay lag under load.** Drive 2,000 orders/s. Plot order
   throughput, **outbox relay lag** (commit → publish), and saga completion
   latency. Find the ceiling and name the bottleneck (relay batch size? DB write
   contention on `outbox`? partition count?). Tune relay batch size + `SKIP
   LOCKED` fetch width and re-measure.
2. **Duplicate-delivery / idempotency proof.** Force the relay to publish each
   event twice (or replay a partition from offset 0). Show **exactly one** payment
   per order and one state transition per event: `SELECT count(*) FROM payments`
   equals distinct `order_id`s; zero double-charges. Then *remove* the inbox/unique
   constraint and watch it break — quantify the damage to prove the guard matters.
3. **Saga compensation on payment failure.** Set the gateway to fail 100% for a
   cohort of orders. Prove each such order ends `CANCELLED`, **no money moved**
   (no `CAPTURED` payment), and `OrderCancelled` was emitted exactly once. Show
   the trace of one compensated order end to end.
4. **Broker-outage resilience (outbox guarantee).** Pause the Kafka cluster for
   60 s during a sustained run. Show writes keep succeeding (orders accepted,
   outbox growing), relay lag spikes then drains on recovery, and **zero events
   lost** — every accepted order reaches a terminal state afterward.
5. **End-to-end latency budget.** Decompose saga completion latency into hops:
   POST handler, outbox→publish, Payment consume+gateway, publish-back,
   Order confirm, projector. Attribute the p99 to a hop using traces; attack the
   dominant hop and re-measure.
6. **Chaos: kill a service mid-saga.** During load, `kill -9` the Payment service
   while sagas are in flight, restart it, and prove consistency: no order
   `CONFIRMED` without an authorized payment, no orphan charges, no permanently
   stuck `PENDING` orders. Repeat killing the Order service and the relay.
7. **Stuck-saga timeout.** Make a cohort of payments hang forever. Show the
   timeout sweeper compensates them — and prove a *late* `PaymentAuthorized`
   arriving after compensation does not resurrect or double-process the order.

## 11. Milestones

1. **Order service + outbox (dual-write solved).** `POST /orders` writes
   `orders` + `outbox` in one tx; polling relay publishes `OrderPlaced`. Prove the
   atomicity window by hand (kill between commit and publish). Prometheus board
   for accept rate + relay lag.
2. **Payment consumer + idempotency (Inbox).** Payment consumes `OrderPlaced`,
   charges the simulated gateway, writes `payments` + its own outbox in one tx,
   emits `PaymentAuthorized`/`PaymentFailed`. Add the `inbox` dedup + `order_id`
   UNIQUE. Pass experiment 2.
3. **Saga close-the-loop + compensation.** Order consumes payment events:
   `PENDING → CONFIRMED` on authorized, `PENDING → CANCELLED` (compensation) on
   failed; emits `OrderConfirmed`/`OrderCancelled`. Pass experiment 3.
4. **Read model + eventual consistency.** Projector builds `order_read`;
   `GET /orders/{id}` serves it. Measure and document convergence lag (SLO).
5. **Observability end-to-end.** OTel traces propagated through Kafka headers
   (one trace per order across both services), RED metrics, structured logs all
   joined on `correlation_id`. Show a single order's full trace in Jaeger.
6. **Load + chaos.** Run experiments 1, 4, 5, 6, 7 at target scale. Write the
   findings note: throughput ceiling + bottleneck, invariant proofs, latency
   decomposition, failure-recovery behavior.

## 12. Acceptance criteria (definition of done)

- [ ] Order and Payment are **separate services with separate databases**,
      communicating **only** via Kafka (a reviewer can confirm no cross-DB read).
- [ ] `POST /orders` writes business row + outbox **atomically** (one tx); the
      relay publishes after commit. A kill between commit and publish loses
      nothing (relay republishes; consumers dedup).
- [ ] **Idempotency proven:** under forced duplicate delivery / partition replay,
      exactly one payment per order and one transition per event — SQL/diff shown.
- [ ] **Saga compensation proven:** injected payment failures end orders
      `CANCELLED` with no money moved; one `OrderCancelled` each; trace attached.
- [ ] **Broker-outage proven:** 60 s bus outage loses zero events; outbox drains,
      every accepted order reaches a terminal state.
- [ ] **Chaos proven:** killing any one service mid-saga leaves the system
      consistent (the §5 invariants hold) and no order stuck `PENDING`.
- [ ] Sustained ≥ 20-min run at a stated rate with **flat** saga backlog and
      **bounded** relay lag; dashboard screenshot attached.
- [ ] A **single order's correlation/trace id** is followable from HTTP through
      every event hop to terminal state (Jaeger screenshot).
- [ ] Test pyramid present and green: **unit** (aggregates, saga transitions),
      **integration with testcontainers** (Postgres + Kafka, real outbox→relay→
      consumer round-trip), **contract** (event envelope/schema), **end-to-end**
      (place order → terminal state).
- [ ] Findings note: throughput ceiling + named bottleneck, latency
      decomposition, every invariant's proof, and an ADR on choreography-vs-
      orchestration and polling-vs-CDC relay. Every number reproducible from a
      committed command + config.

## 13. Stretch goals

- **Event sourcing for the Order aggregate.** Replace the mutable `orders` row
  with an append-only event log as the source of truth; rebuild current state by
  folding events. Compare with the baseline (cf. `staff/02`).
- **CQRS read model.** Split the write side (commands → events) from a dedicated,
  independently-scaled read store; rebuild the projection from the event log on
  demand and measure rebuild time (cf. `events/03-event-replay-and-reprojection`).
- **CDC outbox relay.** Swap the polling relay for logical-replication/Debezium
  tailing the WAL; compare relay lag, DB load, and operational complexity.
- **Orchestrated saga.** Add a saga orchestrator (`saga_instances` table or
  Temporal) and contrast reasoning/observability with the hand-rolled
  choreography.
- **Add a third step (inventory reservation)** to make compensations multi-step:
  payment failure must now also release the reservation — exercising compensation
  ordering and partial-failure recovery.
- **DLQ + retry topology** for poison events (cf. `events/05-dlq-and-retry-topology`).
- **Exactly-once produce** via Kafka transactions on the relay; quantify the tax
  vs at-least-once + dedup (cf. `labs/01`).

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| **DDD boundaries** | Two services, two DBs, events between them | Justifies the boundary by invariants & consistency needs; keeps domain free of infra; treats events as a versioned published language |
| **Dual-write / Outbox** | Outbox implemented, atomic write + relay | Explains every failure window at the whiteboard; chose & defended polling-vs-CDC; relay lag bounded under load with evidence |
| **Idempotency** | Inbox + unique constraint; no double-charge in happy path | Proves single-effect under forced duplicates & replay; DB-enforced, not just app-logic; idempotent compensations too |
| **Saga / compensation** | Compensates on payment failure | Handles crash mid-saga, stuck-saga timeouts, and late events without resurrection; models it as a state machine |
| **Eventual consistency** | Read model updated from events | States staleness bound; reasons about what the client sees in-flight; doesn't fake synchrony |
| **Resilience under failure** | Survives a clean restart | Zero loss through broker outage + `kill -9` mid-saga; proves the invariants, not just "it came back" |
| **Observability** | Logs + metrics + some tracing | One trace per order across services via Kafka headers; RED metrics; everything joins on correlation id; could debug a stuck order live |
| **Testing** | Unit + some integration | testcontainers integration of the real round-trip, contract tests on events, e2e; tests assert the invariants |
| **Communication** | Clear findings note + ADRs | Could defend the whole design — boundaries, outbox, saga, numbers — to a staff panel and survive |

## 15. References

- **Interview Question bank:**
  - `Interview Question/11-messaging-and-event-streaming/` — outbox, idempotency, delivery semantics, ordering.
  - `Interview Question/12-software-architecture/` — DDD bounded contexts, aggregates, saga, choreography vs orchestration.
  - `Interview Question/13-distributed-systems/` — dual-write, eventual consistency, distributed transactions, failure modes.
  - `Interview Question/15-testing/` and `18-observability/` — the test pyramid and tracing/metrics theory.
- **Sibling projects:**
  - `events/07-idempotent-inbox-outbox/` — the inbox/outbox primitive this builds on.
  - `staff/02-event-sourced-cqrs-saga/` — the event-sourced + orchestrated big brother (stretch direction).
  - `labs/01-kafka-throughput-and-exactly-once/` — characterize the cluster this runs on; EOS tax numbers.
  - `events/01-cdc-pipeline-debezium/` — the CDC alternative to the polling relay.
- **Canonical reading:**
  - *Designing Data-Intensive Applications* — Ch. 9 (consistency), Ch. 11 (stream processing, outbox/CDC).
  - Chris Richardson, *Microservices Patterns* — Transactional Outbox, Saga, API Composition, CQRS.
  - Eric Evans, *Domain-Driven Design* — bounded contexts & aggregates; Vaughn Vernon, *Implementing DDD*.
  - microservices.io patterns: Transactional Outbox, Saga, Idempotent Consumer.
- **Go libraries:** `jackc/pgx` (v5), `twmb/franz-go`, `testcontainers/testcontainers-go`, `go.opentelemetry.io/otel` (+ OTLP exporter, Jaeger/Tempo), `log/slog`.
