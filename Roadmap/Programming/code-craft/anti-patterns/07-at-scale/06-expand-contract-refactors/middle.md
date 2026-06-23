# Expand-Contract Refactors — Middle Level

> **Category:** [Anti-Patterns at Scale](../README.md) → **Expand-Contract Refactors** — *change a contract callers depend on in two safe phases: make new and old both work (expand), migrate, then remove the old (contract) — never one atomic edit you cannot do.*
> **Covers (collectively):** Parallel Change (expand-contract) · Backward & forward compatibility · Deprecation windows · Schema / API / event / DB evolution · Dual-write / dual-read & Tolerant Reader

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Same Three Steps, Four Different Contracts](#the-same-three-steps-four-different-contracts)
4. [Contract 1: A Method Signature](#contract-1-a-method-signature)
5. [Contract 2: A Config Key](#contract-2-a-config-key)
6. [Contract 3: An Event Field](#contract-3-an-event-field)
7. [Contract 4: A Database Column](#contract-4-a-database-column)
8. [Deprecation: Marking the Old Path on Its Way Out](#deprecation-marking-the-old-path-on-its-way-out)
9. [Tolerant Reader: Compatibility from the Consumer Side](#tolerant-reader-compatibility-from-the-consumer-side)
10. [Common Mistakes](#common-mistakes)
11. [Test Yourself](#test-yourself)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Applying it to real contracts.** A method, a config key, an event field, a DB column — additive first, dual-support, then remove.

[`junior.md`](junior.md) taught the three steps — **Expand → Migrate → Contract** — on a method signature. The shape of the technique is identical for every kind of contract, but the *mechanics* of "add the new alongside the old" change depending on what you're evolving. Adding an overload is easy; making a database column dual-writable, or an event field tolerated by old consumers, takes more care.

This level walks the same three steps across the four contracts you'll actually evolve as a working engineer:

- a **method signature** (recap, now with deprecation),
- a **config key** (rename `timeout` → `timeout_ms`),
- an **event field** (rename/retype a field in a message other services consume),
- a **database column** (the canonical one — rename a column without downtime).

Two ideas carry across all four and deserve names of their own:

- **Deprecation** — during the *migrate* step you mark the old shape "still works, going away" (`@Deprecated`, a logged warning, docs) so callers know to move and you can track who hasn't.
- **Tolerant Reader** — the *consumer's* half of compatibility. A reader that ignores fields it doesn't understand and tolerates missing ones lets the *producer* expand freely without breaking the consumer.

> **The mental model:** "expand" means *add a new path while the old path still works.* Whether that's an overload, a second config key, an extra event field, or an extra DB column, the rule is the same — **never change or remove the old thing until every caller has left it.** The hard part is making the old and new genuinely coexist for the contract type you're dealing with.

---

## Prerequisites

- **Required:** Comfortable with [`junior.md`](junior.md) — the three steps and why atomic contract edits fail at scale.
- **Required:** You can write a config-driven app, emit/consume a JSON event, and run a SQL `ALTER TABLE` / `UPDATE`.
- **Helpful:** You've shipped a change that another team or service consumed, and felt the coordination cost.
- **Helpful:** Familiarity with `@Deprecated` / deprecation warnings in your language, and basic JSON (de)serialization behavior on unknown fields.
- **Helpful:** api-versioning, database-migration-patterns skills for the versioning and migration vocabulary used here.

---

## The Same Three Steps, Four Different Contracts

| Contract | "Expand" = add new alongside old | "Migrate" = move callers | "Contract" = remove old |
|---|---|---|---|
| **Method signature** | overload / optional param / new function | update call sites | delete old overload |
| **Config key** | read *both* old and new key; prefer new | switch each config file to new key | stop reading old key |
| **Event field** | emit *both* old and new field | update consumers to read new field | stop emitting old field |
| **DB column** | add new column; write *both* | backfill + switch reads to new column | drop old column |

Notice the pattern: **expand always means "write/emit both," migrate always means "move readers," contract always means "remove the old."** The risky removal is last every time. Let's do each.

---

## Contract 1: A Method Signature

A quick recap from `junior.md`, now with the deprecation marker that belongs in the *migrate* step.

```java
// EXPAND — new overload added; old one delegates and is marked deprecated.
@Deprecated  // signals "use the 3-arg version; this is going away"
public void sendEmail(String to, String subject) {
    sendEmail(to, subject, "Support");
}

public void sendEmail(String to, String subject, String fromName) {
    // real implementation
}
```

- **Expand:** both signatures compile and run.
- **Migrate:** callers move to the three-arg form; `@Deprecated` makes the compiler/IDE flag every remaining old call, giving you a to-do list.
- **Contract:** when no warnings remain, delete the two-arg overload.

The deprecation marker is what turns "migrate" from a vague hope into a *tracked* task — every old call is now a visible warning.

---

## Contract 2: A Config Key

You want to rename the config key `timeout` to `timeout_ms` (clearer units). Config files live in many repos and environments you may not control — a classic case for Expand-Contract.

### Expand — read both keys, prefer the new one

```python
def load_timeout(cfg: dict) -> int:
    # EXPAND: accept the new key, fall back to the old one.
    if "timeout_ms" in cfg:
        return cfg["timeout_ms"]
    if "timeout" in cfg:                       # old key still honored
        warnings.warn("config key 'timeout' is deprecated; use 'timeout_ms'",
                      DeprecationWarning)
        return cfg["timeout"]
    return DEFAULT_TIMEOUT_MS
```

Now a config with *either* key works. You can deploy this without touching a single config file.

### Migrate — update the config files

Update each environment's config to use `timeout_ms`. Each can move independently; both keys are honored, so there's no flag day. The deprecation warning in the logs tells you which environments still send the old key.

### Contract — stop reading the old key

Once no config emits `timeout` anymore (logs are silent), delete the fallback branch:

```python
def load_timeout(cfg: dict) -> int:
    return cfg.get("timeout_ms", DEFAULT_TIMEOUT_MS)   # old key no longer read
```

---

## Contract 3: An Event Field

Your service emits an event other services consume. You want to rename `amt` to `amount_cents` (clearer name and units). Consumers are other teams' services — you can't edit them.

### Expand — emit both fields

```json
// EXPAND: the event carries the old field AND the new field.
{
  "order_id": "A-1001",
  "amt": 4200,              // old field, still emitted
  "amount_cents": 4200      // new field, added alongside
}
```

```go
// producer emits both during the expand + migrate window
type OrderEvent struct {
    OrderID     string `json:"order_id"`
    Amt         int    `json:"amt"`          // deprecated, still written
    AmountCents int    `json:"amount_cents"` // new
}
```

Old consumers reading `amt` keep working; new consumers can read `amount_cents`. Emitting both is the event-world version of "add the new alongside the old."

### Migrate — move consumers to the new field

Each consuming team switches from `amt` to `amount_cents` whenever they next deploy. They move independently because both fields are present.

### Contract — stop emitting the old field

Once every consumer reads `amount_cents` (you'll see how to *prove* this in [`senior.md`](senior.md)), drop `amt` from the event. Note the ordering subtlety, which `senior.md` formalizes: **you must not stop emitting `amt` until every consumer has stopped reading it.**

---

## Contract 4: A Database Column

The canonical Expand-Contract case: rename a column `name` → `full_name` with no downtime. A bare `ALTER TABLE ... RENAME COLUMN` is an atomic breaking change — every query referencing `name`, in every service, breaks the instant it runs. Instead:

### Expand — add the new column, write both

```sql
-- 1. EXPAND: add the new column (nullable, no default scan — cheap).
ALTER TABLE users ADD COLUMN full_name TEXT;
```

```python
# Application now writes BOTH columns on every insert/update (dual-write).
def save_user(u):
    db.execute(
        "INSERT INTO users (id, name, full_name) VALUES (%s, %s, %s)",
        (u.id, u.display_name, u.display_name),   # write old AND new
    )
```

### Migrate — backfill, then switch reads

```sql
-- 2. Backfill existing rows so the new column has the old data.
UPDATE users SET full_name = name WHERE full_name IS NULL;
```

```python
# 3. Switch reads to the new column. (Still writing both, for safety/rollback.)
def get_user_name(id):
    return db.query_one("SELECT full_name FROM users WHERE id = %s", (id,))
```

At this point everything *reads* `full_name`, every row *has* `full_name`, and you're still writing both columns — so you can roll back to reading `name` instantly if something's wrong.

### Contract — stop writing old, then drop it

```python
# 4. Stop writing the old column (nothing reads it anymore).
def save_user(u):
    db.execute("INSERT INTO users (id, full_name) VALUES (%s, %s)",
               (u.id, u.display_name))
```

```sql
-- 5. CONTRACT: drop the old column once nothing reads or writes it.
ALTER TABLE users DROP COLUMN name;
```

This add → backfill → dual-write → switch reads → stop writing old → drop sequence is *the* reference Expand-Contract pattern. `senior.md` walks each ordering decision in detail; here, notice that it's the same three steps — the "expand" (add + dual-write) just has more moving parts because the data, not just the code, has to migrate.

---

## Deprecation: Marking the Old Path on Its Way Out

During the *migrate* step the old shape still works but shouldn't be used. **Deprecation** is how you say so — and, more usefully, how you *track who hasn't moved yet*:

| Contract | How you deprecate the old path |
|---|---|
| **Method** | `@Deprecated` (Java) / `# Deprecated` docstring / `warnings.warn(..., DeprecationWarning)` (Python) / linter rule |
| **Config key** | log a warning when the old key is read |
| **Event field** | document it as deprecated; log when a producer still writes it |
| **API endpoint** | `Deprecation` / `Sunset` HTTP headers; docs; a metric counting old-version calls |

```java
/**
 * @deprecated Use {@link #sendEmail(String, String, String)}. Removed after 2026-09.
 */
@Deprecated(since = "2.4", forRemoval = true)
public void sendEmail(String to, String subject) { ... }
```

Deprecation does two jobs: it **warns** callers to move, and (when it logs/meters usage) it **measures** how many haven't. That second job is what makes the *contract* step safe — you delete only when usage hits zero. The window between "deprecated" and "removed" is the **deprecation window**, and `senior.md` covers how long it should be and how to track it.

---

## Tolerant Reader: Compatibility from the Consumer Side

Everything above is about the *producer* expanding safely. The **Tolerant Reader** (a Postel's-Law idea, named by Fowler) is the *consumer's* contribution: a reader that doesn't break when the producer adds, reorders, or (carefully) removes fields.

A **strict** reader breaks the moment the producer changes anything:

```python
# STRICT reader — breaks if the producer adds a field, reorders, or renames.
def parse(event: dict) -> Order:
    assert set(event.keys()) == {"order_id", "amt"}    # rejects anything new!
    return Order(event["order_id"], event["amt"])
```

A **tolerant** reader takes only what it needs and ignores the rest:

```python
# TOLERANT reader — pulls out only the fields it uses; ignores unknown ones,
# tolerates a missing optional with a default.
def parse(event: dict) -> Order:
    return Order(
        order_id=event["order_id"],
        amount=event.get("amount_cents", event.get("amt", 0)),  # prefer new, fall back
    )
```

Why this matters for Expand-Contract: **if your consumers are tolerant readers, the producer's *expand* step is free** — adding `amount_cents` alongside `amt` breaks nobody, because tolerant readers ignore fields they don't recognize. A codebase full of strict readers makes every additive change a breaking change, which defeats the whole technique.

Practical tolerant-reader rules:

- Read only the fields you use; don't validate the *whole* shape.
- Ignore unknown fields (most JSON libraries do this by default — don't turn it off with "fail on unknown").
- Tolerate missing optional fields with a sensible default (this is also [defensive error handling](../../../clean-code/06-error-handling/README.md)).
- Don't depend on field *order* or on fields you don't actually consume.

---

## Common Mistakes

1. **"Expanding" by changing instead of adding.** Renaming the config key in place, or retyping the event field, is a breaking change wearing an expand costume. Expand means the old path *still works* unchanged.
2. **Dropping the old before readers have moved.** Dropping the DB column, removing the event field, or deleting the config fallback while something still reads it is the atomic break you were avoiding — now with data loss. Remove last.
3. **Strict readers everywhere.** Consumers that reject unknown fields or validate the entire payload turn every additive producer change into a breakage. Make readers tolerant so expand stays cheap.
4. **Deprecating without tracking.** A `@Deprecated` annotation nobody measures doesn't tell you when it's safe to remove. Log or meter old-path usage so "contract" is a data-driven decision, not a guess.
5. **Backfilling and dropping in the same step.** For a DB column, the data migration (backfill) and the schema removal (drop) are separate steps with reads switched in between. Collapsing them risks reading a column that's half-populated or already gone.
6. **Forgetting forward compatibility.** Old consumers will receive *new* events. They must tolerate the new fields *now* — which is why tolerant readers should be in place *before* you start emitting new fields.

---

## Test Yourself

1. For a config-key rename `timeout` → `timeout_ms`, what does each of the three steps look like, and which step lets you deploy without editing any config file?
2. You're renaming an event field `amt` → `amount_cents`. Why must you keep emitting `amt` until after consumers have migrated, rather than switching the producer first?
3. Write a tolerant reader (any language) that reads an `amount` from an event, preferring a new `amount_cents` field but falling back to an old `amt` field, and ignoring any other fields.
4. What two jobs does deprecation do during the migrate step, and why is the second one what makes the *contract* step safe?
5. In the DB column rename, why do you keep dual-writing both columns even *after* you've switched reads to the new column?
6. A teammate says "tolerant readers are just sloppy validation." Give the real reason a tolerant reader is what makes a producer's additive change safe.

<details>
<summary>Answers</summary>

1. **Expand:** read *both* `timeout_ms` and `timeout` (prefer the new), so either key works. **Migrate:** update each config file to `timeout_ms` at its own pace. **Contract:** stop reading `timeout`. The **expand** step deploys without touching any config file — the code now accepts both keys, so existing configs keep working untouched.
2. Consumers are still *reading* `amt`. If the producer stops emitting it before they've moved to `amount_cents`, those consumers suddenly get a missing field and break. The old field must outlive every reader of it: stop emitting only after the last consumer has migrated.
3. ```python
   def amount(event: dict) -> int:
       return event.get("amount_cents", event.get("amt", 0))  # ignores all other keys
   ```
4. It **warns** callers to move (annotation/log/header), and it **measures** how many still use the old path (logged/metered usage). The measurement is what makes contract safe: you delete the old shape only when measured usage reaches zero, instead of guessing.
5. For **rollback safety**. While you're still writing both, you can instantly revert reads back to the old column if the new read path has a bug — every row still has correct data in `name`. You stop dual-writing only once you're confident the new path is good, just before dropping the old column.
6. A tolerant reader takes only the fields it needs and ignores the rest, so when the producer *adds* a field (the expand step), the reader doesn't even notice — no breakage. A strict reader that validates the whole payload rejects the new field, turning a safe additive change into a break. It's not "no validation" — it's "validate what you consume, ignore what you don't."

</details>

---

## Cheat Sheet

| Contract | Expand (add new, keep old) | Migrate | Contract (remove old) |
|---|---|---|---|
| **Method** | overload / optional param; mark old `@Deprecated` | update call sites | delete old overload |
| **Config key** | read both keys, prefer new, warn on old | switch config files | stop reading old key |
| **Event field** | emit both fields | move consumers to new field | stop emitting old field |
| **DB column** | add column + dual-write | backfill, switch reads | stop writing old, drop column |

**Cross-cutting:**
- **Deprecation** = warn + *measure* old-path usage → makes "remove" a data-driven step.
- **Tolerant Reader** = consume only what you use, ignore unknown fields, default missing ones → makes the producer's *expand* free.
- **Order is always:** expand (write/emit both) → migrate (move readers) → contract (remove old). Remove last; remove only when usage is zero.

> **One rule to remember:** *Expand means "write both," migrate means "move readers," contract means "remove old" — and the consumer's tolerant reader is what makes "write both" cost nothing.*

---

## Summary

- The **three steps are identical** across contracts; only the mechanics of "add new alongside old" differ — overload (method), dual-key read (config), dual-emit (event), dual-write column (DB).
- **Method:** overload + `@Deprecated` → migrate → delete. **Config:** read both keys → switch files → stop reading old. **Event:** emit both → move consumers → stop emitting old. **DB column:** add + dual-write → backfill + switch reads → stop writing old + drop.
- **Deprecation** does two jobs — it *warns* callers and *measures* who hasn't moved; the measurement is what lets you remove the old shape safely instead of guessing.
- **Tolerant Reader** is the consumer's half: read only what you use, ignore unknown fields, default missing ones. Tolerant consumers make the producer's *expand* step break nobody — which is the precondition for the whole technique to work cheaply.
- Always remove the old shape **last**, and only when usage is **zero**; the additive expand is what keeps every intermediate state safe to deploy.
- Next: [`senior.md`](senior.md) — *coordinating expand-contract across a producer and a consumer you deploy separately: deployment ordering, deprecation windows, tracking the last remaining callers, and the full no-downtime DB column rename.*

---

## Further Reading

- **Martin Fowler — "ParallelChange"** and **"TolerantReader"** (martinfowler.com bliki) — the two ideas at the heart of this level.
- **Refactoring Databases: Evolutionary Database Design** — Scott Ambler & Pramod Sadalage (2006) — the canonical treatment of column renames and schema evolution via small, safe transformations.
- **Release It!** — Michael Nygard (2nd ed., 2018) — versioning, compatibility, and handling change across service boundaries.
- **api-versioning** and **database-migration-patterns** skills — practical deprecation and expand-contract migration playbooks.

---

## Related Topics

- [Strangler Fig & Seams](../05-strangler-fig-and-seams/senior.md) — replacing whole modules incrementally; expand-contract is the contract-level mechanic inside it.
- [Clean Code → Error Handling](../../../clean-code/06-error-handling/README.md) — tolerating missing/old fields without crashing (the tolerant-reader posture).
- [Clean Code → Abstraction & Information Hiding](../../../clean-code/22-abstraction-and-information-hiding/README.md) — small contracts are easier to evolve; leaky ones are not.
- [Abstraction Failures → Senior](../../02-design/03-abstraction-failures/senior.md) — when the field/column you're renaming was the wrong abstraction to expose at all.
- [`junior.md`](junior.md) · [`senior.md`](senior.md) · [`professional.md`](professional.md) — the technique from one method up to zero-downtime distributed rollout.
