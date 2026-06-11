# Parallel Change (Expand / Contract) — Junior

> **Source:** Danilo Sato, "ParallelChange"; Martin Fowler, martinfowler.com/bliki/ParallelChange.html

## Table of Contents

1. [The problem: you can't change everything at once](#1-the-problem-you-cant-change-everything-at-once)
2. [The idea in one sentence](#2-the-idea-in-one-sentence)
3. [A real-world analogy: changing a lock while people still need the door](#3-a-real-world-analogy-changing-a-lock-while-people-still-need-the-door)
4. [The three phases](#4-the-three-phases)
5. [Worked example 1: changing a method signature](#5-worked-example-1-changing-a-method-signature)
6. [Worked example 2: renaming a database column](#6-worked-example-2-renaming-a-database-column)
7. [How do you know the migration is done?](#7-how-do-you-know-the-migration-is-done)
8. [When NOT to use Parallel Change](#8-when-not-to-use-parallel-change)
9. [How it relates to its siblings](#9-how-it-relates-to-its-siblings)
10. [Glossary](#10-glossary)
11. [Review questions](#11-review-questions)
12. [Next](#next)

---

## 1. The problem: you can't change everything at once

You wrote a method. Other code calls it. Now you need to change it — a better
name, a better parameter, a better return type. The naive move is:

1. Edit the method.
2. Watch every caller break.
3. Fix all the callers in the same commit.

For a tiny project that fits in your head, fine. But the moment the thing you're
changing has **callers you don't control in the same change** — other teams,
other services, other deploys, rows of data already written to a database, events
already sitting in a queue, mobile apps already installed on phones — the
"change it everywhere at once" move becomes impossible or dangerous:

- You can't atomically redeploy 12 services at the exact same millisecond.
- You can't reach into 40 million existing database rows during a single `ALTER`.
- You can't force every mobile user to upgrade today.
- A big-bang change has nowhere to roll back to — the old form is already gone.

**Parallel Change** is the disciplined answer. Instead of one risky cut-over, you
make the change in three small, safe steps, and during the middle step *both the
old and new forms work at the same time*.

---

## 2. The idea in one sentence

> To change something that has callers, **first add the new form next to the old
> one (Expand), then move every caller over (Migrate), then remove the old form
> (Contract)** — never leaving the system in a state where it can't run.

The "parallel" in the name is the key: for a while, the old and new versions
**coexist**. That overlap window is what buys you safety. It is also sometimes
called **expand-and-contract** or **expand / migrate / contract**.

---

## 3. A real-world analogy: changing a lock while people still need the door

Imagine you manage an office and you want to replace the door's old lock (and its
old keys) with a new keypad.

The reckless way: rip out the old lock at 9am Monday. Now everyone with an old key
is locked out, standing in the hallway, while you fumble with a screwdriver. If
the keypad doesn't work, there's no lock at all.

The Parallel Change way:

1. **Expand** — Install the keypad *next to* the existing lock. Both open the
   door now. Nobody is locked out; old keys still work.
2. **Migrate** — Over a week, hand out keypad codes and tell people to start
   using them. Watch the old lock: is anyone still turning a key?
3. **Contract** — Once nobody has used a physical key for several days, remove the
   old lock and collect the keys.

At no point is the door un-openable. And if the keypad fails on day 2, the old
lock is still there to fall back on. That fallback is the whole point.

---

## 4. The three phases

Memorize these three words. Everything in this topic is an application of them.

| Phase | What you do | Invariant you must keep |
|-------|-------------|-------------------------|
| **EXPAND** | Add the *new* form alongside the old. Both must work. | Old callers still work, unchanged. |
| **MIGRATE** | Move every caller (and every piece of data) onto the new form. | At every moment, the system runs. |
| **CONTRACT** | Remove the old form, now that nothing uses it. | You have proof nothing uses it. |

Two rules that beginners get wrong:

- **Expand adds; it never removes or changes.** If your "expand" commit deletes
  the old method or changes its meaning, it is not expand — it is a big-bang
  change wearing a disguise.
- **Contract only happens after you have *evidence* the old form is unused.** Not
  a hunch. Evidence — usually a metric showing zero traffic on the old path.

A way to picture it — the old and new forms as two lines over time. The old line
must never have a gap until *after* the new line is fully carrying the load:

```text
            EXPAND          MIGRATE                 CONTRACT
old form  ──────────────────────────────────────┐
                                                 └────────   (removed)
new form          ┌──────────────────────────────────────────────────►
                  └─ added here          callers/data move ─┘
                  (both work)            onto the new line
          │                              │                  │
          add new, don't                switch reads /      evidence shows
          touch old                     migrate callers     old line is idle
```

The window between the two cut points is the "parallel" part of Parallel Change.
Every safety property comes from that overlap: there is always a working line, and
until the very last step there is always a line to fall back to.

---

## 5. Worked example 1: changing a method signature

You have a `PriceCalculator` whose method takes a raw `double` for a discount.
You want it to take a richer `Discount` object instead (cleaner, type-safe,
carries a reason). Many places call the old method.

### Before

```java
public class PriceCalculator {
    // The old form. Lots of callers depend on this signature.
    public Money finalPrice(Money base, double discountPercent) {
        return base.minusPercent(discountPercent);
    }
}

// A caller somewhere:
Money total = calculator.finalPrice(cartTotal, 0.15);
```

The trap: if you just edit `finalPrice` to take a `Discount`, every call site
fails to compile this instant. In a single small repo you'd fix them all in one
commit. But suppose this is published in a shared library used by other teams, or
you simply want a low-risk, reviewable, reversible change. Use Parallel Change.

### Step-by-step (numbered, behavior-preserving)

**EXPAND**

1. Add the new method *next to* the old one. Do not touch the old one yet.

```java
public class PriceCalculator {

    // OLD form — untouched. Existing callers keep working.
    public Money finalPrice(Money base, double discountPercent) {
        return base.minusPercent(discountPercent);
    }

    // NEW form — added alongside.
    public Money finalPrice(Money base, Discount discount) {
        return base.minusPercent(discount.percent());
    }
}
```

2. (Optional but smart) Make the old method *delegate* to the new one so there is
   one real implementation and no chance the two drift apart:

```java
public Money finalPrice(Money base, double discountPercent) {
    return finalPrice(base, Discount.ofPercent(discountPercent)); // forwards to new
}
```

Now the codebase compiles, every test passes, and **both forms work**. This is a
safe place to commit and stop.

**MIGRATE**

3. Find every caller of the old method. Change them, one at a time, to use the
   new form. Each change is small and independently testable.

```java
// before
Money total = calculator.finalPrice(cartTotal, 0.15);
// after
Money total = calculator.finalPrice(cartTotal, Discount.ofPercent(0.15));
```

4. After each migrated caller (or each small batch), run the tests. If something
   breaks, you've moved one caller, not forty — the blast radius is tiny.

**CONTRACT**

5. Confirm there are *no remaining callers* of the old method. In a single
   codebase this is a compiler/search question: grep for `finalPrice(.*double)`,
   or mark the old method `@Deprecated` and let the build warn you, or use your
   IDE's "Find Usages".

6. Delete the old method.

```java
public class PriceCalculator {
    // Only the new form remains.
    public Money finalPrice(Money base, Discount discount) {
        return base.minusPercent(discount.percent());
    }
}
```

Three commits, three reviews, three points you could have stopped at safely. No
moment where the code didn't build.

> **When NOT to do this for a method:** if the method is `private`, or only called
> from inside the same module you fully control, just change the signature and fix
> the handful of callers in one commit. The parallel window is pure overhead when
> you own all the callers and the change is atomic. (See §8.)

---

## 6. Worked example 2: renaming a database column

This is where Parallel Change really earns its keep, because you **can't atomically
update millions of rows and all the code that reads them**. Say a `users` table has
a column `name` and you want to split it conceptually into `full_name` (clearer,
and you're standardizing naming). Live traffic is reading and writing this column
the whole time.

### The dangerous big-bang version (don't do this)

```sql
-- One migration. App is deployed expecting `full_name`.
ALTER TABLE users RENAME COLUMN name TO full_name;
```

Why it's dangerous: the rename and the app deploy can't happen at the same
instant. For some window, old app code queries `name` (now gone → errors) or new
app code queries `full_name` before the rename ran (doesn't exist yet → errors).
There's no rollback that doesn't lose writes. A rename is a big-bang in disguise.

### The Parallel Change version (numbered)

**EXPAND** — add the new column; make the app write *both*.

1. Add the new column. This is additive and safe; it does not touch existing data
   or existing reads.

```sql
ALTER TABLE users ADD COLUMN full_name VARCHAR(255); -- nullable, no default scan
```

2. Deploy app code that **dual-writes**: every write goes to *both* columns. Reads
   still come from the old column. This is the "expand" deploy.

```java
// Repository write path during EXPAND
void save(User u) {
    db.update(
        "UPDATE users SET name = ?, full_name = ? WHERE id = ?",
        u.getName(), u.getName(), u.getId());   // write BOTH
}

// Read path still uses the OLD column for now
String readName(long id) {
    return db.queryForString("SELECT name FROM users WHERE id = ?", id);
}
```

**MIGRATE** — backfill old rows, then switch reads.

3. **Backfill**: copy the existing data into the new column for all the *old* rows
   that were written before dual-writing started. Do it in batches so you don't
   lock the table or blow up the transaction log.

```sql
-- Backfill in chunks (pseudo-loop; real tooling does this in batches)
UPDATE users
SET full_name = name
WHERE full_name IS NULL
  AND id BETWEEN :lo AND :hi;   -- repeat over id ranges
```

4. Now `full_name` is fully populated *and* kept fresh by dual-writes. Switch the
   **read path** to the new column and deploy.

```java
String readName(long id) {
    return db.queryForString("SELECT full_name FROM users WHERE id = ?", id);
}
```

Reads now serve from `full_name`. Writes still go to both, so if you have to roll
back the read change, `name` is still correct. This is your safety net.

**CONTRACT** — stop writing the old column, then drop it.

5. Once you're confident reads are stable on `full_name` (give it time — hours to
   days), deploy code that **stops writing `name`** (single-writes `full_name`
   only).

6. Finally, after another safe window, drop the old column.

```sql
ALTER TABLE users DROP COLUMN name;
```

Count the deploys: expand (add column + dual-write) → backfill → switch reads →
stop dual-write → drop column. Each step is independently reversible until you've
dropped the column. The mechanics of doing this safely on a live database — locks,
batching, online schema-change tools — are the subject of the
**database-migration-patterns** material; Parallel Change is the *shape* those
patterns follow.

> **When NOT to do this for a column:** if the table is tiny and you can take a
> maintenance window (the app is offline anyway), a plain `RENAME` in that window
> is simpler. Parallel Change is for when you **can't stop traffic**.

---

## 7. How do you know the migration is done?

Contract is the dangerous phase: remove the old form too early and live callers
break. So you do not contract on a feeling. You contract on **evidence**.

- **For code in one repo:** the compiler and "Find Usages" are your evidence. Zero
  references → safe to delete.
- **For an API or a method behind a deprecation:** add logging or a metric that
  fires every time the old path is hit. Watch it drop to zero and *stay* there
  across a full traffic cycle (e.g. a week, to cover weekly batch jobs). Only then
  contract.

```java
public Money finalPrice(Money base, double discountPercent) {  // old form
    log.warn("DEPRECATED finalPrice(double) called from {}",
             callerInfo());     // telemetry: who still uses the old path?
    return finalPrice(base, Discount.ofPercent(discountPercent));
}
```

```sql
-- For data: prove the new column matches before you trust it.
SELECT count(*) AS mismatches
FROM users
WHERE full_name IS DISTINCT FROM name;   -- expect 0 before contracting
```

The rule: **the cost of an early contract is an outage; the cost of a late
contract is a little dead code. Always err toward late.**

### Common beginner mistakes (and the one-line fix)

| Mistake | What happens | Fix |
|---------|--------------|-----|
| Expand changes the old form's behavior | Existing callers break instantly | Expand *adds only*; never edit old semantics |
| Switch reads before backfilling | Old rows show blanks/NULLs | Backfill + verify, then switch reads |
| Backfill before turning on dual-write | Rows written in the gap stay stale | Dual-write *first*, then backfill |
| Stop dual-write the moment reads switch | No correct old form to roll back to | Keep dual-write through a soak; stop it as its own step |
| Contract on a hunch ("looks quiet") | A monthly job / old client still on old form → outage | Gate on a metric = 0 across a full cycle |

Each of these is just a violation of "old must keep working until evidence says it's
idle." If you remember that single sentence, you avoid all five.

---

## 8. When NOT to use Parallel Change

Parallel Change is not free. The middle window costs you: two code paths to keep
in sync, dual-writes that can drift, extra deploys, and a glob of temporary
"migration" code. Skip it when:

- **You control every caller and can change them atomically.** A `private` method,
  or a symbol used only inside one module/repo you fully own → just change it and
  fix the callers in one commit. An IDE rename does this safely in seconds.
- **There are no persisted artifacts and no independent deploys.** If nothing has
  already written the old form to a database, a queue, a cache, or a client app,
  there's nothing to keep alive in parallel.
- **The parallel window's cost outweighs the risk it removes.** For a trivial
  internal change, three commits plus telemetry plus a dual-write is over-engineering.
  Reserve Parallel Change for changes that cross a boundary you can't redeploy in
  one shot: data, public APIs, multiple services, installed clients.

The senior skill is recognizing *which* changes cross such a boundary. If yours
doesn't, prefer the simple direct edit.

---

## 9. How it relates to its siblings

- **Branch by Abstraction** (sibling `01`) introduces an *abstraction layer* so you
  can swap one implementation for another behind a stable interface. Parallel
  Change is the same family of idea but applied to a *signature, schema, or
  contract* rather than an implementation. They're often used together: Branch by
  Abstraction keeps the seam stable while you parallel-change what's behind it. See
  [Branch by Abstraction — Junior](../01-branch-by-abstraction/junior.md).
- **The Mikado Method** (sibling `03`) is how you *discover* the dependency tree of
  a big change before making it. See [The Mikado Method — Junior](../03-mikado-method/junior.md).
- **Strangler at the code level** (sibling `04`) grows a new implementation beside
  an old one and gradually routes traffic over — Parallel Change is the
  finer-grained move you make at each step. See
  [Strangler at Code Level — Junior](../04-strangler-at-code-level/junior.md).
- Renaming/adding parameters is also covered as a basic refactoring in
  [Simplifying Method Calls — Junior](../../02-refactoring-techniques/05-simplifying-method-calls/junior.md);
  Parallel Change is what makes those safe when callers are *outside* your reach.

---

## 10. Glossary

- **Parallel Change / expand-contract** — Changing an interface or schema in three
  phases (expand, migrate, contract) so old and new coexist during migration.
- **Expand** — Additive phase: introduce the new form without removing the old.
- **Migrate** — Move all callers and data from old form to new form.
- **Contract** — Remove the old form once nothing uses it.
- **Dual-write** — During migration, write to *both* the old and new storage so
  either can be read and you can roll back.
- **Backfill** — Populating the new form for data that already existed before the
  migration started.
- **Deprecation** — Marking the old form as "going away" (annotation, doc, header,
  log) to signal callers to move.
- **Telemetry / old-path metric** — A measurement of how much traffic still uses
  the old form; your evidence for when it's safe to contract.
- **Big-bang change** — Changing the thing and all callers in one atomic step. Fast
  but risky; the opposite of Parallel Change.

---

## 11. Review questions

1. Name the three phases in order and state what each one is allowed to do.
2. Why must the *expand* phase be purely additive?
3. In the database example, why do you keep dual-writing even after you've switched
   reads to the new column?
4. What is "backfill" and which phase does it belong to?
5. You think the old method is unused. What evidence would let you safely delete it?
6. Give two situations where you should *skip* Parallel Change and just edit directly.
7. Why is contracting *too early* worse than contracting *too late*?

---

## Next

- Apply it to APIs and schemas with real dual-write/backfill mechanics:
  **[middle.md](middle.md)**.
- See the abstraction-layer sibling: [Branch by Abstraction — Junior](../01-branch-by-abstraction/junior.md).
