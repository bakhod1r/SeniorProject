# Parallel Change (Expand / Contract) — Middle

> **Source:** Danilo Sato, "ParallelChange"; Martin Fowler, martinfowler.com/bliki/ParallelChange.html

You know the three phases (expand → migrate → contract). This level is about
*applying them precisely* to the substrates you'll actually hit: public APIs,
database schemas, config, and event formats — plus the mechanics that make the
middle window safe: dual-write, backfill, deprecation signals, and knowing when
migration is truly complete.

## Contents

1. [The substrate decides the mechanics](#1-the-substrate-decides-the-mechanics)
2. [Public API / SDK change](#2-public-api--sdk-change)
3. [Database schema change in depth](#3-database-schema-change-in-depth)
4. [Config and event-format change](#4-config-and-event-format-change)
5. [Dual-write and backfill mechanics](#5-dual-write-and-backfill-mechanics)
6. [Deprecation signals](#6-deprecation-signals)
7. [Detecting that migration is complete](#7-detecting-that-migration-is-complete)
8. [Pitfalls](#8-pitfalls)
9. [Next](#next)

---

## 1. The substrate decides the mechanics

The three phases never change. What changes is *who the callers are* and *what
"alongside" means* for each substrate:

| Substrate | "Old + new alongside" means… | Migration is… | Evidence to contract |
|-----------|------------------------------|---------------|----------------------|
| Method signature | overloaded/new method | edit call sites | compiler / find-usages = 0 |
| Public API / SDK | new endpoint or version + old | clients upgrade | old-route metric = 0 |
| DB column | new column + dual-write | backfill + switch reads | new col fully populated, reads stable |
| Config key | accept both keys | rollout configs updated | old key absent everywhere |
| Event/message format | producer emits both / consumer reads both | producers & consumers updated | old-field consumers = 0 |

The hardest cases are the ones where a caller is *out of your control* and
*persists state*: a partner's SDK integration, a mobile app, rows already in a
table, events already in a topic. Those force the longest parallel windows.

---

## 2. Public API / SDK change

Suppose a REST endpoint returns a customer's name as one field and you need to
split it into `firstName` / `lastName`. External clients consume the JSON.

### EXPAND — add the new shape, keep the old

```json
// Response during the parallel window: BOTH forms present.
{
  "name": "Ada Lovelace",      // OLD field, still here
  "firstName": "Ada",          // NEW fields, added alongside
  "lastName": "Lovelace"
}
```

Numbered steps:

1. **Producer adds the new fields** while continuing to populate the old field.
   Old clients ignore the new fields (a well-behaved JSON client tolerates extra
   keys — this is why additive JSON changes are safe). New clients read the new
   fields.
2. For *request* bodies, the server **accepts both** the old and new shapes and
   normalizes internally:

```java
String firstName = body.has("firstName")
        ? body.get("firstName")
        : splitFirst(body.get("name"));   // fall back to old field
```

### MIGRATE — move clients, announce deprecation

3. Publish the new fields in docs/changelog; mark the old field deprecated (see
   §6). Give clients a real timeline.
4. Track which clients still send/read the old field (per-client metrics; §7).
   Reach out to the laggards.

### CONTRACT — remove the old field

5. Only after the old-field metric is zero across a full cycle, remove the old
   field from responses and reject the old request shape.

For *breaking* API changes you can't keep both in one representation, the parallel
unit becomes the whole **version**: ship `/v2`, keep `/v1` alive, migrate clients,
then sunset `/v1`. Same three phases, coarser grain. (API versioning and
deprecation strategy are their own discipline; here it's enough that v1/v2
coexistence *is* the expand window.)

> **When NOT to:** an internal, single-consumer API where you deploy producer and
> consumer together → change both in one PR. The parallel window only pays off when
> a consumer deploys independently or you can't force its upgrade.

---

## 3. Database schema change in depth

The junior file showed a column rename. Three common variants, all the same shape:

**Rename column** → add new col, dual-write, backfill, switch reads, stop old
write, drop old col. (Junior worked example.)

**Change column type / representation** (e.g. store `amount` as integer minor
units instead of `decimal` dollars):

1. EXPAND: add `amount_minor BIGINT`. Dual-write: on every write, set
   `amount_minor = round(amount * 100)`.
2. MIGRATE: backfill `amount_minor` from `amount` in batches; verify
   `SELECT count(*) WHERE amount_minor <> round(amount*100)` is 0; switch reads.
3. CONTRACT: stop writing `amount`; drop it.

**Split one table into two** (extract `address` out of `users`):

1. EXPAND: create `addresses`; dual-write address fields to both `users` and
   `addresses`.
2. MIGRATE: backfill `addresses` from `users`; switch reads to the join/new table.
3. CONTRACT: stop writing address columns on `users`; drop them.

The non-negotiable ordering for *every* DB variant:

> **Add new (additive, safe) → write both → backfill old data → switch reads →
> write only new → remove old.** Reads switch *after* backfill completes, and the
> old form is dropped *last*. Never reorder these.

Why this exact order: the destructive step (drop) is last and is the only
irreversible one; everything before it can be rolled back by redeploying the
previous app version, because the old column is still present and still correct.

> **When NOT to:** small table + acceptable downtime → single migration in a
> window. Also, if the change is purely additive (just *adding* a column nobody
> read before), you don't need the full dance — the "expand" is the whole change.

---

## 4. Config and event-format change

**Config key rename** (`db.url` → `database.connectionString`):

1. EXPAND: code reads the new key, falls back to the old:
   `cfg.get("database.connectionString").orElse(cfg.get("db.url"))`.
2. MIGRATE: update every environment/manifest to the new key.
3. CONTRACT: remove the fallback; the old key now does nothing (and you can fail
   loudly if it's still present, to catch stragglers).

**Event / message format change** (rename a field in a Kafka topic, add a new
required field): events are *persisted in flight* and consumers deploy on their own
schedules, so this is a textbook parallel change.

1. EXPAND: producer emits **both** the old and new fields. Consumers tolerate the
   old shape (don't depend on the new field yet).
2. MIGRATE: upgrade consumers to read the new field (with fallback to old for
   in-flight/replayed old events). Track which consumers still read the old field.
3. CONTRACT: once all consumers read new — *and* the topic's retention has aged out
   every old-format message (or you've drained/reprocessed them) — stop emitting
   the old field.

The retention point is the gotcha: you can't contract an event format until **no
old-format message can still be replayed**. With a 7-day topic, the parallel window
is at least 7 days *after* the last old-format produce.

> **When NOT to:** a topic owned and consumed by exactly one team that deploys
> producer+consumer together and uses a short retention → coordinate one deploy.

---

## 5. Dual-write and backfill mechanics

**Dual-write** = during EXPAND/MIGRATE, every write updates *both* the old and new
form, so reads from either are correct and you can roll back the read switch.

Make dual-writes hard to get wrong:

- **Single code path.** Don't scatter "also write the new column" across 15 call
  sites — you'll miss one and the columns drift. Funnel writes through one
  repository/DAO method that writes both.
- **Same transaction.** Write old and new in *one* DB transaction so they can't
  diverge on a partial failure. If they're in different stores (e.g. table + search
  index), you've lost atomicity — accept eventual consistency and add a
  reconciliation job, or use an outbox pattern.
- **Derive, don't duplicate logic.** `new = f(old)` computed in one place. Two
  independent computations of "the same thing" *will* drift.

**Backfill** = populate the new form for rows written *before* dual-writing began.

- **Batch it.** `WHERE id BETWEEN :lo AND :hi` or keyset pagination; never one giant
  `UPDATE` that locks the table or bloats the WAL/undo log.
- **Idempotent + resumable.** Filter on `WHERE new_col IS NULL` so re-running skips
  done rows and you can stop/restart safely.
- **Throttle.** Sleep between batches; watch replication lag and DB load. A backfill
  that pegs the primary is an outage.
- **Backfill, then dual-write — or dual-write, then backfill?** Turn on dual-write
  **first**, then backfill. If you backfill first, rows written between backfill and
  dual-write are missed. Dual-write-first guarantees the only gap is *old* rows,
  which the backfill then fills; nothing falls through.
- **Verify.** Before switching reads, assert the new form equals the derived old
  form for all rows (`count WHERE new IS DISTINCT FROM derive(old)` = 0).

---

## 6. Deprecation signals

You can't migrate callers you haven't *told* to migrate. Signal clearly:

- **Code:** `@Deprecated` (with `forRemoval = true` in Java 9+) plus Javadoc
  pointing to the replacement. The compiler nags every caller.
- **API:** `Deprecation: true` and `Sunset: <date>` HTTP response headers
  (RFC 8594), a changelog entry, and docs marking the field/endpoint deprecated.
- **Logs/metrics:** every hit of the old path logs at WARN once (rate-limited) and
  increments a counter tagged with the caller's identity — this is *also* your
  completion signal (§7).
- **A deadline.** "Deprecated" with no removal date is ignored forever. State the
  sunset date; that's what actually moves people.

> **When NOT to over-signal:** for an internal symbol you'll migrate yourself this
> week, a TODO and a tracking ticket are enough — don't add HTTP sunset headers to
> a thing only your own service calls.

---

## 7. Detecting that migration is complete

Contract is gated on **evidence**, never a hunch. By substrate:

- **In-repo code:** find-usages / compiler = 0 references.
- **API field/endpoint:** per-caller counter for the old path drops to 0 and stays
  0 across a **full traffic cycle** — long enough to include weekly/monthly batch
  jobs, not just a quiet afternoon.
- **DB column:** new column 100% populated and continuously matching; reads have
  run on the new column without incident for a soak period.
- **Event field:** no consumer reads the old field *and* retention has expired all
  old-format messages.

Make completion *observable*. A dashboard panel "old-path calls/min, by client"
that you can point at and say "zero for 8 days" is worth more than any amount of
reasoning. Without that panel, you are guessing — and an early contract is an
outage.

---

## 8. Pitfalls

- **Contracting too early.** The classic outage. There was still one cron job, one
  mobile version, one partner. Gate on telemetry, soak, and a full cycle.
- **Dual-write drift.** Old and new diverge because logic was duplicated or writes
  weren't transactional. Funnel through one path; verify before switching reads.
- **Forgetting backfill.** Reads switch to the new column; old rows have NULL there;
  users see blanks. Always backfill (and verify) before switching reads.
- **Backfill-before-dual-write gap.** Rows written during the gap are never copied.
  Dual-write first.
- **Never contracting.** The migration "finishes" but nobody deletes the old form.
  Now you carry dual-write code and a dead column forever. Schedule the contract;
  put it on the board with the sunset date.
- **Treating a rename as one step.** `RENAME COLUMN` on a live table with code that
  expects the new name is a big-bang. Expand-contract or take downtime.

The mechanics of doing each DB step safely online (lock-free `ADD COLUMN`, batched
backfill, online schema-change tools, blue/green) belong to the
**database-migration-patterns** material; Parallel Change is the *strategy* those
tactics implement.

---

## Next

- Cross-team, multi-service contract evolution: **[senior.md](senior.md)**.
- Renaming params as a base refactoring:
  [Simplifying Method Calls — Middle](../../02-refactoring-techniques/05-simplifying-method-calls/middle.md).
