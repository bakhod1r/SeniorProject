# Expand-Contract Refactors — Practice Tasks

> **Category:** [Anti-Patterns at Scale](../README.md) → **Expand-Contract Refactors**
> **Covers (collectively):** Parallel Change (expand-contract) · Backward & forward compatibility · Deprecation windows · Schema / API / event / DB evolution · Dual-write / dual-read & Tolerant Reader

---

These are **do-it** exercises, not recognition quizzes. Each gives you a contract that something else depends on, a starting state, acceptance criteria, and a collapsible worked solution. The skill is sequencing: getting the **expand → migrate → contract** order right so there is never a breaking instant, and gating the irreversible contract step on *evidence*.

> **How to use this file.** Plan the *sequence of deploys/migrations* yourself before opening the solution — the ordering is the answer, the code is just its expression. The reasoning under "Why this order" matters more than the diff. Refer back to [`senior.md`](senior.md) for the full walkthrough and [`interview.md`](interview.md) for the deploy-ordering rules.

---

## Table of Contents

| # | Exercise | Contract type | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Expand-contract a function signature](#exercise-1--expand-contract-a-function-signature) | Library API | Go | ★ easy |
| 2 | [Rename a config key without breaking deploys](#exercise-2--rename-a-config-key-without-breaking-deploys) | Config | Python | ★ easy |
| 3 | [Zero-downtime DB column rename — full sequence](#exercise-3--zero-downtime-db-column-rename--full-sequence) | Database | SQL + Java | ★★★ hard |
| 4 | [Evolve an event schema with old + new consumers](#exercise-4--evolve-an-event-schema-with-old--new-consumers) | Event | Python | ★★ medium |
| 5 | [Write the "remaining callers" gate](#exercise-5--write-the-remaining-callers-gate) | Process | Go + bash | ★★ medium |
| 6 | [Split a field's meaning (cents → decimal)](#exercise-6--split-a-fields-meaning-cents--decimal) | API field | Java | ★★ medium |

---

## Exercise 1 — Expand-contract a function signature

**Contract:** a function in a shared library. **Difficulty:** ★ easy

`SendInvoice` is called from a dozen places across several repos you can't change in one PR. You need it to take an optional `locale`. You **cannot** just add a parameter — that breaks every existing caller the instant it compiles.

```go
// Before — every caller passes (customer, amount).
func SendInvoice(customer Customer, amount int) error {
    body := render(customer, amount, "en-US") // locale hardcoded
    return mailer.Send(customer.Email, body)
}
```

**Acceptance criteria**
- Existing callers `SendInvoice(c, a)` keep compiling and working unchanged through the whole migration.
- New callers can specify a locale.
- After migration, there is a single signature and no dead overload.
- Name each of the three phases in your plan.

**Hint:** Go has no default parameters or overloads. Expand with a *new* function, migrate callers, contract the old one.

<details>
<summary>Solution</summary>

**Plan**
1. **Expand:** add a new function `SendInvoiceLocalized(customer, amount, locale)`. Re-implement the old `SendInvoice` to delegate to it with the default locale. Both now work; old callers are untouched.
2. **Migrate:** update callers one repo/PR at a time to call `SendInvoiceLocalized`. Mark the old one deprecated so new code doesn't pick it up.
3. **Contract:** once no caller references `SendInvoice` (verified by search across all repos + the build), delete it — or rename `SendInvoiceLocalized` back to `SendInvoice` once it's the only one.

```go
// Expand: new canonical function; old one delegates with the default.
func SendInvoiceLocalized(customer Customer, amount int, locale string) error {
    body := render(customer, amount, locale)
    return mailer.Send(customer.Email, body)
}

// Deprecated: keep working during the migrate window.
//
// Deprecated: use SendInvoiceLocalized. Removal tracked in JIRA-4821.
func SendInvoice(customer Customer, amount int) error {
    return SendInvoiceLocalized(customer, amount, "en-US")
}
```

**Why this order.** The old signature never breaks — it becomes a thin shim over the new one, so backward compatibility is free and the migrate window can be as long as it needs to be. The contract step is gated on "zero references," not on a deadline. Had you instead *changed* `SendInvoice`'s signature in place, every un-migrated caller would fail to compile the moment the library bumped — an atomic change across a boundary you don't control.

</details>

---

## Exercise 2 — Rename a config key without breaking deploys

**Contract:** a config key read by a running service. **Difficulty:** ★ easy

You want to rename the env var `DB_TIMEOUT` to `DB_TIMEOUT_MS` (the unit was ambiguous). Many environments — staging, prod, CI, every developer's `.env` — still set the old name. A rolling deploy means old and new pods run together.

```python
# Before
timeout = int(os.environ["DB_TIMEOUT"])  # KeyError if the new name is set instead
```

**Acceptance criteria**
- During migration, a pod works whether the environment sets the old key, the new key, or both.
- After all environments are updated, only the new key is read.
- The transition needs no synchronized "flip everything at once."

<details>
<summary>Solution</summary>

**Plan**
1. **Expand:** read the new key, fall back to the old key. Log a deprecation warning when only the old key is present, so you can see which environments still need updating.
2. **Migrate:** update each environment's config to set `DB_TIMEOUT_MS`. The fallback means you can do them in any order, no coordination.
3. **Contract:** once the deprecation warning has been silent everywhere for a full deploy cycle, drop the fallback and read only the new key.

```python
# Expand: tolerant of old, new, or both.
def db_timeout_ms() -> int:
    if "DB_TIMEOUT_MS" in os.environ:
        return int(os.environ["DB_TIMEOUT_MS"])
    if "DB_TIMEOUT" in os.environ:
        log.warning("DB_TIMEOUT is deprecated; set DB_TIMEOUT_MS")  # drives migration
        return int(os.environ["DB_TIMEOUT"])
    raise KeyError("set DB_TIMEOUT_MS")
```

**Why this order.** The reader becomes tolerant *first*, so changing the writers (the environments) is unordered and reversible. The deprecation warning is the **remaining-callers signal**: when it stops firing, the contract step is safe. Renaming the key in code and config simultaneously would break every pod that booted with the old env during the rollout.

</details>

---

## Exercise 3 — Zero-downtime DB column rename — full sequence

**Contract:** a DB column read and written by a live service. **Difficulty:** ★★★ hard

The `users.email` column should be `users.email_address`. The `users` table has 40M rows. The service is multi-instance behind a load balancer; deploys are rolling. **No downtime, no data loss.** Write the full sequence: every migration and every code deploy, in order, and say what gates each step.

```sql
-- Before
CREATE TABLE users (
  id            BIGINT PRIMARY KEY,
  email         VARCHAR(320) NOT NULL,
  created_at    TIMESTAMP NOT NULL
);
```

**Acceptance criteria**
- At no point does a running pod query a column that doesn't exist.
- No row ever has a populated old column and an empty new column once dual-write is live.
- Reads switch to the new column only after the backfill is provably complete.
- The old column is dropped only after nothing writes or reads it.

<details>
<summary>Solution</summary>

**The sequence — six steps, each its own deploy/migration, reversible until the last.**

**Step 1 — Expand (migration): add the new column, nullable.**
```sql
-- Nullable so the migration is a fast metadata change and existing inserts still work.
ALTER TABLE users ADD COLUMN email_address VARCHAR(320) NULL;
```
No code reads or writes it yet. Safe to deploy any time.

**Step 2 — Dual-write (code deploy): write both columns on every insert/update.**
```java
// Every mutation now keeps the two columns in sync.
user.setEmail(newEmail);
user.setEmailAddress(newEmail);   // dual-write
repository.save(user);
```
Deploy this to **all** pods. From now on, no new/updated row can be out of sync. Reads still use `email`.

**Step 3 — Backfill (batch job): copy the historical tail.**
```sql
-- Chunked, throttled, idempotent, resumable. Run in a loop over PK ranges.
UPDATE users
SET    email_address = email
WHERE  id BETWEEN :lo AND :hi
  AND  email_address IS NULL;     -- skip rows dual-write already filled
```
Run in batches of a few thousand by `id` range, sleeping between batches to protect replication lag. Track the last processed `id` so it's resumable.

**Gate before Step 4 — prove backfill is complete:**
```sql
SELECT count(*) FROM users WHERE email_address IS NULL;  -- must be 0
```
Only when this returns 0 may reads switch. (Dual-write guarantees no *new* NULLs appear after Step 2, so this count only ever decreases.)

**Step 4 — Switch reads (code deploy): read `email_address`.**
```java
String email = user.getEmailAddress();  // was getEmail()
```
Deploy to all pods. Still dual-writing, so `email` stays valid — this step is reversible.

**Step 5 — Stop writing the old column (code deploy):**
```java
user.setEmailAddress(newEmail);   // only the new column now
repository.save(user);
```
Now nothing reads or writes `email`.

**Step 6 — Contract (migration): drop the old column.**
```sql
ALTER TABLE users DROP COLUMN email;   -- irreversible; do last, gated on Steps 4–5
```

**Why this exact order.**
- **Dual-write before backfill (Step 2 before 3):** otherwise a row written between the backfill and the read-switch would have `email` set but `email_address` NULL — a gap. Dual-write-first means backfill only handles history.
- **Backfill complete before read-switch (gate before Step 4):** read early and you serve NULLs for un-backfilled rows — a silent correctness bug.
- **Stop-old-write before drop (Step 5 before 6):** drop while code still writes `email` and every write throws.
- **Every step but the last is reversible:** if Step 4 misbehaves, redeploy Step 2's code (reads `email` again) — `email` is still being maintained until Step 5. Only Step 6 destroys data, and it runs only after two deploys prove `email` is unused.

</details>

---

## Exercise 4 — Evolve an event schema with old + new consumers

**Contract:** an event on a queue, read by multiple independently-deployed consumers. **Difficulty:** ★★ medium

The `OrderPlaced` event carries `total` (a float). You're adding `currency` (it was implicitly always USD). Two consumers read this event: `BillingConsumer` and `AnalyticsConsumer`. They deploy on different schedules, and the queue may hold events serialized minutes ago by the old producer.

```python
# Old event
{"order_id": "A1", "total": 49.99}
```

**Acceptance criteria**
- An old consumer reading a new event must not crash.
- A new consumer reading an old event (no `currency`) must not crash.
- Plan the deploy order of producer and the two consumers.
- State when it's safe to make `currency` required.

<details>
<summary>Solution</summary>

**Plan**
1. **Expand consumers (tolerant readers) first:** deploy both consumers to treat `currency` as **optional with a default of `"USD"`**. They now handle old events (no field → default) and new events (field present). Order between the two consumers doesn't matter.
2. **Expand producer:** deploy the producer to emit `currency`. Now new events carry it; old in-flight events still don't — both are handled.
3. **Migrate:** let the queue drain. Wait until no event without `currency` can still be in flight (past the longest retention/replay window).
4. **Contract:** once every event in the system carries `currency`, you *may* make it required in the consumers — but only if you've also confirmed no replay of old events is possible. If events are retained/replayed, keep the default forever.

```python
# Tolerant consumer — handles old (missing) and new (present) shapes.
def handle_order_placed(event: dict):
    currency = event.get("currency", "USD")   # default = forward + backward compatible
    process(event["order_id"], event["total"], currency)
```

```python
# Producer, after consumers are tolerant.
emit("OrderPlaced", {"order_id": oid, "total": total, "currency": "USD"})
```

**Why this order.** **Consumers before producer** is the deploy-ordering rule: never emit a field no deployed reader can handle. Here the field is additive so a *brittle* old consumer would survive it — unless it's a strict decoder, which is exactly why we make the readers explicitly tolerant first. **`currency` becomes required only at the end**, and only if the log can't replay old events — otherwise an old-shaped event resurfacing crashes a "required" consumer. The `.get(..., "USD")` default is the Tolerant Reader doing both forward and backward compatibility in one line.

</details>

---

## Exercise 5 — Write the "remaining callers" gate

**Contract:** the evidence that gates the contract step. **Difficulty:** ★★ medium

You're about to delete a deprecated method `legacyPriceCalc()`. Static search across the repo shows zero references — but it's invoked via reflection from a config-driven rules engine, so grep lies. Build the **runtime gate** that proves it's truly dead before you delete it, and write the CI check that enforces it.

**Acceptance criteria**
- Every invocation of the old path is recorded with *who* called it.
- You can answer "has anything called this in the last N days?" from a dashboard, not a guess.
- A CI/process check blocks the deletion PR until the counter has been zero for a full business cycle.

<details>
<summary>Solution</summary>

**Step 1 — Instrument the old path** so production traffic, not grep, is the source of truth:

```go
var legacyPriceCalcUses = promauto.NewCounterVec(
    prometheus.CounterOpts{
        Name: "deprecated_legacy_price_calc_total",
        Help: "Calls to the deprecated legacyPriceCalc. Must reach 0 before removal.",
    },
    []string{"caller"}, // tag by caller identity, not just a bare count
)

func legacyPriceCalc(req Request) Price {
    legacyPriceCalcUses.WithLabelValues(req.CallerID).Inc() // who still calls?
    // ... existing logic ...
}
```

**Step 2 — Watch for a full business cycle.** Query the metric over the slowest caller's period — month-end batch, quarterly job, the rare error path. A day of zero proves nothing if a monthly report is the last user.

```promql
# Any non-zero series here names a caller you still have to migrate.
sum by (caller) (increase(deprecated_legacy_price_calc_total[30d])) > 0
```

**Step 3 — Gate the deletion.** A check that fails the removal PR while the path is still warm:

```bash
#!/usr/bin/env bash
# gate-removal.sh — blocks "delete legacyPriceCalc" PRs until traffic is zero.
set -euo pipefail
hits=$(promtool query instant "$PROM" \
  'sum(increase(deprecated_legacy_price_calc_total[30d]))' \
  | awk '{print $2}')
hits=${hits:-0}
if (( $(printf '%.0f' "$hits") > 0 )); then
  echo "❌ legacyPriceCalc had $hits calls in the last 30d — not safe to remove."
  exit 1
fi
echo "✅ zero calls in 30d — safe to contract."
```

**Why runtime, not static.** Static search misses reflection, dynamic dispatch, config-driven calls, external clients, and in-flight messages. The runtime counter, tagged by caller, turns "is it safe to delete?" into a dashboard query *and* tells you exactly whom to chase while it's still non-zero. The `[30d]` window must cover your least-frequent caller; widen it for anything with monthly or quarterly traffic. This is the gate that separates a clean contraction from an outage.

</details>

---

## Exercise 6 — Split a field's meaning (cents → decimal)

**Contract:** a field in a JSON API consumed by mobile + web clients. **Difficulty:** ★★ medium

The API returns `{"price": 4999}` meaning *cents*. Product wants `price` to be a decimal *dollar* amount, `49.99`. Mobile and web clients deploy on their own schedules; old app versions stay installed for months. You **cannot** change what `price` means in place.

**Acceptance criteria**
- No client ever sees `price` change meaning under it (a client expecting cents must keep getting cents).
- New clients can consume the decimal form.
- Plan the path to eventually retire the cents field.

<details>
<summary>Solution</summary>

**Plan**
1. **Expand:** add a *new* field `price_decimal` alongside the unchanged `price`. Never mutate `price`'s meaning — old clients keep reading cents.
2. **Migrate:** new and updated clients read `price_decimal`. Track `price` usage (e.g. by client version in request logs) to know who's left.
3. **Contract:** once usage of `price` drops to zero — which for installed mobile apps may be *quarters*, gated on minimum-supported-version — stop returning `price`. If you can't drop it (long-lived old clients), keep it; the win is that new clients are clean.

```java
// Expand: both fields; price keeps its old meaning forever during migration.
Map<String, Object> body = new LinkedHashMap<>();
body.put("price", priceCents);                          // legacy: cents (unchanged)
body.put("price_decimal", BigDecimal.valueOf(priceCents, 2)); // new: 49.99
return body;
```

**Why a new field, not a changed one.** Same field name with changed meaning is the worst case in event/API evolution: a consumer cannot tell whether `4999` is cents or `49.99`-rounded — there's no in-band version. A *new* field name makes old and new unambiguous and lets both coexist, which is the entire point of the expand phase. For external clients you don't control deploys, so the migrate window is measured in app-version adoption, and the contract step may be gated on dropping support for old minimum versions rather than on a date.

</details>

---

## Summary

- Every exercise is the same shape: **expand** additively so old + new coexist, **migrate** readers/writers with no coordination required, **contract** only on evidence of zero remaining users.
- **Ordering is the answer.** Tolerant reader before producer change; dual-write before backfill; reads after backfill; stop-old-write before drop.
- The **contract step is the only irreversible one** — gate it on a runtime, caller-tagged counter over a *full business cycle*, never on grep or a calendar.
- For contracts you *don't control the deploys of* (external clients, installed apps, replayable logs), the migrate window stretches to months and the contract step may never fully arrive — and that's an acceptable outcome.

---

## Related Topics

- [`senior.md`](senior.md) — the codebase-scale walkthrough these exercises drill.
- [`interview.md`](interview.md) — the deploy-ordering and zero-callers rules in Q&A form.
- [`find-bug.md`](find-bug.md) — the same migrations done *wrong*: contract-too-early, drop-on-error dual-write, reversed deploy order.
- [`optimize.md`](optimize.md) — what happens when you never run the contract step.
- [Strangler Fig & Seams](../05-strangler-fig-and-seams/tasks.md) — the macro migration these contract mechanics serve.
- [Architecture Fitness Functions](../01-architecture-fitness-functions/tasks.md) — turn the remaining-callers gate into a permanent CI rule.
- [Anti-Pattern Budgets & Ratcheting](../02-anti-pattern-budgets-and-ratcheting/tasks.md) — keep old-path callers monotonically decreasing.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — system-level contract-evolution siblings.
