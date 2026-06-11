# Parallel Change (Expand / Contract) — Interview

> **Source:** Danilo Sato, "ParallelChange"; Martin Fowler, martinfowler.com/bliki/ParallelChange.html

Thirteen questions with model answers. Aim to *say the three phases, then the
substrate-specific mechanics, then the gate*.

---

### Q1. What is Parallel Change and what problem does it solve?

**Model answer.** A technique for changing an interface, signature, schema, or
contract that has callers, without a risky big-bang. You do it in three phases:
**Expand** (add the new form alongside the old, both working), **Migrate** (move all
callers and data to the new form), **Contract** (remove the old form). It solves the
fact that you often *can't* change the thing and all its callers atomically — callers
may be other services, other deploys, installed clients, or millions of existing
rows. The overlap window during Migrate gives you independent deployability and a
rollback target.

---

### Q2. Why must the Expand phase be strictly additive?

**Model answer.** Because the entire safety property is "old callers keep working
unchanged." If Expand removes or *changes the meaning of* the old form, existing
callers break the moment you deploy — that's a big-bang, not an expand. Expand only
ever *adds*: a new method, a new column, a new field, a new endpoint. The old form is
untouched until Contract.

---

### Q3. Walk me through changing a method's signature with Parallel Change.

**Model answer.** (1) **Expand:** add the new-signature method next to the old one;
make the old one delegate to the new so there's one implementation and no drift. Code
compiles, both work — safe to commit. (2) **Migrate:** change call sites one at a
time to the new method, running tests after each. (3) **Contract:** confirm zero
remaining callers (find-usages / `@Deprecated` build warnings) and delete the old
method. *When not to:* if the method is private or all callers are in a repo I own, I
just change it and fix callers in one commit — the parallel window is pure overhead.

---

### Q4. Walk through renaming a database column on a live, high-traffic table.

**Model answer.** Never `RENAME COLUMN` directly — the rename and the app deploy
can't be atomic, so there's a window where one side errors. Instead: (1) **Expand:**
`ADD COLUMN` (nullable, lock-free), deploy app that **dual-writes** both columns;
reads still use old. (2) **Migrate:** **backfill** the new column for pre-existing
rows in throttled, idempotent batches; verify new == old for all rows; then switch
reads to the new column (ramped, behind a flag). (3) **Contract:** stop writing the
old column, soak, then `DROP COLUMN`. Reversible at every step until the drop,
because the old column stays correct via dual-write — that's the rollback target.

---

### Q5. What is dual-write and why does it matter?

**Model answer.** During the window, every write updates *both* the old and new form,
so reads from either are correct. It matters because it's what makes the read-switch
reversible: if I flip reads to the new form and something's wrong, I can flip back —
the old form is still fresh. The key risks are drift (old and new diverge) and
atomicity (if they're in different stores you can't write both transactionally). I
mitigate by funneling all writes through one code path, writing both in one
transaction when possible, deriving new from old in one place, and running a
reconciliation/drift job. Cross-store, I use an outbox or CDC so new is derived from
authoritative-old rather than independently written.

---

### Q6. What is backfill, and does it come before or after enabling dual-write?

**Model answer.** Backfill populates the new form for data that already existed
*before* the migration. It comes **after** enabling dual-write. If you backfill
first, rows written in the gap between backfill and dual-write are missed and never
get the new value. Dual-write-first guarantees the only un-migrated rows are *old*
ones, which the backfill then fills — nothing falls through. Backfill must be
batched, throttled, idempotent (`WHERE new IS NULL`), and verified before switching
reads.

---

### Q7. How do you *know* it's safe to Contract?

**Model answer.** Evidence, never a hunch. For in-repo code: find-usages / compiler =
0 references. For an API field or deprecated path: a per-caller metric on the old
path that drops to 0 and stays 0 across a **full traffic cycle** — long enough to
include weekly/monthly batch jobs. For a DB column: new column fully populated,
drift = 0, reads stable on new through a soak. For an event field: no consumer reads
old *and* retention has aged out all old-format messages. At scale I add
consumer-driven contract tests so the pipeline mechanically refuses to contract while
any consumer still depends on the old form. The asymmetry: an early contract is an
outage; a late contract is a little dead code — always err late.

---

### Q8. Producer and consumers are different services. Who Expands and who Contracts first?

**Model answer.** It depends on direction of dependency, and getting it wrong causes
an outage even though you "did a parallel change." If consumers need to *read* a new
field, the **producer expands first** (emits both), consumers migrate, producer
contracts last. If the producer wants to *require* a new field from consumers, the
**producer expands first by accepting both present and absent** (tolerant reader),
consumers start sending it, then the producer tightens to required last. Invariant:
whoever removes support contracts *last*, only after the other side has fully
migrated.

---

### Q9. How is Parallel Change related to Branch by Abstraction?

**Model answer.** Same family, different target. Branch by Abstraction introduces a
stable *interface seam* and swaps the *implementation* behind it while callers are
untouched — good when *behavior* is changing. Parallel Change changes the *contract
or shape itself* — signature, schema, wire format. They compose: I often hold a seam
stable with Branch by Abstraction while parallel-changing the data or protocol
underneath. Both keep the system shippable at every intermediate step.

---

### Q10. When should you NOT use Parallel Change?

**Model answer.** When you own every caller and can change them atomically — a
private method or a symbol used only inside a repo I control: just change it, fix the
callers, one commit. When there's no persisted state and no independent deploy —
nothing has written the old form to a DB, queue, cache, or client, so there's nothing
to keep alive. And when the window's carrying cost (dual-write, drift jobs, dashboards,
multi-team burndown) outweighs the risk it removes — a low-traffic internal change
whose worst case is a trivially reversible blip. Parallel Change is insurance; don't
buy it where the premium exceeds the loss it covers.

---

### Q11. An event topic has 7-day retention. You renamed a field. When can you contract?

**Model answer.** Not when consumers have all upgraded — later. Contract is blocked
until **no old-format message can still be replayed**, i.e. at least one full
retention period (7 days) after the *last* old-format produce, or after you've
reprocessed/compacted the backlog. Until then, a consumer rebalancing or replaying
could hit an old-format message and break if you've already dropped the old field. An
event format's parallel window has a hard floor of one retention period beyond the
last old produce.

---

### Q12. Why switch reads to the new form *gradually* instead of all at once?

**Model answer.** Because backfill or derivation bugs are invisible until something
reads the new form, and I want to discover them at 1% blast radius, not 100%. I ramp
behind a flag — 1% → 10% → 50% → 100% — shadow-diffing new vs old at each step. If the
diff is nonzero or errors spike, I flip back to old (still authoritative via
dual-write), fix, re-verify, re-ramp. It's a canary for the read path.

---

### Q13. What's the single most common way a "parallel change" still causes an outage?

**Model answer.** Contracting too early — removing the old form while a caller still
depends on it: a forgotten cron job, an old mobile version, a partner, a replayable
old-format message. The fix is to gate Contract on *evidence* (per-caller old-path
telemetry at zero across a full cycle, plus consumer-contract checks, plus retention
drain for events) rather than on a belief that "everyone's migrated by now." The
second most common: dual-write drift from duplicated logic or non-transactional
writes, caught by a drift metric before switching reads.

---

### Q14. How do you make a long, multi-team parallel window actually end?

**Model answer.** A long window is dangerous mainly because teams accrete *new*
dependencies on the old form while it's open. So: publish a hard sunset date (a
forcing function); freeze the old form against new usage (lint that fails new calls,
`Sunset` headers, docs marking it frozen); make migration cheap with a shared client
lib / codemod / good defaults so each consuming team's cost is minutes; track a
per-consumer burndown and nudge the long tail individually; and make the new form the
default early so new work lands on it automatically. Without a forcing function, the
last 10% never migrate.

---

### Q15. Which step in a DB column migration is irreversible, and how does that shape the plan?

**Model answer.** `DROP COLUMN` (Contract) is the only irreversible step —
recovering after it is a restore-from-backup, not a rollback. Everything before it
flips with a flag or reverts a deploy because the old column stays correct. So I
structure the whole plan to put the irreversible step *last* and give it the
strictest gate: old-path reads/writes = 0, drift = 0, soak elapsed, backup taken. I
also keep dual-write on until a dedicated, separately-gated "stop dual-write" step so
the read-switch stays reversible right up to the end.
