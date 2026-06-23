# Expand-Contract Refactors — Interview Questions

> **Category:** [Anti-Patterns at Scale](../README.md) → **Expand-Contract Refactors**
> **Covers (collectively):** Parallel Change (expand-contract) · Backward & forward compatibility · Deprecation windows · Schema / API / event / DB evolution · Dual-write / dual-read & Tolerant Reader

---

## How to Use This File

30+ questions, ordered from fundamentals to staff-level judgment. Each has a **short answer** (what you'd say out loud) and, where it earns its keep, a **deeper note** (what separates a strong answer from a memorized one). Read the question, answer it yourself, then expand.

> The signal interviewers want here is not "can you recite *expand, migrate, contract*." It's whether you understand **why an atomic change is impossible once more than one deployable depends on a contract**, and can reason about deploy ordering, partial failure, and how you *prove* it's safe to remove the old path.

---

## Table of Contents

1. [Fundamentals](#fundamentals)
2. [Why Atomic Change Fails](#why-atomic-change-fails)
3. [Deploy Ordering & Compatibility](#deploy-ordering--compatibility)
4. [Databases](#databases)
5. [Events & Messaging](#events--messaging)
6. [APIs & the Tolerant Reader](#apis--the-tolerant-reader)
7. [Contracting Safely](#contracting-safely)
8. [Strategy & Judgment](#strategy--judgment)

---

## Fundamentals

### Q1. What is expand-contract, in one sentence?

**Short answer.** A way to change a contract without ever breaking it: first **expand** so the new and old forms both work, then **migrate** every reader/writer to the new form, then **contract** by removing the old form once nothing uses it.

**Deeper note.** Its other name is **Parallel Change** (Fowler). The defining property is that *at no single instant* is there a breaking change — there's always a window where both shapes are valid, and you only delete the old one after proving it's unused.

---

### Q2. Name the three phases and the one rule that governs each.

**Short answer.**
- **Expand** — add the new thing *additively*; the rule is **don't break the old thing.** Old callers must keep working unchanged.
- **Migrate** — move every producer and consumer to the new thing; the rule is **both forms stay valid the whole time.**
- **Contract** — remove the old thing; the rule is **only after you've proven zero remaining users.**

**Deeper note.** The phases are asymmetric in risk. Expand and migrate are reversible (the old path still works). Contract is the one **irreversible** step — that's why it's gated on evidence, not on a calendar.

---

### Q3. What's a "contract" in this context? Give five examples.

**Short answer.** Any interface a *separate* deployable, team, or stored record depends on. Examples: a **method/function signature** in a shared library, a **config key**, an **event schema** on a queue, a **DB column** that other services read, and a **REST/RPC field**.

**Deeper note.** The unit of pain is the **deployment boundary**. Two pieces of code that ship together in one artifact can change atomically — you just edit both and deploy. The moment the producer and consumer ship *separately* (services, a library and its users, code and a database, a producer and a queue full of in-flight messages), there is a window where versions disagree, and expand-contract is how you survive it.

---

### Q4. How does backward compatibility differ from forward compatibility?

**Short answer.** **Backward compatible** = new code can still read data/calls produced by old code. **Forward compatible** = old code can still read data/calls produced by *new* code (typically by ignoring fields it doesn't understand). Expand-contract needs **both** during the migrate window, because old and new run simultaneously and traffic flows in both directions.

**Deeper note.** Forward compatibility is the one people forget. If you deploy a new producer first and the *old* consumer chokes on the new field, you've broken forward compatibility — which is exactly why deploy ordering and the Tolerant Reader (Q22–Q24) matter.

---

### Q5. What is a deprecation window?

**Short answer.** The bounded period during the migrate phase when the old form is still supported but officially discouraged — marked deprecated, logged when used, and announced with a removal date. It exists so dependents have *time* to migrate before contract.

**Deeper note.** A deprecation window without a *removal date* and a *usage metric* is just a comment. The window's purpose is to drive the remaining-callers count to zero; if you're not measuring that count, you'll never know when the window can close.

---

## Why Atomic Change Fails

### Q6. Why can't I just rename the field everywhere in one PR and deploy it?

**Short answer.** Because the producer and consumer **don't deploy at the same instant.** During the rollout there's a moment when one side speaks the new name and the other still speaks the old one. Any single-version assumption breaks for the requests that land in that gap.

**Deeper note.** Even a "one PR, one deploy" change is not atomic in a distributed system: rolling deploys mean old and new pods run side by side for minutes; in-flight messages were serialized by the old code; cached/persisted data was written by the old code. "Atomic" only exists inside a single process's single transaction — never across a fleet.

---

### Q7. A monolith with one database, one deploy. Do I still need expand-contract?

**Short answer.** For pure in-process code (private method, internal helper) — no, change it atomically. For anything that **outlives the deploy or is read by another process** — yes: the database, the message queue, the public API, persisted config. The deploy is atomic; the *data and contracts it touches* are not.

**Deeper note.** The classic trap: "it's just a monolith" so the team renames a DB column in the same migration that ships the code. During the rolling deploy, old pods query the old column name that no longer exists → errors for every request hitting an old pod. The monolith didn't save them; the **database is a separate, shared, persistent thing.**

---

### Q8. What goes wrong if you do the *contract* step too early?

**Short answer.** You remove the old form while something still depends on it, and that something breaks — a caller you missed, an in-flight message, a row not yet backfilled, an old pod mid-deploy. Contract is the irreversible step; doing it on a guess instead of on evidence is the single most common way these migrations cause an outage.

---

## Deploy Ordering & Compatibility

### Q9. State the general deploy-ordering rule for a producer/consumer pair.

**Short answer.** **Make the reader tolerant before the writer changes.** Deploy the side that *consumes* the new form (or tolerates both) **before** the side that *produces* it. Consumer-first for new data; producer-removal-last for old data.

**Deeper note.** Concretely: to *add* a field, deploy consumers that can read it (or ignore it) first, then the producer that emits it. To *remove* a field, deploy consumers that no longer need it first, then stop the producer from emitting it. The invariant: **never emit something no deployed reader can handle, and never require something no deployed writer is producing yet.**

---

### Q10. You need to add a required field to an event. What's the deploy order?

**Short answer.**
1. **Consumers first:** deploy consumers that *tolerate* the field being absent (treat it as optional with a default) — they now handle both old and new events.
2. **Producer next:** deploy the producer that populates the field.
3. **Migrate:** drain/age out old events lacking the field.
4. **Contract:** once no event without the field can exist, make the consumer treat it as truly required.

**Deeper note.** The field is "required" only at the *end*. Treating it as required from the start is exactly the deploy-ordering bug — the consumer ships expecting a field the producer hasn't started emitting, and every in-flight old event crashes it.

---

### Q11. Why is "deploy ordering reversed" such a common production incident?

**Short answer.** Because the dependency is invisible in code review: the consumer PR and producer PR each look correct *in isolation*. The bug only exists in the *ordering* of two separate deploys, which no single PR shows. Ship the consumer-expecting-new-field before the producer-emitting-it and you break every request in the gap.

---

### Q12. How do feature flags relate to expand-contract?

**Short answer.** A flag lets you **decouple deploy from activation** — ship both code paths dark, then flip reads/writes to the new path independently of the deploy, and flip back instantly if it misbehaves. Expand-contract defines *what* the two paths are; the flag controls *when* each is live and gives you the rollback.

**Deeper note.** The flag is the cheap rollback for the migrate phase. But the flag is itself something you must contract — a permanently-on dual-path flag is debt (see [`optimize.md`](optimize.md)). Flip it, bake it, then delete the dead branch and the flag.

---

## Databases

### Q13. Give the full sequence to rename a DB column with zero downtime.

**Short answer.** You never "rename" — you add, copy, switch, drop:

1. **Expand:** add the new column `email_address`, nullable (or with a default). No reads use it yet.
2. **Dual-write:** deploy app code that writes **both** `email` and `email_address` on every insert/update.
3. **Backfill:** batch-copy existing rows' `email` → `email_address` (chunked, throttled, idempotent).
4. **Switch reads:** deploy app code that **reads** `email_address`; verify it matches.
5. **Stop writing old:** deploy app code that no longer writes `email`.
6. **Contract:** drop the `email` column once nothing references it.

**Deeper note.** Each step is a *separate deploy* that's individually safe and reversible until step 6. The ordering is load-bearing: dual-write must be live **before** backfill (or new rows written between backfill and switch are stale), and the switch-read must come **after** backfill completes (or you read NULLs).

---

### Q14. Why must dual-write be deployed *before* the backfill runs, not after?

**Short answer.** The backfill copies the rows that exist *at that moment*. Any row written *after* the backfill but *before* dual-write is live would have a populated old column and an empty new column — a gap. Dual-write-first guarantees every new write keeps both columns in sync, so backfill only has to handle the historical tail.

---

### Q15. Why read the new column only *after* the backfill completes?

**Short answer.** Until backfill finishes, the new column is NULL/stale for un-backfilled rows. Switch reads early and you serve NULLs (or wrong values) for any row the backfill hasn't reached yet — a silent data-correctness bug, not a crash.

**Deeper note.** This is the "reads switched before backfill completed" failure. The safe gate is: **backfill verified complete (count of rows with new = NULL is 0) → only then deploy the read switch.** A query, not a vibe.

---

### Q16. How do you make a backfill safe to run on a live, large table?

**Short answer.** **Batch** it (e.g. 1–5k rows per chunk by primary-key range), **throttle** between batches to protect replication lag and IO, make it **idempotent** (re-running a chunk produces the same result), make it **resumable** (track the last processed key), and **skip rows already correct** so dual-write's progress isn't redone.

**Deeper note.** A single `UPDATE huge_table SET new = old` is the anti-pattern: it locks rows, blows up the transaction log/undo, and spikes replication lag enough to cause its own outage. Chunk + throttle + checkpoint turns an outage into a background trickle.

---

### Q17. How is renaming a *table* different from renaming a column under expand-contract?

**Short answer.** Same shape — add new, dual-write, backfill, switch reads, drop old — but you typically use a **view or trigger** to keep the two in sync during migration, and the "dual-write" may live in the database (trigger) rather than the app. The principle is identical; only the sync mechanism changes.

---

### Q18. Adding a `NOT NULL` column to a big table can lock it. How does expand-contract handle that?

**Short answer.** Add it **nullable first** (cheap metadata change on modern Postgres/MySQL), backfill a value into every row in batches, then **add the `NOT NULL` constraint** once no NULLs remain (validate the constraint without a full lock where the engine supports it). You've turned one locking operation into three non-locking ones.

---

## Events & Messaging

### Q19. How do you change an event schema with both old and new consumers running?

**Short answer.** Make the change **additive and optional.** **Expand:** add the new field; producers emit both the old and new field (or the new field alongside, never instead). Old consumers ignore the new field; new consumers prefer it but fall back to the old. **Migrate** consumers one at a time. **Contract:** once every consumer reads the new field, stop emitting the old one — and only then.

**Deeper note.** The queue holds **in-flight messages serialized by older producers.** Even after every service is on the new code, the *backlog* may contain old-shaped messages. So "all code deployed" is not "safe to contract" — you must also drain or age out the old-format messages.

---

### Q20. A field changes type — `amount: integer cents` → `amount: decimal dollars`. How?

**Short answer.** Don't mutate the field — **add a new one.** Emit `amount_cents` (old) and `amount_dollars` (new, the canonical going forward) in parallel. Consumers migrate from old to new. Contract by dropping `amount_cents` once unused. Mutating the same field's type in place is a breaking change with no safe window — old and new consumers can't agree on what `amount` means.

**Deeper note.** Same field name, changed meaning, is the worst case: there's no way for a consumer to tell which version it's looking at. A *new* field name makes old/new unambiguous and lets both coexist.

---

### Q21. Events are replayed from a log (event sourcing / Kafka compaction). What extra constraint?

**Short answer.** The **old-format events live forever** in the log and will be replayed. So consumers must **permanently** tolerate every format ever written, or you must run a one-time **upcasting** step that rewrites old events to the new schema. You may never get to fully "contract" the read side — old shapes are part of the immutable history.

---

## APIs & the Tolerant Reader

### Q22. What is the Tolerant Reader pattern?

**Short answer.** Read only the fields you need and **ignore everything else** — don't fail on unknown fields, don't depend on field order, don't assume the response won't grow. A tolerant reader stays working when the producer *adds* fields, which is precisely what the expand phase does.

**Deeper note.** It's Postel's law applied to clients: *be liberal in what you accept.* A tolerant reader makes the producer's **expand** step a non-event for the consumer — additive changes simply don't break it, so producers can evolve without a coordinated client release.

---

### Q23. Give a concrete example of a *non*-tolerant reader that breaks on an additive change.

**Short answer.** A JSON deserializer configured to **fail on unknown properties** (e.g. Jackson `FAIL_ON_UNKNOWN_PROPERTIES = true`, or a strict struct decoder). The producer adds one new field — fully backward compatible — and every strict consumer throws on the next response. The expand step, which should be invisible, becomes an outage.

**Deeper note.** This is why "just add a field" sometimes *does* break clients: the contract was fine, but a brittle reader made an additive change breaking. Tolerant reading is the consumer-side enabler of expand-contract.

---

### Q24. Tolerant readers ignore unknown fields. Doesn't that hide bugs?

**Short answer.** It trades one risk for another, and the trade is usually right: you lose a typo'd-field-name signal, but you gain the ability for producers to evolve without lockstep releases across every client. Mitigate the downside with **contract tests / schema validation in CI** (catch the typo at build time) rather than by making the runtime reader brittle (which catches it as a production outage).

---

### Q25. How do you remove a field from a public REST API that external clients consume?

**Short answer.** You often *can't* contract on your own schedule — external clients you don't control are the dependents. So: **expand** (introduce the replacement field/endpoint, keep the old), **deprecate** (announce, version, add `Deprecation`/`Sunset` headers, log usage per client), **migrate** (give clients a real window — months, sometimes a major version), and **contract** only after usage drops to zero or the sunset date passes. For internal callers you control deploys, so the window is days; for external ones it's a public, dated commitment.

---

## Contracting Safely

### Q26. How do you *prove* there are no remaining callers before the contract step?

**Short answer.** Two complementary methods:
- **Static:** search the codebase / all dependent repos for references (grep, `rg`, IDE "find usages", a Semgrep rule in CI). Good for code in repos you can see.
- **Runtime:** instrument the old path to **emit a metric/log every time it's used**, then watch until the counter is **flat at zero** for a full traffic cycle (including the slowest batch jobs and least-frequent code paths).

**Deeper note.** Static search alone is insufficient — reflection, dynamic dispatch, config-driven calls, external clients, and in-flight messages don't show up in grep. The runtime "no hits" counter is the authoritative gate: code can lie about who calls it; production traffic can't.

---

### Q27. How long is "long enough" to watch the old-path counter before deleting?

**Short answer.** At least one full **business cycle** of the least-frequent caller — which is often *not* a day. Month-end reports, quarterly jobs, annual renewals, and rarely-hit error paths can be the only remaining callers. If a monthly batch is the last user, a week of zero traffic proves nothing.

---

### Q28. What instrumentation do you add to the old path during the deprecation window?

**Short answer.** A **deprecation log/metric** at every entry point of the old form — counter tagged by caller identity (service name, client ID, code location) so you know *who* still uses it, not just *that* someone does. That turns "is it safe to delete?" into a dashboard query and tells you exactly whom to chase.

---

### Q29. Should the contract step be one big PR or several?

**Short answer.** Several, in reverse order of the expand: stop *writing*/emitting the old form, confirm zero readers, then *remove* the old field/column/method, then clean up the dual-path scaffolding and the flag. Small reversible steps so that if something was missed, you find it at "stopped writing" (recoverable) rather than at "dropped the column" (data loss).

---

## Strategy & Judgment

### Q30. Expand-contract vs. Strangler Fig — what's the difference and how do they relate?

**Short answer.** **Strangler Fig** replaces a whole *component/system* incrementally — you route slices of behavior to the new implementation until the old one is dead. **Expand-contract** evolves a single *contract* (a field, a column, a signature) without breaking it. Strangler is the macro strategy; expand-contract is the micro mechanic that makes each seam in a strangler migration safe. You strangle a service by expand-contracting the contracts at its boundary.

**Deeper note.** See [`../05-strangler-fig-and-seams/senior.md`](../05-strangler-fig-and-seams/senior.md): the strangler's "branch by abstraction" seam is held together by expand-contract on the interface it abstracts. They're the same discipline at two scales.

---

### Q31. When is expand-contract *not* worth it — when should you just take the downtime?

**Short answer.** When the coordination cost dwarfs the value of zero-downtime: a tiny internal tool nobody depends on, a maintenance window you already have, a table small enough that the locking rename takes milliseconds, or a pre-launch system with no users. Expand-contract has real cost (multiple deploys, dual-path code, backfills); spend it where downtime is expensive, not reflexively.

---

### Q32. What's the most common way teams *start* expand-contract correctly but fail to finish?

**Short answer.** They expand and migrate, ship the win, and **never contract** — the dual-write, the flag, the old column, and the compatibility shim become permanent. Now every future change must keep *both* paths working forever. The migration was supposed to be temporary; without a tracked contract step it becomes load-bearing debt. (See [`optimize.md`](optimize.md).)

**Deeper note.** Make the contract step a *scheduled ticket with the removal-date and the zero-callers gate* the moment you start expanding. The discipline is treating "delete the old path" as part of the task, not as optional cleanup.

---

### Q33. How does expand-contract relate to architecture fitness functions and ratcheting?

**Short answer.** A **fitness function** can *enforce* the contract step: a CI rule that fails the build if the deprecated column/field/method is still referenced after the sunset date, or that forbids new writes to the old path. **Ratcheting** ([`../02-anti-pattern-budgets-and-ratcheting/senior.md`](../02-anti-pattern-budgets-and-ratcheting/senior.md)) keeps the count of old-path callers monotonically decreasing so the migration can't backslide. The migration is the work; the gate is what makes the cleanup actually happen.

---

## Summary

- **Expand-contract = Parallel Change:** expand (new + old both work) → migrate every reader/writer → contract (remove old), with **no breaking instant** in between.
- **Atomic change is impossible across a deploy boundary** — separate deploys, rolling fleets, in-flight messages, and persisted data guarantee old and new run together. That window is the whole problem.
- **Deploy ordering:** make the reader tolerant before the writer changes — consumer-first for new data, producer-removal-last for old.
- **DB rename = add → dual-write → backfill → switch reads → stop old write → drop.** Dual-write before backfill; switch reads after backfill; drop last.
- **Tolerant Reader** (ignore unknown fields) is what makes the expand step invisible to consumers; brittle strict readers turn additive changes into outages.
- **Contract is the only irreversible step** — gate it on a runtime *zero-callers* metric over a full business cycle, not on a calendar or a grep.
- The dominant failure isn't doing it wrong — it's **never finishing the contract**, leaving dual-paths on forever.

---

## Related Topics

- [`senior.md`](senior.md) — the full codebase-scale walkthrough this file quizzes.
- [`tasks.md`](tasks.md) — implement a signature, DB-rename, and event-schema expand-contract yourself.
- [`find-bug.md`](find-bug.md) — broken migrations: contract-too-early, dual-write that drops on error, reversed deploy order.
- [Strangler Fig & Seams](../05-strangler-fig-and-seams/senior.md) — the macro strategy expand-contract serves.
- [Architecture Fitness Functions](../01-architecture-fitness-functions/senior.md) — enforce the contract step in CI.
- [Anti-Pattern Budgets & Ratcheting](../02-anti-pattern-budgets-and-ratcheting/senior.md) — keep old-path callers monotonically decreasing.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the system-level siblings of these contract-evolution problems.
