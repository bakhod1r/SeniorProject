# Parallel Change (Expand / Contract) — Tasks

> **Source:** Danilo Sato, "ParallelChange"; Martin Fowler, martinfowler.com/bliki/ParallelChange.html

Eight exercises across signatures, APIs, and schemas. Try each before reading the
worked solution. For every one, state the three phases and the *gate* that lets you
move from Migrate to Contract.

---

## Task 1 — Method signature: add a parameter safely (shared library)

A published library method `sendEmail(String to, String body)` must become
`sendEmail(String to, String subject, String body)`. External teams call it.

Produce the expand/migrate/contract plan with code.

<details><summary>Worked solution</summary>

**EXPAND** — add the new overload; old delegates to it with a default subject.

```java
// NEW form, added alongside
public void sendEmail(String to, String subject, String body) {
    transport.send(to, subject, body);
}

// OLD form — untouched signature, now delegates
@Deprecated(forRemoval = true)   // signal callers
public void sendEmail(String to, String body) {
    sendEmail(to, "(no subject)", body);   // one real implementation
}
```

**MIGRATE** — callers move to the 3-arg form; the `@Deprecated` build warning is the
per-caller signal. Add a WARN log/counter on the old method if callers are out of
repo.

**CONTRACT** — gate: find-usages = 0 (in-repo) / old-method counter = 0 across a full
cycle (cross-repo). Then delete the 2-arg method.

*When not to:* if this were a private/internal method, just change the signature and
fix callers in one commit.
</details>

---

## Task 2 — Method signature: change the return type

`int findUserId(String email)` returns `-1` when not found. You want
`Optional<Long> findUser(String email)`. Many callers check `== -1`.

<details><summary>Worked solution</summary>

You can't change the return type in place without breaking the `== -1` callers, so
introduce a new method.

**EXPAND**

```java
// NEW
public Optional<Long> findUser(String email) {
    Long id = repo.idByEmail(email);   // null if absent
    return Optional.ofNullable(id);
}
// OLD — delegates, preserving the -1 sentinel contract
@Deprecated(forRemoval = true)
public int findUserId(String email) {
    return findUser(email).map(Long::intValue).orElse(-1);
}
```

**MIGRATE** — rewrite callers from the sentinel check to the `Optional`:

```java
// before
int id = svc.findUserId(e); if (id == -1) {...}
// after
svc.findUser(e).ifPresentOrElse(id -> {...}, () -> {...});
```

**CONTRACT** — gate: zero callers of `findUserId`. Delete it. The `int`→`long` change
also rides along safely because the new method never used the narrower type.
</details>

---

## Task 3 — REST API: split a field

A `GET /orders/{id}` response returns `"customerName": "Ada Lovelace"`. You need
`customerFirstName` / `customerLastName`. External clients consume the JSON.

<details><summary>Worked solution</summary>

**EXPAND** — additive response; both shapes present.

```json
{
  "customerName": "Ada Lovelace",
  "customerFirstName": "Ada",
  "customerLastName": "Lovelace"
}
```

Add a per-client counter on reads of `customerName` (e.g. via a field-usage probe or
by tracking clients that still parse it through support/telemetry). Add `Deprecation`
+ `Sunset` headers; document the new fields.

**MIGRATE** — clients move; burn down per-client `customerName` usage.

**CONTRACT** — gate: usage counter = 0 across a full cycle *and* past the sunset date.
Remove `customerName`.

*When not to:* if the only consumer is your own front-end deployed with the API, just
change both together.
</details>

---

## Task 4 — REST API: a genuinely breaking change

`POST /transfer` currently takes `amount` as a dollar string (`"10.50"`). You must
switch to integer minor units (`1050`) because string-dollar parsing is buggy. Same
field name, incompatible meaning — you can't keep both in one field.

<details><summary>Worked solution</summary>

Because the *same field* changes meaning, the parallel unit must be a new field or a
new version — not the old field reused.

**Option A (new field):**

- EXPAND: accept `amountMinor` (int) *and* legacy `amount` (string); normalize
  internally; prefer `amountMinor` when both present. Deprecate `amount`.
- MIGRATE: clients send `amountMinor`. Track `amount`-only requests per client.
- CONTRACT: when `amount`-only requests = 0, reject the string field.

**Option B (versioned endpoint):** ship `/v2/transfer` taking `amountMinor`; keep
`/v1/transfer`; migrate clients; sunset `/v1`. Same three phases at version grain.

Gate either way: old-shape requests = 0 across a full cycle + sunset date. The lesson:
**never silently change the meaning of an existing field** — that's a big-bang that
corrupts in-flight requests.
</details>

---

## Task 5 — DB: rename a column on a live table

`products.title` → `products.name`, large hot table, zero downtime.

<details><summary>Worked solution</summary>

```sql
-- EXPAND: additive, lock-free
ALTER TABLE products ADD COLUMN name VARCHAR(255) NULL;
```

```java
// EXPAND: dual-write through ONE dao path, one transaction; reads still on title
void save(Product p) {
    db.update("UPDATE products SET title=?, name=? WHERE id=?",
              p.getName(), p.getName(), p.getId());
}
```

```sql
-- MIGRATE: backfill in batches, idempotent
UPDATE products SET name = title
WHERE name IS NULL AND id BETWEEN :lo AND :hi;   -- loop over ranges

-- verify before switching reads
SELECT count(*) FROM products WHERE name IS DISTINCT FROM title;  -- expect 0
```

Then switch reads to `name` (ramped, flagged). **CONTRACT:** stop writing `title`,
soak, then `ALTER TABLE products DROP COLUMN title;`.

Gate to contract: `title` reads/writes = 0, drift = 0, soak elapsed, backup taken.
</details>

---

## Task 6 — DB: change a column's type/representation

`invoices.total DECIMAL(10,2)` (dollars) → `total_cents BIGINT` (minor units).

<details><summary>Worked solution</summary>

```sql
ALTER TABLE invoices ADD COLUMN total_cents BIGINT NULL;   -- EXPAND
```

Dual-write derives one from the other in *one* place so they can't drift:

```java
void save(Invoice i) {
    long cents = i.getTotal().movePointRight(2).longValueExact();
    db.update("UPDATE invoices SET total=?, total_cents=? WHERE id=?",
              i.getTotal(), cents, i.getId());
}
```

```sql
-- MIGRATE backfill + verify
UPDATE invoices SET total_cents = ROUND(total*100)
WHERE total_cents IS NULL AND id BETWEEN :lo AND :hi;
SELECT count(*) FROM invoices WHERE total_cents <> ROUND(total*100);  -- 0
```

Switch reads (ramped), stop dual-write, `DROP COLUMN total`. Gate as Task 5. Note the
exact-cents conversion (`longValueExact`) — a silent rounding bug here would diverge
the columns and is exactly what the verify query catches.
</details>

---

## Task 7 — Config key rename across environments

`feature.flags.url` → `featureFlags.endpoint`, read by a service deployed to 6
environments via separate manifests.

<details><summary>Worked solution</summary>

**EXPAND** — read new, fall back to old, log when the old key is hit:

```java
String url = cfg.get("featureFlags.endpoint")
   .orElseGet(() -> {
       log.warn("DEPRECATED config key feature.flags.url in env {}", env);
       return cfg.require("feature.flags.url");
   });
```

**MIGRATE** — update all 6 manifests to the new key. The WARN log tells you which
environments still carry the old key.

**CONTRACT** — gate: no environment logs the old key for a full deploy cycle. Remove
the fallback; optionally fail-fast if the stale old key is still present (catches
copy-paste relapses).
</details>

---

## Task 8 — Event schema: rename a field on a shared topic

Kafka topic `orders.v1`, 7-day retention, consumed by 3 teams. Rename `cust` →
`customerId`.

<details><summary>Worked solution</summary>

**EXPAND** — producer emits *both* `cust` and `customerId`; register schema as
`FULL_TRANSITIVE` so old consumers keep reading.

**MIGRATE** — each consumer reads `customerId` (fallback to `cust` for replayed
in-flight messages); per-consumer track who still reads `cust`.

**CONTRACT** — two gates, both required: (1) all consumers read `customerId` (old-field
read counter = 0), **and** (2) retention has elapsed since the last `cust`-bearing
produce — at least 7 days — so no old-format message can be replayed. Then producer
stops emitting `cust` and the schema is tightened.

The trap candidates miss: contracting after consumers upgrade but *before* the 7-day
retention drain — a replay then hits an old message with no `cust` and breaks.
</details>

---

## Self-check

For every task you should be able to say, in order: the additive Expand, the
dual-write/backfill or caller-migration in Migrate, and the *exact evidence* (counter,
find-usages, drift = 0, retention drain) that unlocks Contract. If you can't name the
gate, you don't yet have a safe plan.
