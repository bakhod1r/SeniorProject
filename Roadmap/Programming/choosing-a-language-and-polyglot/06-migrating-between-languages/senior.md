# Migrating Between Languages — Senior

> **What?** The risk-management discipline of migration: deciding when *not* to migrate at all, de-risking the migrations you must do, and surviving the parts the pattern diagrams hide — data and state migration, the cost of running two systems for years, and the morale and velocity drain of a multi-year migration that never quite finishes.
> **How?** Treat "don't migrate" as the default and force the migration to earn its existence. When it does, design so that value lands *incrementally* — every month produces a real, shippable improvement — rather than all-or-nothing at a cutover that may never arrive.

---

## 1. The senior default: don't

The middle level taught you *how* to migrate well. The senior level's first job is to stop most migrations before they start, because **the rewrite is rarely worth it.** Most "we need to rewrite this in $LANGUAGE" proposals are solving a problem that a rewrite is the wrong tool for:

| The stated problem | The actual fix (cheaper than migration) |
|---|---|
| "The code is an unmaintainable mess" | Refactor in place. A mess in Python is a mess in Rust too — bad design survives translation. |
| "It's too slow" | Profile it. The hot path is usually one query or one N+1, not the language. (See [`02-performance-vs-productivity-tradeoffs`](../02-performance-vs-productivity-tradeoffs/).) |
| "We want $LANGUAGE's features" | Add $LANGUAGE for *new* services at the seams; don't rewrite the working core. (See [`04-interop-and-polyglot-architectures`](../04-interop-and-polyglot-architectures/).) |
| "Nobody understands this code" | That's a documentation and onboarding gap, not a language problem. Rewriting destroys the knowledge instead of capturing it. |
| "It's old" | Age is not a defect. Working, boring, old code is an *asset*. |

The honest framing: a migration consumes enormous engineering capacity and, done perfectly, delivers *parity*. The opportunity cost — the features and fixes you didn't ship because the team was busy reproducing existing behavior — is the real price, and it's usually far higher than the messy-code pain you were trying to escape. **Fix it or wrap it before you replace it.** Replacement is the last lever, pulled only when the language *itself* is the liability — it's end-of-life, you genuinely can't hire for it, it's a standing security risk, or it's blocking the business in a way no refactor can unblock.

---

## 2. When migration *is* justified — and how to de-risk it

When the language really is the problem, the senior contribution is layering the de-risking techniques so failure is cheap and reversible. No single technique is enough; you stack them:

| Technique | What it buys you |
|---|---|
| **Strangler fig** | The migration is never all-or-nothing; you can stop at any point with a working system. |
| **Shadow / parallel run** | New code is proven against the live system on real data *before* it serves anyone. |
| **Automated diff testing** | Disagreements between old and new are found by machines continuously, not by users in incidents. |
| **Gradual rollout** | A cut-over slice ramps 1% → 10% → 50% → 100%, so a bug hits a fraction of traffic, not all of it. |
| **Instant rollback** | Any slice can revert to the old code with a config flip, in seconds, with no deploy. |

The property to aim for: **at every moment, you have a fully working system, and the cost of being wrong about any one slice is bounded and recoverable.** A migration plan that lacks a clean rollback story at every step is a big-bang wearing incremental clothing.

---

## 3. Data and state migration — the part that's actually hard

Engineers underestimate migration because they picture the *code* — and the code is usually the *easy* half. **The hard half is the data and state.** Code is stateless; you can run old and new side by side, diff them, and roll back. Data is not: it's terabytes of accumulated history, in a schema shaped by the old system's assumptions, that *cannot* simply be rolled back once transformed.

The hard problems live here:

- **Schema mismatch.** The old system stored money as a string, status as a magic integer, dates in three formats. The new model is clean. Every row has to be *transformed*, and the transformation logic *is* the migration's most bug-prone code.
- **Volume and downtime.** You can't take a week of downtime to convert a billion rows. You need online migration — dual-writing, backfilling, and reconciling while the system stays up. (See the `database-migration-patterns` discipline for expand/contract, dual-write, and backfill mechanics.)
- **Consistency during the cutover window.** While both systems are live, *who owns the truth?* Dual-writing risks divergence; a shared database risks the new clean model being polluted by old writes. Reconciliation jobs that detect and repair drift become a permanent part of the migration.
- **Irreversibility.** You can roll back code in seconds. You cannot un-transform a billion migrated rows. Data migration is where the "instant rollback" promise quietly breaks, which is exactly why it deserves the most rehearsal, the most backups, and the most paranoia.

> A useful heuristic: **when someone says "this migration is mostly done, just the data left," they are at best halfway.** Plan the data migration first, not last, because it constrains everything else.

The safe shape of an online data migration is the **expand → migrate → contract** sequence, run while the system stays live:

```
1. EXPAND    add the new schema/store alongside the old; nothing reads it yet.
2. DUAL-WRITE every write goes to BOTH old and new (new path is shadow).
3. BACKFILL  copy historical data old → new in batches, idempotently.
4. RECONCILE a job continuously diffs old vs new; repairs drift; you watch
             the divergence metric trend to zero.
5. CUTOVER   flip reads to new (gradually, with rollback to old reads).
6. CONTRACT  stop writing to old; after a soak period, delete it.
```

The reason this is hard isn't any one step — it's that steps 2–4 run *simultaneously on live data* for days or weeks, and a bug in the transform silently corrupts the new store while users keep writing. The reconcile job is your smoke detector: if old and new stop agreeing, you stop and fix *before* cutover, while the old store is still the source of truth and recovery is possible. Skipping reconciliation is how teams discover, three weeks after cutover, that 0.3% of records were transformed wrong and the original is now gone. (The `database-migration-patterns` discipline covers expand/contract and backfill in depth.)

---

A second-order trap: the new system you migrate *to* is not free of the old system's invariants. If the legacy code allowed two orders to share an ID because a 2013 bug made it possible and downstream systems quietly came to depend on it, your "clean" new model that enforces uniqueness will *break* those downstream consumers. The shadow/reconcile harness surfaces these as diffs, and each one is a negotiation: do you faithfully reproduce the legacy quirk (and carry the wart forward), or fix it and coordinate a change across every consumer? There is no default-correct answer — but discovering the quirk during reconciliation, while you can still choose, is infinitely better than discovering it post-cutover when the choice has already been made for you.

---

## 4. The two-system tax

The moment you start an incremental migration, you have made a second system real — and **you now run two systems.** For the entire duration of the migration (which is months at best, years at worst), the team pays a continuous tax:

- **Two of everything operational:** two deploy pipelines, two monitoring setups, two on-call runbooks, two sets of dependencies to patch, two places a security advisory can hit you.
- **Cognitive split:** every engineer must hold *both* mental models. "Where does this logic live now?" becomes a daily question. New hires must learn the language you're *leaving* as well as the one you're going to.
- **Doubled change cost:** any cross-cutting change (a new auth requirement, a logging standard, a compliance rule) must be applied to both systems until the old one dies.
- **The facade and ACL themselves** are extra code to build, operate, and eventually remove.

This tax is real, ongoing, and easy to omit from the business case. It is also the reason **migration duration is a first-order risk, not a detail.** A migration estimated at "12 months" that slips to "30 months" doesn't just cost 18 extra months of rewriting — it costs 18 extra months of *paying the two-system tax*, which is often the larger number.

---

## 5. Keeping velocity and morale alive

The migrations that fail rarely fail technically. They fail because they **stall** — and stalling is mostly a velocity-and-morale problem.

**Velocity.** If the migration consumes all the team's capacity, feature delivery drops to zero, the business notices, leadership loses patience, and the migration gets defunded at 60% — leaving you running *two* systems forever, the worst possible state. The defense: **the migration must coexist with feature work, not replace it.** A common allocation is a steady fraction of capacity (e.g., 20–30%) on migration and the rest on the roadmap, so the business keeps moving and the migration keeps creeping forward.

**Morale.** Multi-year migrations are demoralizing in a specific way: the work is invisible (you ship "no new features, just the same thing in Go"), it's long, and the finish line keeps receding. Engineers burn out reproducing behavior they didn't get to design. The defense is the same property that de-risks the project technically — **incremental value delivery.** Each migrated slice should ship a *real, visible* win the team can point to: this endpoint is now 5× faster, this service now deploys in 30 seconds instead of 20 minutes, this page no longer pages us at night.

> This is the deepest senior insight in the whole topic: **a migration that delivers value incrementally is fundamentally different from one that delivers value only at the end.** The former survives leadership changes, re-prioritization, and burnout, because at every checkpoint it has *already* paid for itself and can be stopped without loss. The latter is a multi-year bet that pays out only if it reaches a finish line that recedes every quarter — and most don't.

---

## 6. Knowing when to stop

A senior also has to recognize the migration that *should* be killed mid-flight, because sunk cost is the gravity that keeps doomed migrations alive. Signals that it's time to stop (and either finish-by-cutting-losses or abandon):

- The diff rate on critical paths *isn't* converging to zero — the new system can't faithfully reproduce the old, suggesting the requirements were never really understood.
- The two-system tax now exceeds the pain that justified the migration.
- Re-prioritization means the migration will never get enough capacity to finish — better to settle into a stable hybrid than to limp at 70% forever.
- The original justification evaporated (the "dying" language got a new lease on life; the team you couldn't hire for, you now can).

Stopping is not failure; **stopping a migration that no longer pays is the same discipline as not starting one that never would.** The incremental approach is what makes stopping *possible* — you stop with a working system. A big-bang has no stop button before the cliff.

---

## 7. Quick rules

- [ ] Default to **don't migrate**: refactor or wrap first; replace only when the *language itself* is the liability.
- [ ] **Stack** the de-risking techniques (strangler + shadow + diff + gradual rollout + instant rollback); none alone is enough.
- [ ] Plan the **data migration first** — it's the hard, irreversible half, and it constrains everything.
- [ ] Budget for the **two-system tax** explicitly; migration *duration* is a first-order cost, not a detail.
- [ ] **Never let migration consume all capacity** — protect feature velocity or the migration gets defunded mid-flight.
- [ ] Make every slice deliver **visible incremental value**; that's what defends both morale and funding.
- [ ] Be willing to **stop** — a stalled incremental migration still leaves a working system; abandon before sunk cost traps you.

---

## 8. What's next

| Topic | File |
|---|---|
| The business case to leadership, multi-team programs, deprecation, case studies | `professional.md` |
| Interview questions from "Python→Go" to "1M-line Perl monolith" | `interview.md` |
| Design a strangler plan, build a kill case, sequence a cutover | `tasks.md` |
| Related: hiring/maintenance economics that drive migrations | [`07-total-cost-of-ownership-and-team-skills`](../07-total-cost-of-ownership-and-team-skills/) |
| Related: the lock-in and longevity risks that justify them | [`08-language-longevity-and-lock-in-risk`](../08-language-longevity-and-lock-in-risk/) |

---

**Memorize this:** the senior default is *don't migrate* — fix or wrap first, because a perfect rewrite only buys parity. When you must, stack every de-risking lever, plan the irreversible data migration first, budget the two-system tax, and protect feature velocity so the project never stalls. The decisive property is incremental value delivery: a migration that pays off every month can stop at any time with a working system; one that pays off only at a receding finish line usually dies before reaching it.
