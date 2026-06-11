# Parallel Change (Expand / Contract) — Professional

> **Source:** Danilo Sato, "ParallelChange"; Martin Fowler, martinfowler.com/bliki/ParallelChange.html

This level is about running expand/migrate/contract as a *production operation*:
the economics that decide whether to do it at all, the observability that gates
each phase, the rollback story for each step, partial-failure handling for
dual-writes and backfills, and end-to-end playbooks for the migrations you'll
actually run at scale.

## Contents

1. [Economics: what the parallel window costs and buys](#1-economics-what-the-parallel-window-costs-and-buys)
2. [Risk model per phase](#2-risk-model-per-phase)
3. [Observability: the old-path metric is the operation](#3-observability-the-old-path-metric-is-the-operation)
4. [Rollback per step](#4-rollback-per-step)
5. [Partial-failure handling](#5-partial-failure-handling)
6. [Playbook A: zero-downtime column migration on a hot table](#6-playbook-a-zero-downtime-column-migration-on-a-hot-table)
7. [Playbook B: deprecating a public API field across external clients](#7-playbook-b-deprecating-a-public-api-field-across-external-clients)
8. [Playbook C: event schema evolution on a shared topic](#8-playbook-c-event-schema-evolution-on-a-shared-topic)
9. [When NOT to](#9-when-not-to)
10. [Next](#next)

---

## 1. Economics: what the parallel window costs and buys

A parallel change is an *insurance purchase*. You pay a premium to avoid a tail
risk. Make the trade explicit before committing.

**What it costs (per day the window is open):**

- Carrying two code paths / two schemas — every reader and writer touches both.
- Dual-write CPU/IO and storage doubling for the migrated data.
- Backfill load on the primary (throttled, but real).
- A reconciliation job and its alerting.
- Doubled test surface (old, new, and old↔new compatibility).
- Cognitive load: every engineer must remember "we're mid-migration."

**What it buys:**

- **No coordinated big-bang deploy.** Producer and consumers ship independently.
- **A rollback target.** The old form stays correct, so any step is reversible
  until contract.
- **Bounded blast radius.** Ramped read-switch + canary localize failures.

**The decision rule:** Parallel Change pays off when
`P(big-bang failure) × cost(outage + data loss)` exceeds the window's carrying
cost. For anything touching persisted production data or independently-deployed
consumers, the outage/data-loss term dominates and the answer is "do the parallel
change." For a low-traffic internal change with a trivially reversible failure mode,
the carrying cost dominates and you should just change it directly.

---

## 2. Risk model per phase

| Phase | Failure mode | Reversible? | Gate before proceeding |
|-------|-------------|-------------|------------------------|
| EXPAND | Additive change breaks old path (e.g. `ADD COLUMN` takes a lock; non-tolerant clients choke on new field) | Yes — revert deploy / drop new column | Old path metrics flat; lock-free DDL verified |
| Dual-write on | Writes diverge; new-store write fails and fails the request | Yes — disable dual-write | Drift metric = 0; error rate flat |
| Backfill | Primary overload; replication lag; partial copy | Yes — pause/abort job | Lag and CPU within budget; resumable |
| Switch reads | New form wrong/incomplete → user-visible bad data | Yes — flag back to old (old still correct) | Shadow-read diff = 0; ramped 1→100% |
| Stop dual-write | Now only new is fresh; rolling back read-switch would serve stale old | **Reversible but rollback degraded** | Reads stable on new for a full soak |
| CONTRACT (drop) | Removed old form still had a caller → outage; data gone | **No — irreversible** | Old-path traffic = 0 across full cycle; backups taken |

The asymmetry is the whole game: **every step before "drop" is reversible; drop is
not.** So drop gets the strictest gate and is always last.

---

## 3. Observability: the old-path metric is the operation

You don't *reason* a migration to completion — you *watch* it. Instrument before you
expand; the dashboard is the control surface for the whole operation.

**Instrument the old path:**

```java
// Old form, during the window. The counter is the completion oracle.
public Money finalPrice(Money base, double discountPercent) {
    Metrics.counter("price.finalPrice.legacy",
                    "caller", CallContext.serviceName()).increment();
    return finalPrice(base, Discount.ofPercent(discountPercent));
}
```

**The panels that gate each phase:**

- **`*.legacy` calls/min, broken down by caller** — the contract oracle. Contract
  only when this is 0 across a full traffic cycle (cover weekly/monthly batch).
- **Dual-write error rate / latency** — new-store write must not fail user requests.
  Wrap it so a new-store failure degrades gracefully rather than failing the
  transaction during EXPAND (you don't want the *insurance* to cause the outage).
- **Drift gauge** — `count(new ≠ derive(old))`. Must be 0 before switch-reads and
  must stay 0 until contract.
- **Backfill progress / rate / DB load** — rows remaining, batch latency,
  replication lag, primary CPU.
- **Shadow-read diff** — during read ramp, compare new vs old result; nonzero = bug.

An alert on "`*.legacy` > 0 after sunset date" turns a forgotten migration into a
page. An alert on "drift > 0" catches dual-write bugs the day they appear, not the
day you contract.

---

## 4. Rollback per step

Rollback is *per step*, and the procedure differs:

1. **Revert EXPAND** — redeploy previous version; drop the new (empty) column. Old
   path was never touched, so this is clean.
2. **Disable dual-write** — flag off the second write. Old form was authoritative
   the whole time; nothing lost.
3. **Abort backfill** — it's idempotent/resumable; just stop. No partial-state
   problem because reads haven't switched.
4. **Revert read-switch** — flip the read flag back to old. Works *because dual-write
   kept old fresh*. This is why you don't stop dual-writing in the same step you
   switch reads.
5. **Revert stop-dual-write** — re-enable dual-write, then backfill the gap of
   old-form writes you missed while it was off (this is the one rollback that needs a
   catch-up). This is why "stop dual-write" gets its own soak before contract.
6. **Revert CONTRACT** — *there is none.* Recreate the column and re-backfill from
   backup, which is a recovery, not a rollback. Hence drop is last and most gated.

Design the whole sequence so the *irreversible* step is the final one and everything
else flips with a flag.

---

## 5. Partial-failure handling

- **Dual-write, new-store fails:** during EXPAND, prefer *best-effort* on the new
  store (log + drift metric) so the user's request still succeeds on the old
  authoritative path — the migration must not become the outage. Once you've
  *switched reads to new*, the new store is authoritative and its write failures
  must fail the request (or you serve stale reads).
- **Cross-store atomicity:** if old and new aren't in one transaction, you cannot
  dual-write atomically — use the **transactional outbox** (write intent in the same
  TX, relay publishes) or CDC so new is *derived* from authoritative-old. Never two
  independent writes you "hope" stay in sync.
- **Backfill crashes midway:** idempotent (`WHERE new IS NULL`) + keyset cursor →
  resume from the last committed batch. Never one giant transaction.
- **Reads switched but new data wrong for a subset:** ramped read-switch + shadow
  diffing catches this at 1% with old still authoritative. Flip back, fix
  derivation, re-verify, re-ramp.
- **Consumer you forgot:** the per-caller `*.legacy` counter surfaces it *before*
  contract. This is the entire reason the counter is tagged by caller.

---

## 6. Playbook A: zero-downtime column migration on a hot table

Migrate `users.name` (VARCHAR) to `users.full_name`, table is large and hot. This is
the canonical **database-migration-patterns** expand-contract; here's the operational
runbook.

1. **Pre-flight.** Confirm `ADD COLUMN` is lock-free / instant on your engine
   (nullable, no default scan). Take a backup. Stand up the dashboards (§3).
2. **EXPAND — DDL.** `ALTER TABLE users ADD COLUMN full_name VARCHAR(255) NULL;` —
   metadata-only on modern Postgres/MySQL.
3. **EXPAND — dual-write deploy.** Single DAO write path sets both columns in one
   transaction. Reads still on `name`. Verify dual-write error rate flat.
4. **Backfill.** Batched, throttled, idempotent (`WHERE full_name IS NULL`), keyset
   paginated. Watch replication lag and primary CPU; pause if budget exceeded.
5. **Verify.** `SELECT count(*) FROM users WHERE full_name IS DISTINCT FROM name` →
   0. Drift gauge 0.
6. **Switch reads — ramped.** Flag-controlled, 1% → 10% → 50% → 100%, shadow-diffing
   new vs old at each step.
7. **Soak.** Reads 100% on `full_name`, dual-write still on, for a defined period
   (hours–days). This preserves the rollback target.
8. **Stop dual-write.** Single-write `full_name`. Soak again.
9. **CONTRACT.** Backup, then `ALTER TABLE users DROP COLUMN name;`. Remove
   migration code and the temporary metrics.

Reversible through step 8; step 9 is the only irreversible action and is gated on
old-path reads/writes = 0.

---

## 7. Playbook B: deprecating a public API field across external clients

Remove `name`, add `firstName`/`lastName` from a partner-facing endpoint.

1. **EXPAND.** Responses include `name` *and* `firstName`/`lastName`; requests
   accept either shape (normalize internally). Tag every `name`-read/write with a
   per-client metric.
2. **Signal.** Changelog + docs mark `name` deprecated; responses carry
   `Deprecation: true` and `Sunset: <date>` headers; publish a migration guide and a
   self-serve "are you still using `name`?" answer (the per-client dashboard).
3. **MIGRATE.** Clients move; per-client `name`-usage counter burns down. Nudge the
   long tail individually before the sunset date.
4. **Gate.** Optionally enforce with consumer-driven contract tests (Pact
   `can-i-deploy`) so the pipeline refuses contract while any consumer contract still
   references `name`.
5. **CONTRACT.** After the counter is 0 across a full cycle *and* past the sunset
   date, drop `name` from responses and reject the old request shape. Keep the
   deprecation in the changelog.

For a *breaking* change you can't represent in one payload, the parallel unit is the
whole version (`/v1` + `/v2`); same five steps, version-grained.

---

## 8. Playbook C: event schema evolution on a shared topic

Rename a field in events on a Kafka topic with 7-day retention consumed by several
teams.

1. **EXPAND.** Producer emits both old and new fields (or new additively). Register
   schema with `FULL_TRANSITIVE` compatibility so old consumers still read.
2. **MIGRATE.** Consumers deploy to read new (fallback to old for replayed in-flight
   messages). Track per-consumer old-field reads.
3. **Drain the past.** Contract is blocked until *no old-format message can be
   replayed* — i.e. retention (7 days) has elapsed since the last old-format produce,
   or you've reprocessed/compacted them.
4. **Gate.** All consumers read new (telemetry = 0 on old field) **and** retention
   has aged out old-format messages.
5. **CONTRACT.** Producer stops emitting the old field; tighten the registry schema.

The retention drain is the step engineers forget — an event format's parallel window
has a *hard floor* of one retention period beyond the last old produce.

---

## 9. When NOT to

- **Reversible-failure, low-traffic internal change** where the worst case is a
  blip you can fix in minutes → the window's carrying cost (dual-write, drift jobs,
  dashboards, multi-team burndown) exceeds the risk removed. Change it directly.
- **You can take a real maintenance window** and the business accepts it → a single
  gated migration in the window is simpler and cheaper than dual-write + backfill +
  ramp for many cases.
- **Purely additive change** (new column/field nobody read before) → the "expand" is
  the entire change; there's nothing to migrate or contract.

The professional reflex: price the window honestly. Parallel Change is the right
default for production data and independently-deployed consumers, and over-engineering
for everything that fails reversibly and reaches no boundary you can't cross atomically.

---

## Next

- Test yourself: **[interview.md](interview.md)**, then **[tasks.md](tasks.md)**.
- Diagnose botched migrations: **[find-bug.md](find-bug.md)**.
