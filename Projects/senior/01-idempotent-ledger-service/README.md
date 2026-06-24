# Idempotent Double-Entry Ledger / Payments Service

> Build the service that moves money. Record every movement as an immutable
> double-entry transaction that stays *exactly* correct under concurrent
> transfers, client retries, and mid-flight crashes — no lost money, no
> double-counted money — while sustaining ≥ 10k transfers/s and growing the
> ledger to hundreds of millions of rows.

| | |
|---|---|
| **Tier** | Senior (own a service end-to-end) |
| **Primary domain** | Financial correctness / transactional systems |
| **Skills exercised** | Postgres isolation & row locking, idempotency keys, double-entry accounting, exactly-once over HTTP+DB, money as integer minor units, audit, Go (`pgx`, `database/sql`) |
| **Interview sections** | 5 (Postgres & SQL), 10 (API design), 15 (testing), 16 (security) |
| **Est. effort** | 4–6 focused days |

---

## 1. Context

You own the ledger service for a payments platform. Every wallet top-up, transfer,
refund, and fee passes through you, and the balances you publish are what the rest
of the company bills, settles, and audits against. The bar is not "usually right" —
it is **exactly right, every time, forever**: the sum of money in the system is
conserved, no transfer is silently lost, and no transfer is ever applied twice.

Two forces make this hard. First, **concurrency**: many transfers hit the same hot
account at once (a popular merchant, a treasury account, a payroll run), and a naive
read-modify-write loses updates. Second, **retries**: the network times out, the
client retries the same `POST /transfers`, and a careless design moves the money
twice. Your job is to design the data model, the locking strategy, and the
idempotency layer so that neither force can corrupt the books — and to *prove* it
under load, not assert it.

You will produce numbers and a correctness audit, not opinions.

## 2. Goals / Non-goals

**Goals**
- Record money movements as **immutable, append-only double-entry transactions**
  where every transaction's postings sum to zero and balances are derivable from
  the postings.
- Make `POST /transfers` **idempotent**: a retried or duplicated request with the
  same idempotency key produces exactly one ledger effect and returns the same
  response.
- Keep balances **exact under concurrent transfers on the same account** at ≥ 10k
  TPS — no lost updates, no negative balances where overdraft is disallowed.
- Choose and justify an isolation/locking strategy (`SERIALIZABLE` vs
  `READ COMMITTED` + `SELECT … FOR UPDATE`) and **measure its throughput cost**.
- Serve fast balance reads via **snapshots/materialized balances**, kept consistent
  with the append-only postings.
- Survive a process kill mid-transaction with **zero partial postings** and a clean
  audit.

**Non-goals**
- A full banking core (interest, statements, FX, multi-currency netting). Single
  currency, integer minor units.
- A distributed/sharded ledger across regions (that's a staff lab). Single Postgres
  primary, optional read replica.
- An events/Kafka pipeline. Money correctness lives in the DB transaction here; the
  outbox version is `events/07`.
- Auth/identity provider internals — assume an upstream issues the caller a token;
  you enforce authorization on accounts.

## 3. Functional requirements

1. A **ledger API** (`cmd/ledgerd`) exposes:
   - `POST /accounts` — open an account with a currency and an overdraft policy.
   - `POST /transfers` — move an integer amount from one account to another,
     **idempotent on the `Idempotency-Key` header**.
   - `GET /accounts/{id}/balance` — current balance (from the snapshot).
   - `GET /accounts/{id}/postings` — paginated ledger history (the audit trail).
2. Every transfer writes **one `transactions` row + exactly two `postings`** (debit
   one account, credit the other) whose `amount`s sum to **zero**. Multi-leg
   transactions (e.g. transfer + fee) are allowed and must *also* sum to zero.
3. **Idempotency:** a second request with the same key returns the **original**
   committed result (status, transaction id, body), and creates **no new postings**.
   A same-key request with a **different payload** is rejected (`409`), never
   silently applied.
4. **No negative balances** for accounts whose policy forbids overdraft, even under
   concurrent debits racing on the same account.
5. The `postings` table is **append-only**: no `UPDATE`/`DELETE` in normal
   operation (enforce it). Balance changes are expressed as new postings.
6. A **chaos hook** (`cmd/chaos`) can `kill -9` the service between the posting
   insert and the commit, and during idempotency-key reservation, to test recovery.

## 4. Load & data profile

- **Throughput target:** sustain **≥ 10,000 transfers/s** for ≥ 10 minutes; report
  the ceiling and what bounds it.
- **Ledger size:** seed and grow to **≥ 200,000,000 postings** (≈ 100M
  transactions) so reads, indexes, and the balance-summation anti-pattern actually
  hurt. State table size on disk.
- **Account population:** 10,000,000 accounts.
- **Hot-account skew:** transfer endpoints chosen **Zipfian (s ≈ 1.2)** so a handful
  of accounts receive a large share of all transfers. This is deliberate — it
  manufactures the lock-contention hot spot you must reason about.
- **Retry/duplicate mix:** the load generator replays **5–10 %** of requests with the
  *same* idempotency key (simulating client retries and at-least-once delivery from
  an upstream), so the dedup path is constantly exercised, not a corner case.
- **Money:** amounts are `int64` **minor units** (cents). Floats are forbidden
  anywhere in the path; a lint/test must fail if a `float` touches an amount.
- **Generator:** `cmd/gen` is deterministic given a seed; it emits a transfer stream
  plus the planned duplicate replays.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Sustained transfer throughput (commit/s, single primary) | **≥ 10,000 TPS**; report the ceiling and name the bound (lock wait? WAL fsync? CPU? connection pool?) |
| `POST /transfers` p99 (uncontended accounts) | **< 25 ms** at 80 % of ceiling |
| `POST /transfers` p99 (hot account, Zipfian) | Measured & explained; report the contention tax vs uncontended |
| `GET …/balance` p99 (from snapshot) | **< 5 ms** at load |
| Idempotency-key dedup overhead | Δ p99 vs no-dedup path, measured |
| **Conservation invariant** | `SUM(amount)` over **all** postings = **0** at all times |
| **Per-transaction invariant** | every transaction's postings sum to 0 (no orphan/odd-legged txn) |
| **Idempotency invariant** | for any key, **exactly one** committed transaction; N retries ⇒ 1 effect |
| **Snapshot agreement** | for every account, `snapshot_balance == SUM(postings.amount)` |
| **No-overdraft invariant** | no non-overdraft account ever has `balance < 0` |
| **Crash safety** | after chaos kills, zero half-written transactions (no single-leg postings) |

> The point is not to hit a magic TPS number — it's to find *your* ceiling, name
> the bottleneck, and prove the four invariants survive both contention and crashes.

## 6. Architecture constraints & guidance

- **Postgres** (pin the major version, ≥ 15) as the single source of truth on one
  primary; an optional streaming read replica for balance/history reads.
- **Go** with `jackc/pgx/v5` (use the pool; prepared statements; `pgx` numeric/int64
  handling — never scan money into `float64`).
- Do all of a transfer's work — idempotency reservation, both postings, snapshot
  update — **inside one DB transaction**. The atomicity boundary *is* the DB
  transaction; that is what makes it exactly-once.
- Pick an isolation strategy and own the trade-off:
  - **`READ COMMITTED` + `SELECT … FOR UPDATE`** on the affected account rows (lock
    in a **deterministic order** by `account_id` to avoid deadlocks), or
  - **`SERIALIZABLE`** (SSI) with a **retry-on-`40001`** loop.
  Implement at least the `FOR UPDATE` path; ideally both, behind a flag, and compare.
- Instrument with Prometheus: commit rate, p50/p99/p999 per endpoint, lock-wait time,
  serialization-failure retries, dedup hits, pool saturation.
- Keep `ledgerd` stateless (all state in Postgres) so you can run N replicas behind a
  load balancer and the invariants must still hold.

## 7. Data model

```sql
-- Accounts: identity, currency, and whether overdraft is permitted.
accounts(
  id            BIGINT PRIMARY KEY,
  currency      CHAR(3)     NOT NULL,
  allow_overdraft BOOLEAN   NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)

-- Transactions: the unit of money movement. Immutable once committed.
transactions(
  id            BIGINT PRIMARY KEY,           -- snowflake/ulid, monotonic-ish
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind          TEXT        NOT NULL,         -- transfer | fee | topup | refund
  reference     TEXT                          -- external correlation id (nullable)
)

-- Postings: the double-entry legs. APPEND-ONLY. Money in minor units (int).
postings(
  id            BIGINT PRIMARY KEY,
  txn_id        BIGINT  NOT NULL REFERENCES transactions(id),
  account_id    BIGINT  NOT NULL REFERENCES accounts(id),
  amount        BIGINT  NOT NULL,             -- signed minor units; debit<0, credit>0
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)
-- INVARIANT, enforced: SUM(amount) per txn_id = 0.
-- Index for history + per-account summation:
--   CREATE INDEX ON postings(account_id, id);
-- Block mutation: REVOKE UPDATE,DELETE; or a trigger that RAISEs on UPDATE/DELETE.

-- Idempotency ledger: one row per client key; the dedup guard.
idempotency_keys(
  key           TEXT PRIMARY KEY,             -- client-supplied Idempotency-Key
  request_hash  BYTEA  NOT NULL,              -- hash of (endpoint, body) to catch reuse-with-different-payload
  txn_id        BIGINT REFERENCES transactions(id),  -- set on success
  status        TEXT   NOT NULL,             -- in_progress | completed
  response_code INT,
  response_body JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)

-- Balance snapshot: materialized current balance for O(1) reads.
balances(
  account_id    BIGINT PRIMARY KEY REFERENCES accounts(id),
  balance       BIGINT  NOT NULL DEFAULT 0,   -- = SUM(postings.amount) for this account
  updated_at    TIMESTAMPTZ NOT NULL
)
```

**Balance derivation.** The authoritative balance is `SUM(postings.amount)` for an
account; `balances` is a snapshot kept in lockstep inside the same transaction as the
postings (or rebuilt from postings on demand). A periodic/online audit must confirm
`balances.balance == SUM(postings.amount)` for every account — they must never drift.

**Why integers.** `amount` is `BIGINT` minor units. Floats lose pennies under
addition and break conservation; a test must reject any `float` in the money path.

## 8. API contract

```
POST /accounts
  body: { "currency": "USD", "allow_overdraft": false }
  201 → { "id": 12345, "currency": "USD", "allow_overdraft": false }

POST /transfers
  headers: Idempotency-Key: <client-uuid>   (required)
  body: { "from": 12345, "to": 67890, "amount": 2500, "reference": "ord-9" }   // 2500 = $25.00
  201 → { "txn_id": 998877, "from": 12345, "to": 67890, "amount": 2500, "status": "posted" }
  // Retried with the SAME key + SAME body → 200 with the ORIGINAL txn_id (no new postings).
  // Same key + DIFFERENT body → 409 { "error": "idempotency_key_reuse" }.
  // Debit would overdraw a no-overdraft account → 422 { "error": "insufficient_funds" }.

GET /accounts/{id}/balance
  200 → { "account_id": 12345, "balance": 14200, "as_of": "2026-06-24T10:00:00Z" }

GET /accounts/{id}/postings?cursor=&limit=100
  200 → { "postings": [ { "txn_id":…, "amount": -2500, "created_at":… }, … ], "next_cursor": "…" }

GET /metrics   → Prometheus exposition.
```

**Idempotency semantics (the contract that matters):**
- The key is reserved (`status=in_progress`) in the *same* transaction that writes
  the postings. On commit it flips to `completed` with the stored response.
- A concurrent retry that arrives while the first is `in_progress` must either block
  on the row and then return the committed result, or get a retriable `409 in
  progress` — never a second set of postings.
- The stored `request_hash` guards against a client reusing a key for a different
  transfer.

## 9. Key technical challenges

- **The lost-update problem.** Two concurrent debits read balance 100, each subtract
  60, each write 40 → money invented. A read-modify-write in app code is *wrong*. You
  must serialize the account's mutation via `FOR UPDATE` or `SERIALIZABLE`, and you
  must *show* the naive version losing money.
- **Exactly-once across API + DB.** The retry can arrive after the first request
  committed but before the client saw the response. Idempotency must be a **committed
  DB fact**, reserved in the same transaction as the money move — not an in-memory set
  or a separate write that can tear from the postings.
- **Deadlocks from lock ordering.** Transfer A→B and B→A locking in request order
  deadlock. Lock account rows in a **canonical order** (e.g. ascending `account_id`).
- **Hot-account contention.** Zipfian skew means a few accounts serialize *all* their
  transfers through one row lock; that row's lock-wait is your TPS ceiling for that
  account. Quantify it; discuss mitigations (batching, sharded sub-accounts/“buckets”,
  async netting) without breaking conservation.
- **Snapshot consistency.** Updating `balances` in the same transaction is correct but
  adds a second hot row to lock. Summing postings on every read is always correct but
  O(history) and slow at 200M rows. You must justify your read path and prove it
  agrees with the postings.
- **Crash atomicity.** A `kill -9` between the two posting inserts must leave **no**
  single-leg transaction. The DB transaction gives you this for free *if* both legs
  and the key live in one transaction — proving you actually got that boundary right
  is the test.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each:

1. **Prove the lost update.** Run the naive read-modify-write balance path with K
   concurrent debits on one account; show the final balance is wrong (money created
   or destroyed). Then switch to `SELECT … FOR UPDATE` and show
   `final == initial − Σdebits` exactly. This is the load-bearing demo.
2. **Isolation bake-off.** Same hot-account workload under `READ COMMITTED` +
   `FOR UPDATE` vs `SERIALIZABLE` (with `40001` retry loop). Report TPS, p99, and
   serialization-retry rate for each. State which you'd ship and why.
3. **Idempotency under duplication.** Drive the stream with 10 % same-key replays,
   some fired **concurrently** (true thundering herd on one key). Prove **exactly one**
   transaction exists per key and every retry returned the same body. Then measure the
   dedup path's overhead vs a no-dedup baseline.
4. **TPS ceiling & the contention bottleneck.** Push transfers up until commit/s flat-
   lines. Separate the **uncontended** ceiling (random account pairs) from the **hot-
   account** ceiling (Zipfian). Name the bound with evidence — `pg_stat_activity` lock
   waits, WAL fsync, pool saturation, CPU.
5. **Snapshot vs sum-on-read.** Compare `GET /balance` p99 served from the `balances`
   snapshot vs computed as `SUM(postings.amount)` at 200M rows. Show the snapshot’s win
   and prove the two values agree (the audit query).
6. **Deadlock injection.** Fire A→B and B→A transfers concurrently without canonical
   lock ordering; observe deadlocks (`40P01`). Add ascending-`account_id` ordering;
   show them disappear.
7. **Chaos / correctness audit.** During a sustained run, `kill -9` the service
   repeatedly mid-transaction (and during key reservation). After recovery, run the
   full audit: per-txn sum = 0, global sum = 0, snapshot == Σpostings, no single-leg
   transactions, one txn per key. Attach the SQL and its output.

## 11. Milestones

1. Schema + `cmd/gen`; single-node `ledgerd` with `FOR UPDATE` transfers; Prometheus
   + a Grafana board for commit rate / p99 / lock-wait.
2. Idempotency layer (reserve-in-same-txn); duplicate-replay generator; experiment 3.
3. Seed to 200M postings; uncontended and hot-account ceiling runs (experiment 4);
   write down the bound.
4. `SERIALIZABLE` path behind a flag; isolation bake-off (experiment 2); lost-update
   demo (experiment 1); deadlock fix (experiment 6).
5. Balance snapshot vs sum-on-read (experiment 5); chaos audit (experiment 7);
   findings note.

## 12. Acceptance criteria (definition of done)

- [ ] Sustained ≥ 10-min run at a stated TPS with the commit-rate / p99 dashboard
      screenshot attached.
- [ ] Lost-update demo: naive path shown losing money; `FOR UPDATE` path exact
      (show the numbers).
- [ ] TPS ceiling reported **with the bottleneck named and proven** (lock-wait / WAL /
      pool evidence), separately for uncontended vs hot-account.
- [ ] Idempotency: under concurrent same-key replays, **exactly one** transaction per
      key; same-key/different-body rejected `409` (show the SQL count + a reuse test).
- [ ] Chaos audit passes: `SUM(amount)=0` globally, every txn sums to 0, every
      `balances` row == `SUM(postings)`, zero single-leg transactions (show the audit
      SQL and output).
- [ ] No-overdraft accounts never went negative under the hot-account race.
- [ ] A test fails if a `float` enters the money path.
- [ ] Every number reproducible from a committed command + config.

## 13. Stretch goals

- **Multi-leg transactions** (transfer + percentage fee to a fee account) that still
  sum to zero; prove conservation holds.
- **Outbox + exactly-once publish** of a `transfer.posted` event in the same DB
  transaction (the bridge to `events/07`).
- **Hot-account mitigation:** split a hot account into N sub-balance buckets and net
  them; measure the TPS gain and prove conservation is preserved.
- **Read replica** for `GET /balance` and history; measure replica lag and decide
  which reads tolerate it.
- **Online balance audit** as a background job that continuously checks
  `snapshot == Σpostings` and alerts on drift.
- **Partition `postings` by time** and measure history-read and index-bloat impact at
  200M+ rows.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Correctness model | Knows double-entry sums to zero; balances derive from postings | Treats conservation + per-txn-zero + snapshot-agreement as enforced invariants and audits them continuously |
| Concurrency | Uses `FOR UPDATE`; avoids lost updates | Compares `FOR UPDATE` vs `SERIALIZABLE` with numbers; explains lost-update, lock ordering, and the deadlock fix |
| Idempotency | Dedup table makes retries safe in the happy path | Key reserved in the *same* transaction as the money move; correct under concurrent same-key herd; guards key reuse |
| Throughput analysis | Reports a TPS number | Names and **proves** the bottleneck; separates uncontended vs hot-account; proposes a measured mitigation |
| Read path | Serves balances from a snapshot | Justifies snapshot vs sum-on-read at 200M rows and proves the two agree |
| Crash safety | Believes the DB transaction is atomic | Proves it: chaos-kills mid-transaction, runs the audit, shows zero partial state |
| Money handling | Uses integer minor units | Enforces it (lint/test), reasons about overflow and rounding |
| Communication | Clear findings note | Could defend every invariant and every curve to a staff panel |

## 15. References

- Postgres docs: transaction isolation (`READ COMMITTED`, `SERIALIZABLE`/SSI), row
  locking (`SELECT … FOR UPDATE`), and serialization-failure (`40001`) handling.
- *Designing Data-Intensive Applications* — Ch. 7 (Transactions): lost updates,
  write skew, isolation levels.
- Martin Kleppmann / accounting literature on **double-entry** as an append-only,
  self-checking ledger.
- Stripe engineering: idempotency keys for safe retries.
- `jackc/pgx` docs: connection pool, prepared statements, integer/numeric scanning.
- See also: `Interview Question/05-postgresql-and-sql/` (isolation, locking, indexing,
  EXPLAIN) and `Interview Question/16-security/` (idempotency abuse, authorization on
  accounts, audit trails, integer-vs-float money handling).
