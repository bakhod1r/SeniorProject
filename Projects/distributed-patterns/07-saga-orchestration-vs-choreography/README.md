# Saga: Orchestration vs Choreography

> Implement the *same* multi-service order transaction — reserve inventory →
> charge payment → ship — two ways: once with a central **orchestrator** driving
> an explicit state machine, once with **choreography** where services react to
> each other's events. Then compare them honestly under load and failure: which
> compensates correctly, which you can debug at 3 a.m., and which one you'd
> actually ship.

| | |
|---|---|
| **Tier** | Distributed-patterns (distributed transactions) |
| **Primary domain** | Long-running distributed transactions |
| **Skills exercised** | Saga pattern, compensating transactions, semantic locks, idempotency & dedup, event-driven design, process managers / state machines, saga-log persistence, distributed observability, Go (`pgx`, Kafka/NATS, a workflow lib or hand-rolled state machine) |
| **Interview sections** | 11 (messaging & event streaming), 12 (architecture), 13 (distributed systems) |
| **Est. effort** | 4–6 focused days |

---

## 1. Context

You own the checkout flow at a marketplace doing **~3M orders/day** with peaks of
**~600 orders/s**. Placing an order touches three independently-owned services:
**inventory** (reserve units), **payment** (charge the card), **shipping**
(create a fulfilment job). There is no two-phase commit across them — payment is
an external PSP with its own database, inventory is sharded, shipping is a
third-party API. A single ACID transaction spanning all three does not exist and
never will.

Today these calls are chained synchronously inside the order service with
ad-hoc `try/catch` rollbacks, and it's a mess: a payment success followed by a
shipping failure sometimes leaves a charged customer with no order, and nobody
can reliably reconstruct *why* a given order ended up half-done. You're going to
rebuild it as a **saga** — a sequence of local transactions, each with a
**compensating transaction** that semantically undoes it — and you're going to
build it **both ways** to settle the recurring architecture argument on your team:

- **Orchestration** — a central saga coordinator owns an explicit state machine,
  calls each service in order, and on failure runs compensations in reverse.
- **Choreography** — no coordinator; each service emits an event, the next
  service subscribes and reacts, and failures propagate as compensation events.

The deliverable is not "a saga." It's **two implementations of the identical
business transaction** plus a findings note that says which style wins for this
workload, *with numbers*. You will produce evidence, not opinions.

> This brief is the **comparative orchestration-vs-choreography lens**. It is
> *not* the event-sourced build — `staff/02-event-sourced-cqrs-saga` makes the
> append-only log the source of truth and runs the saga as a process manager
> over it. Here the focus is the coordination-style trade-off itself: same
> domain, two topologies, measured side by side. Reuse the domain, not the
> infrastructure assumptions.

## 2. Goals / Non-goals

**Goals**
- Implement the order saga **twice** — orchestrated and choreographed — over the
  same three services, same data model, same failure-injection harness.
- Design correct **compensations** for every compensatable step, and explicitly
  handle the **non-compensatable** step (the actual card capture / the shipped
  parcel) with a pivot transaction and retry-forward semantics.
- Make every step **idempotent** and every retry safe: at-least-once delivery
  must never double-charge, double-reserve, or double-ship.
- Persist a **saga log** so an in-flight saga survives a coordinator (or service)
  crash and resumes or compensates on recovery — both styles.
- Build **observability** for each style: for orchestration, the state machine's
  current state per saga; for choreography, a way to answer *"where did this
  order go?"* without grepping five services' logs.
- Compare the two under load and failure: throughput, latency, recovery time,
  and — the honest part — **operability**.

**Non-goals**
- Distributed ACID / 2PC across the three services (that's
  `distributed-patterns/06-2pc-3pc-coordinator` — and the point there is it
  doesn't scale; saga is the answer to *that* failure).
- Full event sourcing / CQRS read-model derivation — that's `staff/02`. Here the
  saga log is a control structure, not the system of record for the domain.
- Reservation/confirm/cancel as a generic primitive — that's
  `distributed-patterns/08-tcc-try-confirm-cancel`. We *use* a reserve/cancel
  shape for inventory, but the lab is about saga coordination, not TCC mechanics.
- Building a real PSP or carrier. Stub them with injectable latency and failure.

## 3. Functional requirements

1. Three services, separately deployable, separate databases:
   `inventory`, `payment`, `shipping`. Each exposes a **forward** action and a
   **compensating** action, both idempotent:
   - inventory: `Reserve(orderID, items)` / `ReleaseReservation(orderID)`
   - payment: `Charge(orderID, amount)` / `Refund(orderID)`
   - shipping: `CreateShipment(orderID)` / `CancelShipment(orderID)` (note:
     once handed to the carrier, this becomes **non-compensatable** — see §9)
2. **Orchestrated saga** (`cmd/orchestrator`): a central coordinator with an
   explicit state machine `PENDING → INVENTORY_RESERVED → PAYMENT_CHARGED →
   SHIPPED → COMPLETED`, plus compensation states `COMPENSATING → CANCELLED`.
   It calls each service (sync RPC or command-via-queue), records every
   transition in a **saga log**, and on any step failure drives compensations in
   reverse for the steps already completed.
3. **Choreographed saga**: no coordinator. `order` emits `OrderCreated`;
   inventory consumes it, reserves, emits `InventoryReserved`; payment consumes
   *that*, charges, emits `PaymentCharged`; shipping consumes that and emits
   `Shipped`. Failures emit compensation events (`PaymentFailed` →
   inventory consumes it and releases) that flow back through the chain.
4. Both styles consume the **same failure-injection harness** (`cmd/chaos`):
   force any step to fail, time out, or crash the process mid-saga.
5. A **read API** answers, for any `orderID`: current saga state, the steps
   completed, and (on failure) which compensations ran. For choreography this
   must be reconstructable from the event stream / a correlation projection.
6. Both styles **resume correctly after a crash**: kill the orchestrator (or any
   service) mid-saga, restart, and the saga either completes or fully
   compensates — no order left half-done, no orphaned reservation or charge.

## 4. Load & data profile

- **Volume:** drive **≥ 5M completed sagas** total across runs; a single
  sustained run ≥ 20 minutes at target rate. Keep the saga log for the full run
  (Stage 1 depends on it growing).
- **Saga shape:** 3 forward steps + up to 3 compensations. Real-world step
  latency is dominated by the external PSP — model `Charge` at p50 ≈ 80 ms,
  p99 ≈ 800 ms (fat tail), the others at p50 ≈ 5 ms.
- **Failure mix:** a tunable fraction of sagas fail at a chosen step. Baseline:
  **2% payment declines** (compensate: release inventory), **0.5% shipping
  failures** (compensate: refund + release). Crank these in Stage 3.
- **Key distribution:** `sku` is **Zipfian** (s≈1.1) over 1M SKUs, so hot SKUs
  create **contention on the same inventory rows** — this is where semantic
  locks bite. `orderID` is unique (UUIDv7, time-ordered).
- **Traffic model:** **open-model** order generator (`cmd/gen`) at a fixed
  arrival rate, deterministic given a seed, so you observe queues/lag building —
  not "as fast as the slowest service drains."

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Saga completion p99 (OrderCreated → COMPLETED), happy path, 80% of ceiling | < 1.5 s (PSP tail dominates; state it) |
| Saga **start** throughput, orchestration | Find & report the coordinator's ceiling; name the bottleneck (saga-log write IOPS? RPC fan-out? lock on the log table?) |
| Saga **start** throughput, choreography | Find & report the event-bus / consumer ceiling; name the bottleneck (broker, consumer lag, per-event DB write) |
| Compensation **correctness** (the invariant) | **Zero** orphaned state: after any injected failure, `reserved == 0 ∧ charged == 0` for every failed order; `charged ⇒ shipped ∨ refunded` — verified by a ledger reconciliation query |
| Compensation completion p99 (failure detected → fully compensated) | < 3 s; report per style |
| Recovery after coordinator/service crash | Every in-flight saga reaches COMPLETED or CANCELLED within a stated bound after restart; **no saga stuck forever** |
| Semantic-lock contention on hot SKUs | Bounded; report reservation-conflict rate and its effect on p99 at the hot tail |

> The point isn't a magic number — it's to **find** each style's ceiling and
> bottleneck, **prove** the no-orphaned-state invariant through injected
> failures, and produce an apples-to-apples table that says which style you'd
> ship for *this* workload and why.

## 6. Architecture constraints & guidance

- **Same domain, two topologies.** Share the service implementations and the DB
  schema; swap only the coordination layer. If the orchestrated and
  choreographed builds don't reserve/charge/ship through the *same* code, your
  comparison is contaminated.
- **Orchestration**: model the state machine explicitly — a typed enum of states
  + a transition table, not a pile of `if`s. A hand-rolled coordinator over
  Postgres + a command queue is enough; a workflow engine (Temporal-style) is an
  acceptable stretch but build the hand-rolled one *first* so you understand the
  saga log it hides from you.
- **Choreography**: one topic/stream per event type (or one stream with typed
  events). Every consumer is **idempotent** and commits its offset only after its
  local DB transaction (process-then-commit, or an inbox table). No service may
  call another directly — coupling is via events only.
- **Saga log / persistence**: orchestration writes transitions to a
  `saga_instances` + `saga_steps` table inside the same DB transaction that
  records the step result. Choreography's "log" is the event stream plus a
  **correlation projection** keyed by `orderID` so you can answer §3.5.
- **Idempotency everywhere**: every forward and compensating action keyed by
  `(orderID, step)`; a dedup table or `INSERT … ON CONFLICT DO NOTHING` guards
  re-delivery. Retries use exponential backoff + jitter (see
  `distributed-patterns/05-fan-out-fan-in-pipeline` for the bounded-retry shape).
- **Instrument both** with Prometheus + OpenTelemetry traces: saga start rate,
  completion rate, compensation rate, per-step latency, in-flight sagas, and a
  **single trace per `orderID`** spanning all services (this is the choreography
  observability lifeline).

## 7. Data model

```
-- shared domain (both styles)
orders(order_id PK, status, amount_cents, created_at)
reservations(order_id, sku, qty, state CHECK(state IN ('held','released')),
             PRIMARY KEY(order_id, sku))           -- semantic lock lives here
payments(order_id PK, state CHECK(state IN ('charged','refunded')), psp_ref)
shipments(order_id PK, state CHECK(state IN ('created','cancelled','handed_off')))

-- idempotency guard (both styles)
processed(order_id, step, PRIMARY KEY(order_id, step))   -- dedup ledger

-- orchestration saga log
saga_instances(order_id PK, state, current_step, updated_at, version INT)  -- optimistic lock
saga_steps(order_id, step, status, compensated BOOL, ts, PRIMARY KEY(order_id, step))

-- choreography correlation projection (rebuilt from the event stream)
saga_view(order_id PK, last_event, steps_done JSONB, compensations JSONB, updated_at)
```

The `reservations.state` column **is** the semantic lock: a reservation is a
soft, application-level hold that the compensation releases. There is no DB-level
lock held across the saga — that's the whole point of sagas vs 2PC.

## 8. Interface contract

- `POST /orders` → `{order_id}` (starts a saga in whichever style is deployed).
- `GET /orders/{id}/saga` → `{ state, steps:[{step,status,compensated}],
  pivot_reached: bool }` — identical response shape for both styles.
- `GET /metrics` → Prometheus exposition.
- Services expose forward + compensating commands (HTTP/gRPC for orchestration,
  event-consumers for choreography) — same handlers underneath.
- Config flags: `-style=orchestration|choreography`, `-rate`, `-fail-step`,
  `-fail-rate`, `-crash-after`, `-seed`.

## 9. Key technical challenges

- **No isolation — the saga's original sin.** A saga is *not* ACID: between
  `Reserve` and `Charge`, other transactions see the intermediate state. This
  causes the two classic anomalies you must defend against:
  - **Dirty reads** — another saga reads the reserved-but-not-yet-paid state and
    acts on it. Countermeasure: a **semantic lock** (the `held` reservation
    state) + readers that treat `held` as committed-pending.
  - **Lost updates** — two sagas race on the same hot SKU's inventory.
    Countermeasure: **commutative updates** (decrement, not set) and/or
    optimistic concurrency (`version`) on the contended row.
  - Other countermeasures to reason about: **reread** before compensating, and
    **the pivot transaction** (below).
- **The pivot / non-compensatable step.** Once shipping hands the parcel to the
  carrier, you *cannot* un-ship it. Design a **pivot transaction**: after the
  pivot, the saga can only go **forward** (retry until success), never back. Put
  the pivot late and make everything before it cleanly compensatable. State
  exactly where your pivot is and why.
- **Compensation is not rollback.** A refund is a *new* business fact, not an
  undo — it's visible, it has its own failure modes, and it can itself fail and
  need retry. Compensations must be **idempotent and retryable forever** (they
  have no compensation of their own).
- **Choreography's "where did the order go?" problem.** The flow is **emergent**
  — it lives in the wiring of subscriptions, not in any one place you can read.
  A new engineer cannot answer "what happens after PaymentCharged?" without a
  whole-system mental model. Cyclic event dependencies and accidental infinite
  compensation loops are easy to create and hard to see. Your correlation
  projection + per-order trace is the mitigation; prove it works in §10.6.
- **Orchestration's coordinator dependency.** The coordinator is a single point
  of *logic* (and, if you're sloppy, a single point of *failure* and a
  throughput choke). It must persist state before acting and resume idempotently
  after a crash. Easy to reason about; a dependency to keep available.
- **Idempotency under at-least-once.** Both styles redeliver. A retried `Charge`
  must not double-charge; a redelivered compensation must not double-refund. The
  `(order_id, step)` dedup ledger is load-bearing — test it explicitly.

## Stages (0 simple → 1 big data → 2 high RPS → 3 both)

Build Stage 0 correct first — it's the control every later number is measured
against. Then push each axis alone, then both. The two axes fail differently
**and differently per style**: big saga-state stresses **log growth & recovery
scan**; high saga-start rate stresses the **coordinator** (orchestration) or the
**event bus + per-event writes** (choreography). **Don't tune what isn't yet
correct, and don't compare styles until both pass Stage 0.**

| Stage | Saga state / history | Saga-start rate | What it stresses (per style) | Pass criterion |
|-------|----------------------|-----------------|------------------------------|----------------|
| **0 · Simple** | a few sagas | ~5/s | **Correctness only.** Happy path completes; a single injected step-failure triggers full, correct compensation — both styles, identical invariant | Both styles: COMPLETED on success; on one injected failure, `reserved==0 ∧ charged==0`; baseline completion latency recorded as the control |
| **1 · Big data** | **≥ 5M sagas in the log; long-running sagas held open hours** | ~5/s (low) | **Saga-log growth & recovery.** Orchestration: `saga_instances` table bloat, recovery scan to find in-flight sagas after restart. Choreography: replay/projection cost to rebuild `saga_view` over a huge event history; long-lived sagas straddling retention | Recovery after crash completes in a stated bound even with 5M historical sagas; in-flight sagas found via an **index/partition**, not a full scan; report log size and recovery time per style; log compaction/archival strategy stated |
| **2 · High RPS** | small | **600+ sagas/s** | **Start-rate ceiling & contention.** Orchestration: coordinator throughput — saga-log write IOPS, lock on the instances table, RPC fan-out. Choreography: event-bus throughput, consumer lag, per-event DB write amplification. **Both:** semantic-lock contention on hot Zipfian SKUs | Each style hits a **stated ceiling with the bottleneck named & proven**; steady-state completion lag flat (not rising); hot-SKU reservation-conflict rate reported and bounded |
| **3 · Both** | **≥ 5M state + long-running** | **600+/s** | **Production boss.** High start-rate *and* large state *with* injected mid-saga failures (incl. coordinator/service crash). Long recovery scans overlap heavy live traffic; compensations compete with forward work for the same hot rows; choreography's emergent flow is hardest to debug exactly when load is highest | Full SLOs hold simultaneously: zero orphaned state after chaos (ledger reconciliation = 0 discrepancies), completion p99 under SLO, recovery bounded — **both styles** — and an honest operability/observability comparison table with numbers |

> Stage 1 and Stage 2 can each pass while Stage 3 fails: a recovery scan that's
> fine on an idle restart (Stage 1) blocks the write path when 600 sagas/s are
> already hammering the same log (Stage 3); a compensation that's cheap in
> isolation (Stage 0) contends with forward work on the hot SKU under load.
> Stage 3 is where the *style choice* actually shows its cost — that's the number
> you defend.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each, **per style**:

1. **Fail at each step → compensation correctness.** Inject a forced failure at
   step 1, 2, and 3 in turn. Prove the right compensations run in the right
   order and the invariant holds (`reserved==0 ∧ charged==0` for the failed
   order). Do it for both styles; the *result* must be identical, the *mechanism*
   isn't.
2. **Crash mid-saga → resume.** Kill the orchestrator (and separately, a service)
   between two steps; restart; prove every in-flight saga reaches COMPLETED or
   CANCELLED. For choreography, crash a consumer and prove offset-after-commit
   means no lost or double-applied step.
3. **Idempotency / double-delivery.** Force redelivery of a `Charge` command/event
   and of a `Refund`. Prove the dedup ledger blocks the second one: exactly one
   charge, exactly one refund. Then *remove* the ledger and watch it break — keep
   the broken numbers as the "why this exists" evidence.
4. **Start-rate ramp, both styles.** Ramp from 5 → 600+ sagas/s. Plot completion
   throughput vs p99 for each style on the same axes. Find each knee; name what
   bounds it (coordinator log IOPS vs broker/consumer lag).
5. **Semantic-lock contention (Zipfian hot SKUs).** With hot-SKU traffic, measure
   reservation-conflict rate and its p99 impact. Then change the strategy
   (commutative decrement vs optimistic `version` retry vs sharded reservation
   counters) and re-measure. Which countermeasure pays?
6. **Debugging-a-choreography exercise.** Have a teammate (or your past self)
   inject a *silent* bug: a consumer that drops `PaymentFailed` so inventory is
   never released. Now answer "where did order X go?" **using only your tooling**
   (trace + correlation projection), and time how long it takes. Repeat the same
   bug in orchestration (a missing compensation transition) and time *that*
   diagnosis. The Δ is the operability cost of choreography — report it.
7. **Compensation under load (Stage 3).** At 600/s with 10% injected failures,
   confirm compensations keep up (compensation lag flat, not rising) and don't
   starve forward work on hot rows. Report compensation p99 per style.
8. **Pivot correctness.** Force a failure *after* the pivot (shipping handed off,
   then payment-capture retry needed). Prove the saga goes **forward** (retries
   to success) and never tries to un-ship. Show what happens if you *wrongly*
   place a compensatable step after the pivot.

## 11. Milestones

1. Shared domain + three services with idempotent forward/compensate actions;
   `cmd/gen` open-model generator; Prometheus + a per-order trace.
2. **Orchestrated** saga with explicit state machine + saga log; happy path +
   single-failure compensation (Stage 0); crash-resume working.
3. **Choreographed** saga over the same services; correlation projection;
   Stage 0 parity — identical invariant, identical read API shape.
4. Idempotency + semantic-lock countermeasures; experiments 1–3, 5.
5. Load: Stage 1 (log growth + recovery) and Stage 2 (start-rate ceilings,
   experiment 4) for both styles.
6. Stage 3 chaos run (experiments 6–8); the operability comparison table and
   findings note: **which style, and why, for this workload.**

## 12. Acceptance criteria (definition of done)

- [ ] **Both** styles implemented over the **same** services and schema; only the
      coordination layer differs (show it in the code).
- [ ] Stage 0: happy path + single-failure compensation correct for both styles;
      invariant query returns zero orphaned state.
- [ ] Fail-at-each-step (exp. 1) proven for both styles with the compensation
      order shown.
- [ ] Crash-mid-saga (exp. 2): every in-flight saga reaches a terminal state
      after restart; no saga stuck forever; shown with the saga-log / offset
      evidence.
- [ ] Idempotency (exp. 3): exactly-once effect under forced redelivery; the
      "ledger removed" failure captured as contrast.
- [ ] Start-rate ceiling reported **with the bottleneck named and proven** for
      each style (pprof / IOPS / consumer-lag evidence).
- [ ] Semantic-lock contention measured on hot SKUs and a countermeasure shown to
      improve it (exp. 5).
- [ ] Stage 3: ledger reconciliation = **0 discrepancies** after chaos at 600/s
      with injected failures, both styles; completion p99 + recovery bound met.
- [ ] **The deliverable:** an apples-to-apples operability/observability table
      (throughput, p99, compensation p99, recovery time, debug-time from exp. 6)
      and a written recommendation: which style for this workload, with reasons.
- [ ] Every number reproducible from a committed command + config + seed.

## 13. Stretch goals

- Re-implement the orchestrated saga on a **workflow engine** (Temporal-style)
  and compare its hidden saga log + retry semantics to your hand-rolled one.
- **Timeout-driven compensation**: a saga step that neither succeeds nor fails
  (the service is hung) — add a per-step deadline that triggers compensation, and
  reconcile the race where the late success arrives *after* you compensated.
- **Hybrid topology**: orchestrate the critical money path, choreograph the
  peripheral reactions (notifications, analytics) — and argue where the seam goes.
- Add a fourth service mid-project and measure the **change cost** in each style
  (orchestration: edit the state machine; choreography: rewire subscriptions and
  hope you found every consumer).
- Run the choreographed version on **NATS JetStream vs Kafka** and compare
  ordering / redelivery / DLQ ergonomics for compensation events.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Saga correctness | Happy path + single-failure compensation works | Invariant holds through every-step failure, crash-resume, and redelivery; **proves** no orphaned state with reconciliation |
| Style choice | Builds both; describes the trade-off | **Picks one with reasons for this workload**, backed by the throughput/p99/operability table; knows when the *other* would win |
| Compensation design | Writes compensations that undo each step | Identifies the **pivot / non-compensatable** step, designs retry-forward past it, makes compensations idempotent & retryable |
| No-isolation anomalies | Knows sagas aren't ACID | Defends against dirty-read & lost-update with semantic locks / commutative updates; measures the contention cost |
| Idempotency | Dedups happy-path retries | Proves exactly-once effect under forced double-delivery; shows the failure when the guard is removed |
| Observability | Can read one saga's state | Answers "where did the order go?" in choreography fast (exp. 6); quantifies the debug-time gap vs orchestration |
| Operability under load | Both styles run at rate | Reports each style's ceiling + bottleneck and recovery behavior; defends the recommendation to a staff panel |

## 15. References

- Caitie McCaffrey — *Applying the Saga Pattern* (the canonical talk).
- Chris Richardson — *Microservices Patterns*, Ch. 4 (Saga): orchestration vs
  choreography, countermeasures (semantic lock, commutative updates, pivot
  transaction, reread).
- Garcia-Molina & Salem — *Sagas* (1987, the original paper).
- *Designing Data-Intensive Applications* — Ch. 9 (consistency) for why there's
  no isolation across services.
- See also: `staff/02-event-sourced-cqrs-saga/` (the event-sourced process-manager
  build), `distributed-patterns/06-2pc-3pc-coordinator/` (the ACID alternative
  that doesn't scale), `distributed-patterns/08-tcc-try-confirm-cancel/` (the
  reserve/confirm/cancel primitive), and `senior/07-event-driven-order-payment-service/`.
- Theory: `Interview Question/11-messaging-and-event-streaming/`,
  `Interview Question/12-architecture/`,
  `Interview Question/13-distributed-systems/`.
