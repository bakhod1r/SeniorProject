# Exactly-Once Across Service Boundaries: Inbox + Outbox

> Two services, an HTTP/gRPC call, and a Kafka topic between them — and a rule
> that no business effect may happen twice. Networks retry, brokers redeliver,
> and processes crash mid-flight. Build the **transactional outbox** (publish
> side) and the **inbox/dedup** (consume side), then *prove* a single effect
> under injected duplicates and crashes at high concurrency. There is no
> exactly-once delivery — only effectively-once processing, and you have to earn it.

| | |
|---|---|
| **Tier** | Lab (event-engineering) |
| **Primary domain** | Distributed messaging correctness |
| **Skills exercised** | Transactional outbox, inbox/dedup, idempotency keys, the dual-write problem, at-least-once → effectively-once, dedup-store lifecycle, Go (`twmb/franz-go`, `pgx`, gRPC) |
| **Interview sections** | 10 (API design), 11 (messaging), 13 (distributed systems) |
| **Est. effort** | 3–5 focused days |

---

## 1. Context

You own the **Orders** service. When a customer checks out, you must (a) persist
the order and (b) tell the **Payments** service to charge them. There are two
hops where a duplicate can sneak in: the **synchronous** HTTP/gRPC call the
client makes to you, and the **asynchronous** Kafka event you emit for Payments
to consume. Both layers retry. Both layers can deliver the same intent twice.
And your process can die *after* the DB commit but *before* the publish, or
*after* receiving an event but *before* the side effect lands.

Finance has already been burned: a network blip caused a retry, the retry won a
race, and a customer was charged twice. The fix isn't "retry less" — retries are
load-bearing for availability. The fix is to make every effect **idempotent** so
that a second delivery is a provable no-op.

Your job in this lab is to design and *prove* an effectively-once path across the
whole boundary: idempotency keys for the synchronous edge, a **transactional
outbox** so the Kafka publish can never silently diverge from the DB write, and
an **inbox/dedup** on the consumer so a redelivered event lands exactly one
effect. You will inject duplicates and crashes on purpose, run it hot, and come
back with `effects == intents`, not a hand-wave.

## 2. Goals / Non-goals

**Goals**
- Make the synchronous Orders API **idempotent** via client-supplied
  `Idempotency-Key`: N identical retries → one order, one response.
- Implement a **transactional outbox**: the business row and the outbox row
  commit in a *single* DB transaction; a relay publishes to Kafka after commit.
- Implement an **inbox/dedup** on Payments keyed by message id (or the carried
  idempotency key): a redelivered event produces exactly one charge.
- **Prove** the invariant `distinct_effects == distinct_intents` under (a) an
  injected duplicate-delivery rate, (b) a crash between DB commit and publish,
  and (c) a crash between receive and side-effect — all at high concurrency.
- Bound the dedup store: keep it correct at **100M+ processed keys** and expire
  old keys **without reopening the dedup window**.

**Non-goals**
- True exactly-once *delivery* — it doesn't exist over an unreliable network.
  You are building effectively-once *processing*. Say so in the findings.
- Distributed 2PC / XA across Postgres and Kafka. The whole point of outbox is to
  avoid it. (XA may appear only as a "why not this" comparison.)
- Kafka transactions (consume-process-produce EOS) as the *primary* mechanism —
  that's lab 01's job. Here the boundary is **DB ⇄ app**, not broker-internal.
- A saga / multi-step compensation workflow — that's `staff/02`.

## 3. Functional requirements

1. **Orders service** (`cmd/orders`) exposes `POST /orders` (HTTP) **and**
   `Orders.Create` (gRPC). Both accept an idempotency key (HTTP header
   `Idempotency-Key`; gRPC metadata `idempotency-key`). A repeated key returns
   the **original** result, does not create a second order, and does not emit a
   second outbox row.
2. Order creation writes the `orders` row **and** an `outbox` row in **one**
   `pgx` transaction. No publish happens inside the request path.
3. **Outbox relay** (`cmd/relay`) reads unpublished outbox rows in order,
   publishes to Kafka topic `order.events` via `franz-go`, and marks them
   published. It must guarantee **at-least-once** publish and survive its own
   crash without losing or reordering a key's events.
4. **Payments consumer** (`cmd/payments`) consumes `order.events`, and for each
   message: checks the **inbox** (dedup) table; if unseen, performs the charge
   **and** records the inbox row in **one** DB transaction; if seen, acks and
   skips. Net effect: one charge per order, ever.
5. **Chaos/dup harness** (`cmd/chaos`) can: inject a configurable
   duplicate-delivery rate on the consumer, `kill -9` the relay between commit
   and publish, and `kill -9` the consumer between charge and inbox-commit.
6. A **reconciler** (`cmd/recon`) emits the ground-truth diff:
   `produced_intents`, `distinct_orders`, `distinct_charges`, and any deltas.

## 4. Load & data profile

- **Synchronous load:** drive `POST /orders` at **≥ 5,000 req/s** for ≥ 20 min,
  with a **client-side retry storm**: ~**15%** of requests are retried 1–3× with
  the *same* idempotency key (simulating timeouts/proxy retries). Correct answer:
  one order per distinct key regardless.
- **Key space:** 50M distinct idempotency keys per run; key reuse for retries is
  deliberate and concentrated (a **Zipfian** hot set, s≈1.1, so a few keys are
  hammered concurrently — this is the hot-key contention case).
- **Async volume:** generate **≥ 200M order events** across runs into Kafka;
  inject a **configurable duplicate-delivery rate** (test at **5%** and **30%**)
  so the inbox is actually exercised, not decorative.
- **Dedup-store scale:** the inbox/dedup table must be tested at **100M+**
  retained keys to expose index size, write amplification, and the cost of the
  uniqueness check on the hot path.
- **Traffic model:** open-model for the producer (fixed send rate so you can
  watch outbox lag build); deterministic generators via a seed.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Sync idempotency correctness | For any key with N≥1 deliveries: **exactly one** order, all responses identical (incl. status + body) |
| Sync `POST /orders` p99 (incl. idempotency check) | < 25 ms at 5k req/s; report the cost of the dedup lookup vs. a non-idempotent baseline |
| Outbox relay throughput | Sustain publish rate **≥** transactional write rate; relay lag (committed-but-unpublished rows) bounded and **flat**, not monotonically rising |
| Outbox publish→consume p99 (commit → effect) | < 2 s at steady state |
| Async dedup correctness | At 5% **and** 30% injected duplicates: `distinct_charges == distinct_orders`, **zero** double-charges |
| Crash invariant (commit↔publish) | After `kill -9` of the relay mid-flight: every committed order is **eventually** published exactly-effect (at-least-once publish + downstream dedup) |
| Crash invariant (receive↔effect) | After `kill -9` of the consumer mid-flight: **zero** lost effects and **zero** double effects on restart |
| Dedup-store bound | Inbox stays correct at 100M+ keys; expiry removes keys **older than the redelivery horizon** without reopening the window — prove no resurrected duplicate |
| Hot-key contention | At Zipfian hot keys, no lost update and no deadlock storm; report p99 of the hot key vs. the cold key |

> The point isn't a magic latency number — it's the **invariant**:
> `distinct_effects == distinct_intents` through duplicates *and* crashes, with
> the SQL diff to prove it.

## 6. Architecture constraints & guidance

- **Postgres** (single instance via `docker-compose`, pinned version) is the
  source of truth for orders, the outbox, and the inbox. Use `pgx` (v5); do the
  business write and the outbox/inbox write in the **same** `tx`.
- **Kafka** (KRaft, 3 brokers) carries `order.events`. Use `twmb/franz-go`.
  Partition by `order_id` (or `account_id`) so a key's events stay ordered on
  one partition — ordering matters for the relay and for per-key dedup reasoning.
- **Relay options** — pick one and justify: (a) **polling** relay
  (`SELECT ... WHERE published_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED`),
  (b) **logical-decoding** relay reading the WAL. State the trade-off (poll lag &
  load vs. operational complexity). CDC-as-relay overlaps `events/01`; if you go
  there, cite it and keep the dedup contract identical.
- The relay publishes **after** the DB commit and is **at-least-once** by design:
  it may publish a row, crash before marking it `published`, and re-publish on
  restart. That duplicate is *expected* — the inbox absorbs it. Do not try to
  make the relay exactly-once; make the consumer idempotent instead.
- Instrument with Prometheus: sync req rate + idempotency hit/miss, outbox lag
  (unpublished row count + oldest-unpublished age), publish rate, consumer dedup
  hit/miss, charge rate, p50/p99/p999 at each hop.

## 7. Data model

```
-- Orders service (publish side)
orders(
  order_id        UUID PRIMARY KEY,
  account_id      BIGINT NOT NULL,
  amount_cents    BIGINT NOT NULL,
  status          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)

idempotency_keys(                         -- synchronous-edge dedup
  idem_key        TEXT PRIMARY KEY,        -- client-supplied
  request_hash    BYTEA NOT NULL,          -- guard against key reuse w/ different body
  order_id        UUID NOT NULL,
  response_code   INT NOT NULL,
  response_body   JSONB NOT NULL,          -- replay the original result verbatim
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)

outbox(                                    -- transactional outbox
  id              BIGSERIAL PRIMARY KEY,    -- monotonic publish order
  aggregate_id    UUID NOT NULL,            -- = order_id; partition key
  msg_id          UUID NOT NULL,            -- stable, carried to the consumer for dedup
  event_type      TEXT NOT NULL,
  payload         BYTEA NOT NULL,
  published_at    TIMESTAMPTZ,             -- NULL = pending
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)
CREATE INDEX outbox_pending ON outbox (id) WHERE published_at IS NULL;

-- Payments service (consume side)
inbox(                                      -- consumer dedup ledger
  msg_id          UUID PRIMARY KEY,         -- carried from outbox.msg_id
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)
charges(
  charge_id       UUID PRIMARY KEY,
  order_id        UUID NOT NULL UNIQUE,     -- belt-and-braces: one charge per order
  amount_cents    BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

The **two invariant-critical writes**: `(orders + outbox)` in one txn on the
publish side; `(charges + inbox)` in one txn on the consume side. If either pair
is split into two transactions, you've reintroduced the dual-write problem you
came to kill.

## 8. Interface contract

- `POST /orders` with header `Idempotency-Key: <uuid>` →
  `201 {order_id, status}` on first call; the **same** code+body on every retry
  of that key. Reusing a key with a *different* request body → `409` (hash
  mismatch), never a silent overwrite.
- gRPC `Orders.Create` — identical semantics; key in `idempotency-key` metadata.
- Kafka `order.events`: key = `order_id`; value carries `msg_id` (the dedup id),
  `event_type`, and payload. The `msg_id` is the consumer's dedup key — it must
  be **stable across redeliveries** (it comes from `outbox.msg_id`, not from a
  Kafka offset, so a relay re-publish keeps the same id).
- `GET /metrics` → Prometheus exposition at every binary.
- Flags/env: `-dup-rate`, `-retry-rate`, `-rate`, `-relay=poll|wal`,
  `-dedup-ttl`, `-crash-point=commit|publish|effect`.

## 9. Key technical challenges

- **The dual-write problem.** "Save the order, then publish to Kafka" is
  *wrong*: the process can crash between the two, or the publish can fail after
  the commit — now the DB and the topic disagree forever. The outbox makes the
  publish a *consequence* of the commit (same txn), so they can never silently
  diverge. Be able to explain why naive save-then-publish is a latent data-loss
  bug, not a rare edge case.
- **Exactly-once is a lie; effectively-once is the contract.** Delivery is
  at-least-once end to end. You achieve *effectively*-once by making every effect
  idempotent (idempotency key → inbox `msg_id` → unique constraint). Be precise
  about where dedup lives and why duplicates upstream are *fine*.
- **Stable dedup identity.** The consumer cannot dedup on Kafka `(partition,
  offset)` here — a relay re-publish lands at a *new* offset for the *same*
  intent. Dedup must key on the **business-stable** `msg_id` carried in the
  payload. Getting this wrong is the classic silent double-effect.
- **Bounding the dedup store without reopening the window.** A 100M-row inbox is
  a real index and a real write cost. You can expire old keys — but only those
  **older than the maximum possible redelivery delay**. Expire too aggressively
  and a late duplicate sails through. Quantify your "redelivery horizon" and tie
  the TTL to it.
- **Hot-key contention.** Zipfian retries mean many concurrent requests fight
  over the same `idem_key` row. `INSERT ... ON CONFLICT` + a uniqueness check
  must serialize them *without* a deadlock storm or a lost update. Measure hot-
  vs. cold-key p99.
- **Relay throughput vs. write rate.** If the relay publishes slower than the
  outbox fills, lag grows unbounded and end-to-end latency blows past SLO. The
  relay must batch publishes and `SKIP LOCKED` to parallelize without reordering
  a single key.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each. Every claim ends in a SQL diff or a
histogram, not prose.

1. **Sync idempotency under retry storm.** Drive 5k req/s with 15% same-key
   retries (Zipfian hot keys). Measure: `distinct_orders == distinct_keys`?
   p99 of `POST /orders` *with* the idempotency check vs. a non-idempotent
   baseline (the cost of correctness). Confirm every retry returns the byte-
   identical original response.
2. **Inject duplicate deliveries, prove single effect.** Run the consumer at 5%
   then 30% injected duplicates. Measure: `distinct_charges == distinct_orders`,
   zero double-charges. Report consumer throughput at each dup rate (dedup
   overhead) and inbox hit/miss ratio.
3. **Crash between DB commit and publish.** `kill -9` the relay after a commit
   but before `published_at` is set, mid-load. On restart, prove every committed
   order is **eventually** published and produces **exactly one** charge
   (at-least-once publish + inbox absorbs the re-publish). Measure recovery time
   and the count of duplicate publishes the inbox swallowed.
4. **Crash between receive and side-effect.** `kill -9` the consumer after the
   charge writes but before `inbox` commits (and the inverse ordering). Prove on
   restart: zero lost charges, zero double charges. This experiment *justifies*
   putting `charges` and `inbox` in the **same** transaction — show what breaks
   if you split them.
5. **Dedup-table growth & expiry vs. correctness window.** Grow the inbox to
   100M+ keys; measure insert p99 and index size. Then enable TTL expiry: first
   set the TTL **shorter** than the redelivery horizon and *demonstrate a
   resurrected duplicate* (a real double-charge), then set it correctly and show
   the duplicate is still caught. State your redelivery-horizon number and how
   you derived it.
6. **Outbox relay throughput & lag under write bursts.** Burst the write rate to
   2–3× the relay's steady publish rate. Plot outbox lag (unpublished count +
   oldest-unpublished age). Tune relay batch size and `SKIP LOCKED` parallelism;
   find the point where lag stops being flat. Compare `poll` vs. `wal` relay.
7. **Idempotency-key contention on hot keys.** Concentrate retries on the top-10
   Zipfian keys. Measure hot-key p99 vs. cold-key p99, deadlock/serialization-
   failure rate, and retries-per-success. Compare `INSERT ON CONFLICT` against
   an advisory-lock approach.

## 11. Milestones

1. Compose Postgres + Kafka up; Orders service with the transactional
   `(orders + outbox)` write; relay publishing to `order.events`; Prometheus +
   a Grafana board (sync rate, outbox lag, publish rate, consume rate).
2. Synchronous idempotency layer (`idempotency_keys`, request-hash guard,
   verbatim replay); experiment 1.
3. Payments consumer with `(charges + inbox)` dedup txn; experiments 2 and 4.
4. Crash injection on the relay; experiment 3; reconciler `effects == intents`.
5. Dedup-store scale + expiry investigation (experiment 5) and relay/hot-key
   tuning (experiments 6, 7); findings note.

## 12. Acceptance criteria (definition of done)

- [ ] A ≥ 20-min run at 5k req/s with 15% same-key retries where
      `distinct_orders == distinct_keys` **exactly** (SQL diff attached).
- [ ] At both 5% and 30% injected duplicate delivery,
      `distinct_charges == distinct_orders`, **zero** double-charges (SQL diff).
- [ ] `kill -9` the relay between commit and publish mid-load → every committed
      order eventually publishes and produces **exactly one** charge; the count
      of absorbed duplicate publishes is reported.
- [ ] `kill -9` the consumer between charge and inbox-commit (both orderings) →
      zero lost, zero double effects on restart; the same-transaction argument
      is written down with the failing split-transaction counter-example.
- [ ] Inbox proven correct at 100M+ keys; the redelivery-horizon number is
      stated and the TTL is tied to it, with the "too-short TTL resurrects a
      duplicate" demonstration included.
- [ ] Outbox lag stays **flat** under steady load and is bounded under a burst;
      relay throughput ≥ write rate, with the curve plotted.
- [ ] Findings note explains **effectively-once vs. exactly-once** and why naive
      save-then-publish is a data-loss bug.
- [ ] Every number reproduces from a committed command + config.

## 13. Stretch goals

- **Exactly-once response replay parity:** make the idempotency-key replay return
  identical headers (incl. `Location`, `ETag`) and trailers, not just body —
  prove a proxy can't tell a replay from the original.
- **WAL/CDC relay:** swap the polling relay for a logical-decoding relay and
  measure the lag reduction and the operational cost (cross-ref `events/01`).
- **Bloom-filter front for the inbox:** put a probabilistic pre-filter before the
  DB uniqueness check to cut hot-path reads; measure the false-positive cost and
  prove it can't cause a missed duplicate (the DB stays authoritative).
- **Partitioned/rolling inbox:** time-partition the inbox by day so expiry is a
  `DROP PARTITION` instead of a delete storm; measure write amplification vs. the
  single-table design.
- **Idempotent gRPC streaming:** extend keys to a streaming RPC and reason about
  partial-stream replay.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Dual-write understanding | Knows save-then-publish can diverge | Explains *why* it's a latent data-loss bug; derives outbox from first principles |
| Outbox correctness | Business + outbox in one txn; relay publishes | Relay is provably at-least-once; reasons about ordering, `SKIP LOCKED`, and re-publish on crash |
| Inbox / dedup | Dedups on a stable `msg_id`, one effect | Explains why offset-based dedup fails here; puts effect + inbox in one txn and defends it |
| Idempotency keys (sync) | Same key → one order, replayed result | Guards request-hash reuse, handles hot-key contention without deadlock storms |
| Effectively- vs exactly-once | Uses the terms correctly | Articulates the exact boundary where dedup lives and why upstream duplicates are acceptable |
| Dedup-store lifecycle | Notes the table grows | Bounds it to the redelivery horizon; proves expiry can't reopen the window |
| Crash semantics | Invariant holds in the happy path | Holds through commit↔publish and receive↔effect crashes; shows the split-txn counter-example |
| Communication | Clear findings note | Could defend `effects == intents` and every curve to a staff panel |

## 15. References

- **`Interview Question/11-messaging-and-event-streaming/`** — delivery
  guarantees, transactional outbox, idempotent consumers, dedup strategies.
- **`Interview Question/10-api-design/`** — idempotency keys, safe vs. idempotent
  methods, request replay and the `Idempotency-Key` contract.
- *Designing Data-Intensive Applications* — Ch. 9 (consistency, exactly-once
  semantics) and Ch. 11 (stream processing, dual writes).
- Pat Helland, *"Idempotence Is Not a Medical Condition."*
- microservices.io — **Transactional Outbox** and **Idempotent Consumer**
  patterns.
- Stripe Engineering — *"Designing robust and predictable APIs with idempotency."*
- `twmb/franz-go` producer/consumer; `pgx` (v5) transactions; Postgres
  `INSERT ... ON CONFLICT` and `FOR UPDATE SKIP LOCKED` docs.
- **See also:** sibling `senior/07-event-driven-order-payment-service/` (the full
  Orders/Payments service this lab's patterns power) and
  `staff/02-event-sourced-cqrs-saga/` (when one effect becomes a multi-step,
  compensating distributed transaction). Companion lab: `labs/01-kafka-throughput-and-exactly-once/`
  (broker-internal EOS vs. this lab's DB⇄app boundary).
