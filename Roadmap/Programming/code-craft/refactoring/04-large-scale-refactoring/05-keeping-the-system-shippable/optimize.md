# Keeping the System Shippable — Optimize

> **Source:** Jez Humble & David Farley, *Continuous Delivery*; Martin Fowler, "FeatureToggle" & "ContinuousIntegration"

Each item is a **"before" plan** for a large change — usually big-bang, sometimes over-engineered. Restructure it into a sequence of shippable steps, *or* argue that a clean freeze is the cheaper correct answer. The optimization target is not "more steps" — it's the *right* granularity for the risk.

---

## 1. The two-week rewrite branch

**Before.**
> "Create `feature/new-reporting`. Rewrite the entire reporting module. Two engineers, two weeks. Merge to `main` when done. We'll run a full regression at the end."

**Problem.** Big-bang: all risk deferred to one merge, no integration feedback, trunk drifts, regression is unattributable, and `main` can't take a clean hotfix for two weeks.

**Optimized — stream of shippable commits behind a release flag:**
```
1. Extract a ReportGenerator seam; existing code implements it.        [refactor, green]
2. Add NewReportGenerator as latent code, not wired in.                [latent, OFF, green]
3. Add release flag "new-reporting"; route by flag, default OFF.       [green]
4. Migrate report types ONE AT A TIME behind the flag (revenue report,
   then usage report, then ...). Each is its own commit.              [green per type]
5. Shadow-compare new vs old output per report type; soak.            [green]
6. Ramp the flag; then remove flag + old generator.                   [contract, green]
```
Two weeks of *integrated daily* commits instead of two weeks hidden on a branch. Note: migrate **per report type**, not all at once — finer granularity because reporting has independent sub-features.

---

## 2. Over-engineered flag for a trivial change

**Before.**
> "We need to rename the private method `calc()` to `calculateTotal()` in `Invoice`. Plan: add a feature flag `use-new-calc-name`, deploy both, ramp 1% → 100%, then remove the flag."

**Problem.** Massive over-engineering. It's a *private* method rename — atomic, zero external dependents, no runtime behavior change possible. The flag machinery, the ramp, the rollout monitoring: all pure discipline tax with **zero** risk being mitigated. This is flag sprawl in miniature.

**Optimized — just commit it.**
```
1. Rename calc() -> calculateTotal(); update the 3 internal call sites. [green]
```
One commit, done. **Argue against the machinery:** flags exist to manage *runtime risk to users during a change*. A private rename has no runtime risk and no users to ramp. Reaching for a flag here is the anti-pattern the "when NOT to" caveat warns about. Reserve flags for large, risky, shared, or user-facing changes.

---

## 3. Schema change planned as a single deploy

**Before.**
> "Drop the `full_name` column, add `first_name` + `last_name`, update the app to use them, deploy it all in one release."

**Problem.** During a rolling deploy, old and new app instances run simultaneously. The instant you drop `full_name`, old instances querying it crash — trunk/prod is unshippable mid-deploy. Worse, there's no rollback: the column is gone.

**Optimized — expand → migrate → contract on the data (each step independently deployable):**
```
1. EXPAND: add first_name, last_name columns (nullable). Deploy code that
   WRITES both full_name AND the new columns, READS full_name.        [green, reversible]
2. BACKFILL first_name/last_name for existing rows, batched, idempotent. [green]
3. Switch READS to first_name/last_name behind a flag; shadow-compare.  [green]
4. Stop WRITING full_name.                                             [green]
5. CONTRACT: drop full_name — only after a soak long enough that no
   rollback will need it.                                             [green]
```
**Key:** every step is backward-compatible so old and new app code both run against the DB during the rolling deploy. You can stop and ship after any step, and roll back without data loss until step 5.

---

## 4. Strangler done as one cut-over

**Before.**
> "We're replacing the monolith's order subsystem with a new service. Plan: build the whole new service, then on launch day flip all order traffic from the monolith to the service."

**Problem.** A single big-bang cut-over: maximum blast radius (100% of orders at once), maximum MTTD (if it breaks, *everything* order-related broke simultaneously), and the new service has never seen real production load until the moment it owns 100%.

**Optimized — strangle incrementally, route by capability behind a flag:**
```
1. Put a routing facade in front of "order operations" (Strangler seam).  [green]
2. Move ONE low-risk operation (e.g. "get order status") to the new
   service behind a flag; ramp 1% -> 100%; soak.                         [green]
3. Repeat per operation, riskiest last (e.g. "place order" last).        [green per op]
4. Dark-launch / shadow each operation under real load before trusting it.
5. When all operations are routed and soaked, remove the monolith's
   order code and the routing flags.                                     [contract, green]
```
The new service earns trust under real traffic, one capability at a time. Each step is revertible by flag. "Place order" (money path) goes last, after the cheap operations have proven the service.

---

## 5. The flag-debt graveyard

**Before.**
> A service has 31 flags. Plan for the quarter: "leave them, they're not hurting anything, we have features to ship."

**Problem.** "Not hurting anything" is wrong — every always-true release toggle is a dead branch, untested misleading code, and a trap for new developers (Scenario 3 in find-bug). 31 flags also means combinatorial states nobody can reason about. This is accumulated flag debt being declared "not debt."

**Optimized — triage by kind and pay it down on a cadence:**
```
1. Inventory all 31 by kind: release / experiment / ops / permission.
2. Release toggles at 100% > N days -> DELETE flag + old path. (most of them)
3. Experiment toggles -> confirm an expiry date; remove when test concludes.
4. Ops/permission toggles -> KEEP (legitimately long-lived); test the kill-switches.
5. Stalled partial rollouts (e.g. stuck at 40%) -> assign owner, finish or revert.
6. Set up stale-flag detection + a recurring cleanup rotation so debt can't
   re-accumulate silently.
```
**Don't** blanket-delete: ops and permission toggles are *supposed* to live long. The optimization is *triage by kind*, then remove the genuine debt and *prevent* re-accumulation. Removing the old code paths also shrinks and de-risks the codebase — this is real engineering work, not housekeeping.

---

## 6. Freeze that should have been a flag

**Before.**
> "To migrate the auth service to the new token format, we'll take a 4-hour maintenance window on Saturday night, freeze trunk, swap the format, and bring it back up."

**Problem.** Auth is high-traffic and critical. A 4-hour hard window means downtime for users, a single risky cut-over with no incremental validation, and if the new format is wrong you discover it with 100% of users locked out and a panicked rollback under pressure. The "freeze" here trades a small discipline tax for a large outage + blast-radius risk — bad trade for a critical path.

**Optimized — additive token format, zero downtime, gradual:**
```
1. Deploy auth that ISSUES old-format tokens but ACCEPTS both old and new.  [expand, green]
2. Switch issuance to new-format behind a flag; old tokens still accepted
   (existing sessions keep working). Ramp issuance 1% -> 100%.            [green]
3. Wait out the old-token TTL so no valid old-format tokens remain.        [green]
4. CONTRACT: stop accepting old-format tokens; remove that code.           [green]
```
No maintenance window, no downtime, instant flag rollback at every step. **For a critical, high-traffic path, the freeze was the *wrong* call** — the flag machinery is cheap relative to a 4-hour auth outage. (Contrast Scenario 7 below, where a freeze *is* right.)

---

## 7. Machinery that should have been a freeze

**Before.**
> An internal admin tool, single team, ~5 users, deploys roughly monthly. Plan to change its CSV export column order: "Build a feature flag `new-csv-order`, set up a canary cohort, shadow-compare old vs new exports, ramp over two weeks, then remove the flag."

**Problem.** This is the *opposite* error from Scenario 6 — over-applying the machinery. 5 internal users, monthly deploys, no revenue path, single-team-owned: there is almost no runtime risk to mitigate and no meaningful blast radius. Canary cohorts and two-week ramps for 5 users is pure discipline tax with no payoff — and the flag itself becomes future debt.

**Optimized — argue for the freeze / direct change:**
```
1. Tell the 5 users "CSV column order changes Tuesday."
2. Make the change in one backward-considerate commit (keep it green).
3. Ship it on the normal monthly deploy. No flag, no canary, no ramp.
```
**The argument:** the shippability *machinery* (flags, canary, shadow, governance) is risk reduction priced in engineering time. When risk × blast radius is tiny and the audience is 5 known internal users, the cheapest correct answer is a quick heads-up and a direct change. Knowing when *not* to deploy the machinery is as much a part of this discipline as the machinery itself.
