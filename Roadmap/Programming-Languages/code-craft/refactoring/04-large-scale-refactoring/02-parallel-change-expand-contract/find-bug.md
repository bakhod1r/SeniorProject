# Parallel Change (Expand / Contract) — Find the Bug

> **Source:** Danilo Sato, "ParallelChange"; Martin Fowler, martinfowler.com/bliki/ParallelChange.html

Seven migrations that *looked* like Parallel Change but went wrong. For each:
read the scenario, diagnose the phase that was violated, then read the fix.

---

## Bug 1 — Contracted too early

**Scenario.** Team renamed an API field `accountNo` → `accountId`. They added the new
field, waited two days, saw no errors in the dashboard, dropped `accountNo`. On the
first of the month, the billing batch job (runs monthly) failed: it still read
`accountNo`.

```text
Day 0  expand: response has both accountNo + accountId
Day 2  "looks quiet" → contract: remove accountNo
Day 30 monthly billing job: KeyError accountNo → outage
```

<details><summary>Diagnosis & fix</summary>

**Diagnosis.** Contract was gated on a too-short observation window. The old-path
metric was zero for two days because the only remaining caller runs *monthly*. Two
days does not cover a full traffic cycle.

**Fix.** Gate Contract on the old-path counter being zero across a **full traffic
cycle** — here, more than a month to capture the monthly job. Better, tag the counter
by caller so you'd have *seen* the billing service still reading `accountNo`. And add
a consumer-driven contract check so the pipeline blocks contract while billing's
contract still references the old field.
</details>

---

## Bug 2 — Dual-write drift from duplicated logic

**Scenario.** Migrating `name` → `full_name`. Dual-write was added — but in *three*
different write paths, each computing the value independently. One path (admin edit)
forgot to also write `full_name`. After switching reads to `full_name`, admin-edited
users showed stale names.

```java
// path A (signup) — writes both
update("UPDATE users SET name=?, full_name=? ...", n, n, id);
// path C (admin edit) — writes only the old column  <-- BUG
update("UPDATE users SET name=? WHERE id=?", n, id);
```

<details><summary>Diagnosis & fix</summary>

**Diagnosis.** Dual-write was scattered across call sites instead of funneled through
one path, so one site missed the new column. The columns drifted; switching reads
exposed it.

**Fix.** Funnel *all* writes through a single repository/DAO method that writes both
columns in one transaction. Add a **drift metric**
(`count WHERE full_name IS DISTINCT FROM name`) and *gate the read-switch on drift =
0*. Both would have caught this before users saw stale data. Backfill/re-derive the
corrupted rows, then re-verify.
</details>

---

## Bug 3 — Forgot to backfill

**Scenario.** Added `full_name`, enabled dual-write, immediately switched reads to
`full_name` the same afternoon. New signups looked fine; every pre-existing user
suddenly displayed a blank name.

<details><summary>Diagnosis & fix</summary>

**Diagnosis.** Reads were switched before backfilling. Dual-write only populates
`full_name` for rows written *after* it was enabled; all older rows still have
`full_name = NULL`. Reading the new column returns NULL for them.

**Fix.** The ordering is non-negotiable: **dual-write → backfill old rows → verify →
switch reads.** Run the batched backfill (`WHERE full_name IS NULL`), verify
`count WHERE full_name IS DISTINCT FROM name = 0`, *then* switch reads (ramped). Roll
back the read-switch now (old column still correct), backfill, verify, re-switch.
</details>

---

## Bug 4 — Backfill ran before dual-write (the gap)

**Scenario.** Engineer backfilled `full_name = name` for all rows first (table was
quiet at 2am), then deployed the dual-write change an hour later. A handful of users
who updated their name in that hour ended up with an old `full_name`.

```text
02:00  backfill: full_name := name  (snapshot of "now")
02:00–03:00  some users change name → only `name` updated
03:00  deploy dual-write
result: those users' full_name is stale
```

<details><summary>Diagnosis & fix</summary>

**Diagnosis.** Backfill-before-dual-write leaves a gap: writes that land between the
backfill and the dual-write deploy update only the old column, and nothing ever
re-copies them. The backfill captured a stale snapshot.

**Fix.** Always enable **dual-write first, then backfill.** That way the only
un-migrated rows are ones written *before* dual-write, which the backfill
(`WHERE full_name IS NULL`) then fills — and the verify query (`new ≠ old`) catches
any stragglers. Re-run backfill/verify to repair the drifted rows.
</details>

---

## Bug 5 — "Expand" wasn't additive

**Scenario.** To migrate from a `double` discount to a `Discount` object, the engineer
*changed* the existing method's body to interpret its `double` argument differently
("now it's a fraction, not a percent") in the "expand" commit, planning to fix callers
next. Existing callers passing `15` (meaning 15%) now got a 1500% discount.

<details><summary>Diagnosis & fix</summary>

**Diagnosis.** This wasn't Expand at all — Expand must be strictly *additive* and must
not change the *meaning* of the old form. Redefining the old method's semantics broke
every existing caller instantly: it was a big-bang wearing an "expand" label.

**Fix.** Leave the old method's behavior exactly as-is. **Add** a new method with the
new contract alongside it (and have old delegate to new under a converting shim).
Migrate callers to the new method. Contract removes the old one. The old form's
observable behavior never changes until it's deleted.
</details>

---

## Bug 6 — Contracted an event format before retention drained

**Scenario.** Topic with 7-day retention; field renamed `cust` → `customerId`. All
consumers upgraded within 2 days; the team dropped `cust` from the producer on day 3.
On day 4 a consumer's instance crashed and rejoined, replaying messages from day 1 —
which still had only `cust` — and broke.

<details><summary>Diagnosis & fix</summary>

**Diagnosis.** Consumers were *capable* of reading `customerId`, but old-format
messages (with only `cust`) still sat in the topic within the 7-day retention. A
rebalance/replay re-delivered them. Contract was gated on consumer upgrade but not on
*retention drain*.

**Fix.** Keep consumers reading both (fallback to `cust`) and **do not contract the
producer until at least one full retention period has elapsed since the last
`cust`-bearing message** — or until you've reprocessed/compacted the backlog. An event
format's parallel window has a hard floor of one retention period beyond the last old
produce.
</details>

---

## Bug 7 — Stopped dual-writing the moment reads switched

**Scenario.** During a column migration, the same deploy that switched reads to
`full_name` also removed the write to `name` ("we don't need it anymore"). Hours later
the new read path showed a bug; they tried to roll back the deploy — but `name` had
been stale since the switch, so rolling back served wrong data.

<details><summary>Diagnosis & fix</summary>

**Diagnosis.** The rollback target was destroyed prematurely. The entire reason to
keep dual-writing *after* switching reads is to preserve a correct old column to fall
back to. Combining "switch reads" and "stop dual-write" into one step removes the
safety net exactly when you're most likely to need it.

**Fix.** Separate the steps and gate them independently: (1) switch reads (dual-write
still on) → soak; (2) only after a stable soak, a *separate* deploy stops writing the
old column → soak again; (3) then drop. If you must roll back the read-switch, the old
column is still fresh because dual-write was still running.
</details>

---

## The recurring lesson

Every bug here is a **phase-ordering or gating violation**:

- Expand must be additive (Bug 5).
- Dual-write before backfill, single path, transactional (Bugs 2, 4).
- Backfill + verify before switching reads (Bug 3).
- Keep dual-write until a separately-gated stop step (Bug 7).
- Contract only on *evidence*: full-cycle old-path zero (Bug 1) and retention drain
  for events (Bug 6).

If you can't point at the metric that proves the phase is complete, you're not ready
to move to the next phase.
