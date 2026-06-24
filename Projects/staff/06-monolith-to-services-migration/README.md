# Monolith → Services Migration (Strangler, Zero-Downtime)

> Carve a service out of a live monolith and split its shared database —
> **without a maintenance window and without a big-bang rewrite.** Move 100M+
> rows while traffic keeps flowing, prove the new path matches the old one byte
> for byte, then flip a flag. If anything smells wrong, flip it back in seconds.

| | |
|---|---|
| **Tier** | Staff (architecture evolution) |
| **Primary domain** | Large-scale migration / distributed systems |
| **Skills exercised** | Strangler-fig, bounded-context seams, DB decomposition, dual-write + reconcile, expand-contract (parallel-change), online backfill, shadow traffic, feature-flagged cutover, sagas, Go |
| **Interview sections** | 12 (architecture), 13 (distributed systems), 5 (postgres) |
| **Est. effort** | 5–8 focused days |

---

## 1. Context

You inherit a Go monolith that has run the business for six years. One table,
`orders`, has grown to **140M rows** and is hammered by half the codebase: the
checkout path, the fulfillment workers, the admin tooling, three reporting jobs,
and a nightly export all read and write it through the same shared Postgres.
Every change to order logic now risks every other team's deploy. Leadership
wants an independent **Orders Service** with its own database and its own deploy
cadence.

The catch: the system does **~3,000 order writes/s** at peak and **never** takes
a maintenance window. A big-bang rewrite ("freeze the monolith, dump, restore,
switch") is off the table — it's too risky, too slow, and the business won't
stop. You must extract the service **incrementally**, **online**, with a
**rollback path at every step**, using the strangler-fig pattern.

Your job is to sequence the extraction by risk, stand up the new service behind a
router, dual-write and backfill the data, shadow-compare the two
implementations until they agree, then cut over behind a feature flag — and prove
you didn't regress latency or correctness. You will produce numbers and a
rollback drill, not a slide deck.

## 2. Goals / Non-goals

**Goals**
- Extract **one** bounded context (`orders`) from the monolith into a standalone
  Go service with its **own** database, online, zero downtime.
- Decompose the shared DB: break the cross-context foreign keys, migrate the
  `orders` table to the new store, and leave the monolith reading the new
  service (not the old table) by the end.
- Run a **dual-write + reconcile** phase that keeps old and new stores consistent
  while you backfill, and detect/repair divergence.
- Backfill **140M rows** online — batched and throttled — without blocking live
  writes or melting replication lag.
- **Shadow** production traffic to the new service and prove its outputs match
  the monolith before any user is served by it.
- Cut over behind a **feature flag** with **instant rollback**, and measure the
  blast radius of a bad cutover.

**Non-goals**
- Extracting the *whole* monolith. Take **one** seam to completion; the skill is
  the playbook, not the headcount.
- A service mesh / Kubernetes platform build-out. A router/facade in Go is enough.
- Distributed transactions across services. Post-split you must avoid 2PC —
  reach for sagas / eventual consistency and justify it.
- Rewriting business logic. Extracted logic must be **behavior-preserving**;
  shadow-compare is how you prove it.

## 3. Functional requirements

1. A **monolith** (`cmd/monolith`) that serves the order API today against the
   shared `orders` table, plus the other contexts that read it (a fulfillment
   worker, an admin endpoint) so the FK coupling is real, not hypothetical.
2. A **strangler facade / router** (`cmd/router` or in-process) that fronts the
   order endpoints and decides, **per request**, whether to serve from the
   monolith path or the new service — controlled by a feature flag with
   percentage and per-key targeting.
3. An **Orders Service** (`cmd/orders`) — a standalone Go service with its own
   Postgres, exposing the order API contract (§8).
4. A **dual-write layer**: while migrating, every order mutation is applied to
   **both** stores (old table + new service DB) with a reconciliation guarantee.
5. A **backfill job** (`cmd/backfill`) that copies historical `orders` rows into
   the new store online — batched, throttled, resumable, idempotent.
6. A **shadow/dark-launch** mode: the router mirrors live read (and dry-run write)
   traffic to the new service and **compares** responses, recording mismatches
   without affecting the user.
7. A **reconciler** (`cmd/reconcile`) that scans both stores, reports divergence,
   and can repair it.
8. A **flag-driven cutover** with a one-command rollback that returns to the
   monolith path with no data loss.

## 4. Load & data profile

- **Table scale:** `orders` starts at **140M rows** (~60 GB heap + indexes).
  Generate it deterministically (`cmd/gen`, seeded) before any migration work.
- **Write load:** sustained **3,000 order mutations/s** (insert + status update),
  open-model (fixed rate, so you can watch dual-write lag and replication lag
  build) — not "as fast as the backfill drains."
- **Read load:** **20,000 reads/s** on the order API (get-by-id, list-by-customer).
- **Key distribution:** `customer_id` is **Zipfian** (s≈1.2) over 8M customers,
  so a few customers own a hot tail of orders — this exposes skew during
  per-key/per-tenant flag rollout and shadow sampling.
- **FK fan-out:** `order_items`, `shipments`, and `payments` reference `orders`
  by FK — these are the cross-context edges you must sever.
- **Backfill window:** the 140M-row backfill must complete in a bounded run while
  **3,000 writes/s** continue, with replica lag held under SLO (§5).

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| User-visible downtime across the **entire** migration | **0 seconds** (no maintenance window; flip is hot) |
| Order API p99 latency, before vs after extraction | New path within **+10%** of monolith p99 at equal load; report the delta |
| Online backfill throughput | ≥ **15,000 rows/s** sustained; full 140M in a bounded run (report wall-clock) |
| Replication lag during backfill | held **< 5 s** (throttle the backfill to keep it there) — report the throttle curve |
| Dual-write divergence rate (steady state) | **0** unreconciled rows after the reconciler converges; report transient divergence under load |
| Shadow-compare mismatch rate before cutover | **< 0.01%** of compared requests; every mismatch class explained or fixed |
| Cutover rollback time | **< 30 s** from "bad signal" to "fully back on monolith path" |
| Blast radius of a bad cutover | Bounded by flag scope; quantify users/requests affected per rollout step |

> The point isn't to hit a magic backfill number — it's to **hold the lag SLO
> while backfilling**, **prove old==new with shadow traffic**, and **show a
> rollback that actually works under load.**

## 6. Architecture constraints & guidance

- **Strangler-fig, not rewrite.** New functionality and redirected traffic flow
  through the facade; the monolith path stays alive and authoritative until the
  flag says otherwise. Never delete the old path before the new one is proven.
- **Expand-contract (parallel-change) for every schema move.** Add the new
  column/table/store (expand), make both old and new readers/writers coexist
  (migrate), then remove the old (contract). Never a destructive in-place change
  on a live 140M-row table.
- **No shared-DB anti-pattern at the end.** The interim dual-write is a means,
  not the destination. By "done," the monolith reads the **Orders Service**, not
  the old table. Two services sharing one table is a failure state, not a
  milestone.
- **Avoid distributed transactions.** Once the table is split, a write spanning
  monolith + service must not use 2PC. Use the outbox + saga / eventual
  consistency and make the reconciler the safety net.
- **Feature flags are infrastructure.** Percentage rollout, per-`customer_id`
  targeting, and an instant global kill switch. Evaluate the flag at the router,
  not deep in business logic.
- **Instrument everything** with Prometheus: per-path latency (monolith vs
  service), dual-write success/lag, backfill rows/s and throttle state, replica
  lag, shadow mismatch rate, flag exposure percentage. Build a Grafana board.

## 7. Data model

**Before — shared DB (the coupling you must break):**
```
shared Postgres
  orders(id PK, customer_id, status, total_cents, created_at, updated_at, ...)   -- 140M rows
  order_items(id PK, order_id FK→orders.id, sku, qty, price_cents)
  shipments(id PK, order_id FK→orders.id, carrier, tracking, state)              -- fulfillment context
  payments(id PK, order_id FK→orders.id, amount_cents, state)                    -- billing context
-- checkout, fulfillment, admin, reporting all read/write orders directly
```

**After — split, FK severed:**
```
orders DB (Orders Service, authoritative)
  orders(id PK, customer_id, status, total_cents, created_at, updated_at,
         migrated_at, source_version)

monolith DB (other contexts; orders FK replaced by a soft reference)
  shipments(id PK, order_id BIGINT /* logical ref, no FK */, ...)
  payments(id PK, order_id BIGINT /* logical ref, no FK */, ...)
  -- cross-context invariants now enforced by the service API + saga, not a DB FK
```

**During — dual-write + reconcile:**
```
write order mutation:
  1) monolith TX writes shared.orders        (old, still authoritative)
  2) enqueue outbox row  (order_id, op, payload, version)   -- same TX, atomic
  3) relay applies outbox → Orders Service DB (new, shadow-authoritative)
reconcile ledger:
  migration_state(order_id PK, backfilled BOOL, last_synced_version, diverged BOOL)
```
The outbox makes the dual-write **atomic with the source write** (no lost
update if the second store is briefly down); the reconciler closes the gap when
the relay falls behind or a write races the backfill. Authority flips from
"old store" to "new store" only at cutover, behind the flag.

## 8. Interface contract

**Orders Service API (the contract the facade and monolith both speak):**
- `GET  /orders/{id}` → `{ id, customer_id, status, total_cents, ... }`
- `GET  /orders?customer_id=N&cursor=...` → cursor-paginated list
- `POST /orders` → create (idempotent via `Idempotency-Key`)
- `PATCH /orders/{id}` → status transition (saga step for fulfillment/payment)
- `GET  /metrics` → Prometheus exposition

**Strangler router / flag contract:**
- Per request, resolve `route(order_id|customer_id) ∈ {monolith, service, shadow}`
  from the flag store. `shadow` serves from monolith **and** mirrors to service,
  comparing responses out of band.
- `cutover.percentage` (0→100), `cutover.targets` (per-`customer_id` allow-list),
  `cutover.kill` (instant global revert to `monolith`).
- Rollback is a single flag write: `cutover.kill=true` → router serves monolith
  for 100% within one flag-propagation interval (target < 30 s).

## 9. Key technical challenges

- **DB decomposition / breaking FKs.** `shipments`/`payments` FK into `orders`.
  You can't just drop the constraint and split — you must replace the FK with an
  application-enforced invariant (service API + saga) and decide what happens to
  an in-flight write that straddles the split. Get this wrong and you orphan rows.
- **Dual-write consistency under load.** Two stores, one truth. A naive
  "write A then write B" loses data if B is down or the process dies between
  them. The outbox makes it atomic with the source TX; the relay gives
  at-least-once delivery; idempotent apply + the reconciler give convergence.
  You must **detect** divergence (it *will* happen under 3,000 writes/s racing a
  backfill) and **repair** it — and explain every divergence class.
- **Online backfill without locking.** Copying 140M rows while writes continue
  means: batched key ranges, `WHERE id BETWEEN`, no long transactions, no
  `SELECT ... FOR UPDATE` over big ranges, and throttling tied to **replica lag**
  — speed up when lag is low, back off when it climbs. Reconcile rows the
  backfill copied *before* a concurrent live write changed them.
- **Expand-contract correctness.** During the migrate phase, readers must
  tolerate both shapes and writers must populate both. The window where old and
  new coexist is where most zero-downtime migrations actually break.
- **Shadow comparison noise.** Timestamps, ordering, and non-deterministic
  fields produce false mismatches. You must normalize before comparing or you'll
  chase ghosts and never trust the <0.01% bar.
- **Cutover blast radius.** A bad flip shouldn't take down everyone. Stage the
  rollout (1% → per-customer canary → 50% → 100%) and make rollback faster than
  the time it takes to notice.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each:

1. **Online backfill — throttle vs lag.** Run the 140M-row backfill at fixed
   batch sizes (1k / 10k / 50k rows) with **3,000 writes/s** live. Plot
   rows/s vs replica lag. Then make the backfill **lag-aware** (back off when
   lag > 5 s) and show it holds the SLO while maximizing throughput. Where's
   the knee?
2. **Dual-write divergence under load.** Run dual-write at 3,000 writes/s, then
   inject failures (kill the relay, pause the service DB for 10 s, drop a
   message). Measure how many rows diverge, how the reconciler detects it, and
   time-to-convergence. Prove the outbox prevents *lost* writes (vs naive
   write-A-then-B, which you should also run to show data loss).
3. **Shadow-compare old vs new.** Mirror 100% of read traffic to the new service
   for 1 hour. Report the mismatch rate, bucket the mismatches by cause
   (real bug vs normalization artifact), fix the real ones, and show the rate
   drop under the 0.01% SLO.
4. **Flag-driven cutover + rollback drill.** Roll the flag 1% → 10% → 50% → 100%.
   At 50%, simulate a regression (latency spike on the service path) and hit the
   kill switch. Measure rollback time and the blast radius (users/requests served
   by the bad path before revert).
5. **Expand-contract, zero downtime.** Add a `migrated_at` column and a new
   status enum value to the live `orders` table using expand-contract. Prove
   zero downtime and zero failed requests during each phase; contrast with the
   naive `ALTER` that would lock the table.
6. **Latency/correctness before vs after.** At equal load, compare monolith path
   vs service path: p50/p99/p999 and a row-level correctness diff over a sample.
   Quantify the extraction's latency cost and prove zero correctness regression.
7. **Saga vs would-be 2PC.** Implement an order→payment→shipment transition as a
   saga across the split. Inject a mid-saga failure and show compensation
   restores a consistent state — then articulate why 2PC was the wrong tool.

## 11. Milestones

1. **Stand up reality.** Monolith + shared DB at 140M rows; fulfillment worker
   and admin endpoint that FK into `orders`; load harness at 3k writes/s,
   20k reads/s; Prometheus + Grafana board.
2. **Pick the seam.** Justify extracting `orders` first (risk × value); document
   the bounded-context boundary and the FK edges you'll sever, and the sequence.
3. **Strangler facade.** Router fronts the order endpoints; flag store wired;
   100% still routes to monolith (no behavior change yet).
4. **Dual-write + outbox.** Every order mutation writes the monolith TX + outbox;
   relay applies to the Orders Service DB; reconciler online (experiment 2).
5. **Online backfill.** Lag-aware throttled backfill of 140M rows; reconcile
   backfill-vs-live races; hold replica-lag SLO (experiment 1).
6. **Shadow / dark launch.** Mirror read traffic, compare old vs new, drive
   mismatch < 0.01% (experiment 3); expand-contract any schema deltas
   (experiment 5).
7. **Cutover + rollback.** Staged flag rollout to 100%, rollback drill, blast-
   radius measurement (experiment 4); flip authority to the new store; sever the
   FKs; before/after latency + correctness (experiments 6, 7). Contract: remove
   the old path.

## 12. Acceptance criteria (definition of done)

- [ ] **Zero** user-visible downtime across the whole migration — no maintenance
      window; the cutover is a hot flag flip (show the flag timeline + uptime).
- [ ] 140M-row backfill completed online at ≥ 15k rows/s **while** 3k writes/s
      continued, with **replica lag held < 5 s** — throttle curve attached.
- [ ] Dual-write reconciler converges to **zero** unreconciled rows; transient
      divergence under induced failure is detected and repaired (show the ledger).
- [ ] Naive write-A-then-B demonstrated to **lose** writes; outbox variant
      demonstrated **not** to — same fault, two outcomes.
- [ ] Shadow-compare mismatch rate **< 0.01%** before cutover, every mismatch
      class explained (real bug fixed, artifact normalized).
- [ ] Staged cutover **and** a rollback drill: kill switch reverts 100% to the
      monolith in **< 30 s**; blast radius quantified per step.
- [ ] By "done," the monolith reads the **Orders Service**, the cross-context FKs
      are severed, and **no two services share the `orders` table.**
- [ ] Before/after: service-path p99 within **+10%** of monolith and a row-level
      correctness diff showing zero regression.
- [ ] Every number is reproducible from a committed command + config.

## 13. Stretch goals

- Extract a **second** seam (`shipments`) reusing the playbook — and report how
  much of the machinery (facade, dual-write, backfill, shadow) was reusable.
- Replace the polling outbox relay with **CDC** (logical replication / Debezium)
  and compare dual-write lag and operational cost.
- **Online FK severance with backfill of denormalized data** so the fulfillment
  context never has to call the Orders Service on the hot path.
- Automate the shadow-compare into a **CI gate**: a candidate service build must
  hit < 0.01% mismatch on a recorded traffic sample before it can be deployed.
- Add a **per-tenant cutover** so different customers migrate independently, and
  measure noisy-neighbor isolation during the rollout.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Sequencing | Extracts a service | **Sequences by risk × value**; justifies the first seam; **always has a rollback** at each step |
| DB decomposition | Splits the table | Severs FKs safely, replaces them with an app/saga invariant, handles straddling writes |
| Dual-write | Writes both stores | Makes it atomic via outbox; **detects + reconciles** divergence; proves naive dual-write loses data |
| Online backfill | Backfills in batches | **Lag-aware throttle** holds the SLO; reconciles backfill-vs-live races; names the knee |
| Zero downtime | Avoids a maintenance window | Expand-contract every schema move; proves zero failed requests during each phase |
| Verification | Spot-checks new == old | **Shadow-compares** prod traffic, normalizes noise, drives mismatch under SLO before any user sees the new path |
| Cutover & rollback | Flag-gates the switch | Staged rollout, **< 30 s rollback drill under load**, blast radius quantified |
| Distributed correctness | Knows 2PC is risky | Avoids it with sagas/eventual consistency and explains *why* the design converges |
| Communication | Clear migration note | Could defend the sequence, the rollback, and every number to a staff panel |

## 15. References

- Martin Fowler — *StranglerFigApplication*; *ParallelChange* (expand-contract).
- Sam Newman — *Monolith to Microservices* (seams, DB decomposition, the
  shared-database anti-pattern, dual-writes, FK severance).
- *Designing Data-Intensive Applications* — Ch. 7 (transactions), Ch. 11 (derived
  data, dual-write hazards), Ch. 12 (the unbundled database).
- Outbox / saga / CDC patterns for distributed-transaction avoidance.
- Feature-flag rollout & kill-switch design; staged canary practice.
- See also: `Interview Question/12-software-architecture-and-design/` and
  `Interview Question/13-distributed-systems/` (and section 5, Postgres, for
  expand-contract and online backfill).
