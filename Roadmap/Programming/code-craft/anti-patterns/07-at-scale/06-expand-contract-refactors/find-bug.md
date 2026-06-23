# Expand-Contract Refactors — Find the Bug

> **Category:** [Anti-Patterns at Scale](../README.md) → **Expand-Contract Refactors**
> **Covers (collectively):** Parallel Change (expand-contract) · Backward & forward compatibility · Deprecation windows · Schema / API / event / DB evolution · Dual-write / dual-read & Tolerant Reader

---

This file is **critical-reading practice**. Each snippet below is a plausible migration step that someone shipped believing it was safe. Read it the way a reviewer who has caused an outage reads it, and answer:

> **What's broken about the sequencing? What's the concrete production symptom? How do you fix the order?**

These aren't syntax bugs — every snippet *compiles and passes its own unit tests*. The failure lives in the **ordering of separate deploys/migrations** and only appears when old and new versions run together, when a backfill is mid-flight, or when an in-flight message arrives. That's exactly what makes them dangerous: each PR looks correct in isolation.

> **How to use this file:** write your own answer *before* expanding the collapsible. The skill is seeing the missing step in the sequence, not recalling the name of the pattern.

---

## Table of Contents

1. [Drop-the-column rename in one migration](#snippet-1--drop-the-column-rename-in-one-migration)
2. [The dual-write that swallows the new write](#snippet-2--the-dual-write-that-swallows-the-new-write)
3. [Reads switched before the backfill finished](#snippet-3--reads-switched-before-the-backfill-finished)
4. [Consumer ships before producer (reversed deploy order)](#snippet-4--consumer-ships-before-producer-reversed-deploy-order)
5. [Old path removed while a monthly job still calls it](#snippet-5--old-path-removed-while-a-monthly-job-still-calls-it)
6. [The strict reader that breaks on the expand](#snippet-6--the-strict-reader-that-breaks-on-the-expand)
7. [The backfill that takes the database down](#snippet-7--the-backfill-that-takes-the-database-down)

---

## Snippet 1 — Drop-the-column rename in one migration

```sql
-- migration V37__rename_email_column.sql
-- "Renaming users.email to users.email_address. Ship it with the app PR that uses the new name."
ALTER TABLE users RENAME COLUMN email TO email_address;
```

The matching application PR changes every query from `email` to `email_address` and is deployed in the same release.

> What's broken about the sequencing? What's the concrete production symptom? How do you fix the order?

<details>
<summary>Answer</summary>

**Bug: an atomic rename across a deploy boundary — guaranteed downtime during the rolling deploy.**

A `RENAME COLUMN` is instantaneous in the database, but the **application fleet is not.** During the rolling deploy, old pods (still querying `email`) and new pods (querying `email_address`) run simultaneously against the *same* database. The migration runs once, at one instant:

- Run the migration **before** the rolling deploy finishes → old pods query `email`, which no longer exists → every request on an old pod errors.
- Run it **after** → new pods query `email_address`, which doesn't exist yet → every request on a new pod errors.

There is no instant at which both pod versions are happy. The "monolith, one DB" framing fooled the author — the database is a *separate, shared, persistent* thing, so this is a cross-boundary atomic change.

**Concrete symptom:** a window of 5xx errors (or `column does not exist`) for the duration of the rolling deploy — exactly when traffic is being shifted.

**Fix — the six-step expand-contract sequence, never an in-place rename:**
1. `ADD COLUMN email_address` (nullable).
2. Deploy code that dual-writes `email` and `email_address`.
3. Backfill `email_address` from `email` in batches.
4. Deploy code that reads `email_address` (after backfill verified complete).
5. Deploy code that stops writing `email`.
6. `DROP COLUMN email`.

Each step is one deploy/migration, individually safe, and only step 6 is irreversible. (Full sequence: [`tasks.md` Exercise 3](tasks.md#exercise-3--zero-downtime-db-column-rename--full-sequence).)

</details>

---

## Snippet 2 — The dual-write that swallows the new write

```java
// Dual-writing to the new column during a migration.
public void save(User user) {
    repository.updateEmail(user.getId(), user.getEmail());        // old column — the source of truth

    try {
        repository.updateEmailAddress(user.getId(), user.getEmail()); // new column — best effort
    } catch (Exception e) {
        log.warn("could not write email_address, will fix later", e); // swallow & continue
    }
}
```

> What's broken about the sequencing? What's the concrete production symptom? How do you fix the order?

<details>
<summary>Answer</summary>

**Bug: the dual-write is not atomic — it silently drops the new-column write on error, creating permanent, invisible data divergence.**

The old column always gets written; the new column write is wrapped in a `try/catch` that **logs and continues.** So any transient failure (deadlock, timeout, a NULL violation) leaves a row where `email` is correct and `email_address` is stale or NULL — and nothing ever notices. The whole point of dual-write is to keep the two columns *identical* so that switching reads is safe. A best-effort second write quietly defeats that guarantee.

**Concrete symptom:** after you switch reads to `email_address` (step 4), a subset of users see stale or missing emails — the exact rows whose second write failed weeks earlier. The bug surfaced long after the code that caused it shipped, and the backfill won't catch it because the row *looks* backfilled (it has a value — the old one). Worse: the `log.warn` is one line in a sea of logs, so the divergence accrues unmonitored.

**Fix:**
- Make both writes part of **the same transaction** so they commit or roll back together:
  ```java
  @Transactional
  public void save(User user) {
      repository.updateEmail(user.getId(), user.getEmail());
      repository.updateEmailAddress(user.getId(), user.getEmail()); // same tx — both or neither
  }
  ```
- If the two stores are *separate systems* (so one transaction is impossible), you cannot rely on synchronous dual-write being consistent. Use an **outbox / async reconciliation** and a **consistency check** that compares the two and alerts on divergence — then gate the read-switch on the divergence count being zero, not on "dual-write is deployed."

The reviewer's rule: **a dual-write that can partially succeed is worse than no dual-write**, because it gives false confidence that the columns are in sync.

</details>

---

## Snippet 3 — Reads switched before the backfill finished

```python
# Migration runbook, executed top to bottom in one sitting:
#   1. ALTER TABLE users ADD COLUMN email_address VARCHAR(320);   # done
#   2. deploy dual-write code                                     # done
#   3. start backfill job (40M rows, ~6 hours)                    # RUNNING...
#   4. deploy read-switch code                                    # <-- shipped now

def get_email(user_id: int) -> str:
    row = db.query_one("SELECT email_address FROM users WHERE id = %s", user_id)
    return row["email_address"]   # reads the new column
```

The engineer deployed step 4 right after kicking off step 3, "to get the migration over with before lunch."

> What's broken about the sequencing? What's the concrete production symptom? How do you fix the order?

<details>
<summary>Answer</summary>

**Bug: reads were switched to the new column while the backfill was still running — so un-backfilled rows return NULL.**

Dual-write (step 2) guarantees new/updated rows have `email_address`. But the **40M historical rows** only get a value when the backfill (step 3) reaches them, and that takes six hours. The moment step 4 ships, `get_email` reads `email_address` for *every* user — including the millions the backfill hasn't touched yet, which are still NULL.

**Concrete symptom:** a silent **data-correctness bug**, not a crash. For ~6 hours, any user whose row hasn't been backfilled gets `None` for their email — invoices sent to nobody, password resets to an empty address, `NoneType` errors downstream. It self-heals as the backfill catches up, which makes it maddening to diagnose ("it was broken, now it's fine?").

**Fix — gate the read-switch on proof of backfill completion:**
```sql
-- Step 4 is forbidden until this returns 0.
SELECT count(*) FROM users WHERE email_address IS NULL;
```
Only deploy the read-switch when that count is **0**. Because dual-write is already live, the count only ever decreases, so once it hits zero it stays zero. The runbook ordering must be: *backfill complete → verify zero NULLs → then deploy reads* — never "kick off backfill and ship reads in the same sitting."

</details>

---

## Snippet 4 — Consumer ships before producer (reversed deploy order)

```python
# OrderService (producer) — PR #812, in code review, not yet deployed.
def publish_order(order):
    emit("OrderPlaced", {"order_id": order.id, "total": order.total, "region": order.region})

# ShippingConsumer — PR #815, deployed FIRST (it was approved first).
def handle_order_placed(event):
    region = event["region"]                 # NEW required field
    rate = SHIPPING_RATES[region]            # KeyError if region missing
    ship(event["order_id"], rate)
```

`region` is a new field. The consumer PR merged and deployed Tuesday; the producer PR is still in review.

> What's broken about the sequencing? What's the concrete production symptom? How do you fix the order?

<details>
<summary>Answer</summary>

**Bug: reversed deploy order — the consumer that *requires* the new field shipped before the producer that *emits* it.**

The consumer now hard-requires `event["region"]`. But the producer that adds `region` isn't deployed — every `OrderPlaced` event in the queue still has the old shape `{order_id, total}`. So the consumer hits `KeyError: 'region'` (or `SHIPPING_RATES[None]`) on **every single event** the moment it deploys.

This is the classic invisible-in-review bug: PR #815 is *correct on its own* (it reads a field the schema "will have"), and PR #812 is correct on its own. The defect exists only in the **ordering of two separate deploys**, which neither PR shows.

**Concrete symptom:** the instant the consumer deploys, 100% of `OrderPlaced` processing fails — messages dead-letter or infinitely retry — while the producer hasn't even shipped. A total outage of the shipping pipeline caused by deploying the *reader* first.

**Fix — deploy order and tolerance:**
1. **Producer first** for a field a consumer will *require*: deploy the producer so events carry `region`, let the queue fill with new-shape events / drain old ones.
2. **Then** the consumer.
3. Better still, make the consumer **tolerant** so order is forgiving:
   ```python
   region = event.get("region", "UNKNOWN")   # default; never KeyError on old events
   rate = SHIPPING_RATES.get(region, DEFAULT_RATE)
   ```
   Then it survives whichever deploys first *and* survives old in-flight messages. The rule: **never require something no deployed writer is producing yet.**

</details>

---

## Snippet 5 — Old path removed while a monthly job still calls it

```go
// Contraction PR: "legacyExport is deprecated. grep shows no callers. Deleting it."
// Reviewer approved: "Confirmed, `rg legacyExport` returns nothing in the service repo. LGTM."

- func legacyExport(r Report) ([]byte, error) {
-     // ... 80 lines of the old CSV format ...
- }
```

`rg legacyExport` in the service repo genuinely returns zero hits. The PR merges and deploys.

> What's broken about the sequencing? What's the concrete production symptom? How do you fix the order?

<details>
<summary>Answer</summary>

**Bug: the contract step was gated on a *static* search, which doesn't see all callers — here, a separate monthly batch job.**

`rg` over *this* repo found nothing because the only remaining caller lives **elsewhere**: a month-end finance batch in a different repo that imports this service's package and calls `legacyExport` to produce the regulator's CSV. Static search in one repo can't see cross-repo callers, reflection, config-driven dispatch, or external clients. The deletion looked safe and *was* safe — until the 1st of the month.

**Concrete symptom:** nothing breaks for up to 30 days. Then the monthly finance job runs, fails to compile/link (or panics on the missing symbol), and the regulatory CSV doesn't go out — discovered at the worst possible time, with no obvious connection to a deploy three weeks earlier.

**Fix — gate contraction on runtime evidence over a full business cycle, not grep:**
1. Before deleting, instrument the old path with a **caller-tagged usage counter** (see [`tasks.md` Exercise 5](tasks.md#exercise-5--write-the-remaining-callers-gate)).
2. Watch it for at least **one full cycle of the least-frequent caller** — for a month-end job, that's >30 days of zero, not a week.
3. Search **all dependent repos**, not just the host one, and account for reflection/external clients.
4. Only when the runtime counter is flat-zero across a full cycle do you delete.

The lesson: *grep proves a caller exists; only production traffic proves one doesn't.* A monthly job is exactly the caller a daily glance will miss.

</details>

---

## Snippet 6 — The strict reader that breaks on the expand

```java
// Client SDK that calls a partner's REST API.
private static final ObjectMapper MAPPER = new ObjectMapper()
    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true); // strict

public Account parse(String json) throws IOException {
    return MAPPER.readValue(json, Account.class); // Account has id, name, balance
}
```

The partner runs a textbook **expand**: they add one new, optional field `tier` to the `Account` response — a fully backward-compatible, additive change. Your client starts throwing in production.

> What's broken about the sequencing? What's the concrete production symptom? How do you fix the order?

<details>
<summary>Answer</summary>

**Bug: a non-tolerant reader. The client fails on unknown fields, so the producer's safe additive *expand* becomes a breaking change on the consumer side.**

The producer did everything right: adding an optional field is the canonical expand step and breaks nothing *by contract*. But `FAIL_ON_UNKNOWN_PROPERTIES = true` makes the client **brittle** — it treats any field not declared on `Account` as an error. The new `tier` field, which the client doesn't even use, throws `UnrecognizedPropertyException` on every response.

**Concrete symptom:** the client starts throwing on 100% of calls the moment the partner deploys — and you can't ship a fix instantly because you don't control their rollback. An additive change that should have been a non-event becomes your outage, caused entirely by the *reader's* strictness.

**Fix — be a Tolerant Reader (Postel's law for clients):**
```java
private static final ObjectMapper MAPPER = new ObjectMapper()
    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false); // ignore unknowns
```
Read only the fields you need; ignore the rest; don't depend on field order or absence of new fields. Then the producer's expand step is invisible to you, which is the entire premise that lets contracts evolve without lockstep releases. To still catch typo'd field names, validate against a **schema/contract test in CI** — catch it at build time, not as a runtime outage.

</details>

---

## Snippet 7 — The backfill that takes the database down

```sql
-- Backfill step of an otherwise-correct expand-contract migration.
-- "Copy the old column into the new one for all existing rows."
UPDATE users SET email_address = email;   -- 40M rows, one statement
```

Dual-write was deployed first, the new column exists, and the read-switch is correctly gated on completion. The *sequence* is right. The migration is run during business hours.

> What's broken about the sequencing? What's the concrete production symptom? How do you fix the order?

<details>
<summary>Answer</summary>

**Bug: the backfill is a single unbatched `UPDATE` over 40M rows — the step is correctly *placed* but its *execution* causes the outage the whole migration was meant to avoid.**

One statement updating 40M rows:
- Holds row locks for the entire run, blocking concurrent writes to `users`.
- Generates a huge transaction (undo/redo, WAL/binlog), bloating the log and risking disk exhaustion.
- Spikes **replication lag** — read replicas fall minutes behind, so reads served from replicas go stale or time out.
- If it fails at row 39M, the whole thing rolls back and you start over.

So even with a *perfectly ordered* expand-contract, the backfill itself takes the database down — a self-inflicted outage in the one step that was supposed to be invisible.

**Concrete symptom:** during the `UPDATE`, write latency on `users` climbs, replicas lag, dependent queries time out — a partial outage lasting as long as the statement runs, with no clean way to abort midway.

**Fix — make the backfill a throttled, chunked, idempotent, resumable trickle:**
```sql
-- Loop in the app/job, advancing :lo by batch size, sleeping between batches.
UPDATE users
SET    email_address = email
WHERE  id BETWEEN :lo AND :lo + 5000
  AND  email_address IS NULL;     -- idempotent: skip already-filled rows
-- commit; sleep(200ms); check replication lag; repeat.
```
Small batches keep locks brief and the transaction log small; the sleep caps the load and lets replication catch up; `email_address IS NULL` makes it idempotent and resumable; checkpointing `:lo` lets it pick up after a crash. The backfill becomes a background trickle that no user notices — which is the point of doing zero-downtime migration at all.

</details>

---

## Summary

- Every bug here **compiles and passes its own tests** — the defect is in the *ordering of separate deploys/migrations* or in a step's *execution*, visible only when old and new run together, a backfill is mid-flight, or an old message arrives.
- **Contract too early** (Snippets 1, 5) is the recurring killer: dropping a column in the deploy, or deleting a path on grep instead of a runtime cross-repo zero-callers metric over a full business cycle.
- **Dual-write must be atomic** (Snippet 2): a best-effort second write that drops on error silently diverges the two stores and gives false confidence.
- **Reads after backfill, never during** (Snippet 3): switching early serves NULLs for un-backfilled rows — a silent, self-healing correctness bug.
- **Deploy order is load-bearing** (Snippet 4): never require a field no deployed producer emits; consumer-first for additive, producer-first for required, tolerant readers to forgive the gap.
- **Tolerant readers** (Snippet 6) make the producer's expand invisible; strict readers turn safe additive changes into outages.
- **The backfill is part of the migration's safety** (Snippet 7): batch, throttle, make idempotent and resumable, or the "zero-downtime" migration causes the downtime itself.

---

## Related Topics

- [`tasks.md`](tasks.md) — do these migrations *correctly*, with the full sequence and the remaining-callers gate.
- [`interview.md`](interview.md) — the deploy-ordering rules and "why atomic fails" in Q&A form.
- [`senior.md`](senior.md) — the codebase-scale walkthrough behind these snippets.
- [`optimize.md`](optimize.md) — the migration that's *correct* but was never finished (dual-path left on forever).
- [Strangler Fig & Seams](../05-strangler-fig-and-seams/find-bug.md) — broken incremental replacements, the macro sibling of these bugs.
- [Architecture Fitness Functions](../01-architecture-fitness-functions/find-bug.md) — making "no caller of the old path" a build-failing rule.
- [Anti-Pattern Budgets & Ratcheting](../02-anti-pattern-budgets-and-ratcheting/find-bug.md) — keeping old-path callers monotonically decreasing.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — system-level contract-evolution siblings.
