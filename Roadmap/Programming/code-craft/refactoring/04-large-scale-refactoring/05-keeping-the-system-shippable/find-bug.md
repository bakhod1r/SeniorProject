# Keeping the System Shippable — Find the Bug

> **Source:** Jez Humble & David Farley, *Continuous Delivery*; Martin Fowler, "FeatureToggle" & "ContinuousIntegration"

Each scenario is a place where **shippability was lost**. Diagnose the root cause, then fix it. The bug is never just the code — it's the *process shape* the code reveals.

---

## Scenario 1 — The long-lived branch

> "We've been on `refactor/new-billing` for three weeks. Trunk moved a lot. Today's merge has 47 conflicts and two of our integration tests fail, but we can't tell if it's our change or the merge."

**Diagnose.** Classic big-bang branch. By isolating the work for three weeks, all risk was deferred to one merge event: huge conflict surface, zero integration feedback, and a regression that can't be attributed to a single change because *everything* landed at once. Trunk was never shippable *with* this work in flight — it was shippable only because the work was hidden, which is the opposite of the discipline.

**Fix.**
1. Stop. Don't try to land 3 weeks in one merge.
2. Rebase onto trunk *now* and carve the branch into a sequence of small, independently shippable commits: extract the billing seam first (pure refactor), add the new implementation as latent code, gate it with an OFF release flag, then migrate and ramp.
3. Land those small commits onto trunk *daily* from here on — trunk-based, branches in hours.
4. The general rule that prevents this: never let a branch outlive a day. Integrate continuously; the new billing code ships dark behind a flag instead of hiding on a branch.

---

## Scenario 2 — Contract before migrate

```java
// Commit that "renames" the method:
public class PriceList {
    // public BigDecimal unitPrice(Sku sku) { ... }   <-- deleted
    public Money unitPrice(Sku sku) { ... }            // changed return type too!
}
```
> CI is red. 60 call sites don't compile. "I'll fix them all in this PR, it's fine."

**Diagnose.** The old method was deleted *and* its signature changed before any caller was migrated — contract before migrate. There is no green intermediate state; trunk is red until all 60 sites are fixed in one giant commit. Worse, the return type changed (`BigDecimal` → `Money`) *in the same step* as the rename, so a behavior-preserving rename is tangled with a real behavior change — reviewers can't separate them.

**Fix.**
```
C1  Add Money-returning method under a NEW name (unitPriceMoney) alongside
    the old BigDecimal unitPrice(). Both compile, both work.        [expand, green]
C2..Cn  Migrate call sites one batch at a time to unitPriceMoney.   [migrate, green]
Cn+1 Delete old unitPrice().                                        [contract, green]
(optional Cn+2) rename unitPriceMoney -> unitPrice via the same expand/contract dance.
```
Separate the structural change from the behavior change; expand first, contract last; never a red intermediate.

---

## Scenario 3 — The flag that never died

```java
public Dashboard render(User u) {
    if (flags.isEnabled("new-dashboard")) {
        return newDashboard.render(u);
    }
    return oldDashboard.render(u);     // <-- this branch hasn't run in production for 9 months
}
```
> The flag has been 100% on for nine months. `oldDashboard` is still in the codebase, still compiled, still has tests "passing." A new dev just spent a day adding a feature to `oldDashboard` by mistake.

**Diagnose.** Flag debt. The release toggle did its job (off→on) but was never removed, so: a dead `else` branch ships forever, `oldDashboard` is misleading live-looking code, and a developer wasted a day editing code that never executes in production. The refactor was never actually *finished* — steps 5–6 of the flag lifecycle (remove flag, remove old path) were skipped.

**Fix.**
1. Delete the flag check; call `newDashboard.render(u)` directly.
2. Delete `oldDashboard` and its tests.
3. Remove the `new-dashboard` flag config from the platform.
4. Process fix: a release toggle stuck at 100% for > N days must be surfaced as a defect (stale-flag detection / audit), and every release toggle gets a removal ticket *when it's created*. The flag's job ended 9 months ago; it's been pure liability since.

---

## Scenario 4 — Red trunk, normalized

> Team chat, any given afternoon: "`main` is red again, the `OrderTest` flakes, just ignore it." New PRs are merged on top of red. Nobody can tell if *their* change broke something because the baseline was already broken.

**Diagnose.** The most corrosive failure in this whole section: a **normalized red trunk**. Once "trunk's a bit broken, ignore it" is acceptable, *nothing* is shippable — you can't ship a hotfix, every new change inherits the breakage, and "behavior-preserving" is unverifiable because there's no green baseline to compare against. Every technique in the section (flags, parallel change, strangler) is built on trunk *actually* being green; this defeats all of them at once.

**Fix.**
1. Treat red trunk as a stop-the-line **incident**, not background noise. Fixing it is the team's #1 priority above feature work.
2. Block merges onto a red trunk mechanically (CI gate / branch protection) so it's impossible, not just discouraged.
3. Fix or quarantine the flaky `OrderTest` immediately — a flaky test that's "always red" trains the team to ignore red, which is how you got here.
4. Re-establish the norm: green is the only acceptable state of trunk. Keep the build fast so people integrate often instead of batching.

---

## Scenario 5 — The shadow that double-charged

```java
public Receipt charge(Order o) {
    Receipt legacy = legacyGateway.charge(o);          // real charge

    if (flags.isEnabled("shadow-new-gateway")) {
        Receipt shadow = newGateway.charge(o);          // <-- BUG: real charge again!
        compare(legacy, shadow);
    }
    return legacy;
}
```
> Finance reports customers in the shadow cohort were charged **twice**.

**Diagnose.** Shadowing was applied to a path with **side effects** without neutralizing them. `newGateway.charge(o)` actually moves money, so running it "in shadow" double-charges. Shadowing is only safe for *pure / read-only* comparisons; for side-effecting paths, naive mirroring causes real damage. Also note the shadow exception isn't caught — a shadow failure could break the user's real charge.

**Fix.**
```java
public Receipt charge(Order o) {
    Receipt legacy = legacyGateway.charge(o);

    if (flags.isEnabled("shadow-new-gateway")) {
        try {
            // run new gateway in a NO-OP / sandbox mode: build the request,
            // validate it, hit a sandbox endpoint — NEVER move real money.
            Receipt shadow = newGateway.previewCharge(o);   // no side effects
            compare(legacy, shadow);
        } catch (Exception e) {
            log.warn("shadow gateway failed for order={}", o.id(), e);
            // swallow: shadow must never affect the real result
        }
    }
    return legacy;
}
```
Rules restored: side-effecting paths shadow in a no-op/sandbox mode (or skip shadow and rely on staged rollout), and the shadow path must catch everything so it can never harm the user's real request.

---

## Scenario 6 — The half-migration left forever

```java
public Customer load(Id id) {
    // 60% of records migrated to the new store; 40% still in the old one.
    if (newStore.has(id)) return newStore.load(id);
    return oldStore.load(id);
}
```
> This code has looked like this for **7 months**. The migration script ran once, got to 60%, and was never finished. Every new feature now has to handle "record might be in either store."

**Diagnose.** A stalled half-migration. The system *permanently* supports two stores, every read path is conditional, and the complexity tax is paid forever by everyone. A half-migration is *worse* than not starting: not starting means one store; stopping at 60% means two stores plus routing logic indefinitely. It's also a shippability illusion — it's "shippable" only by carrying permanent dual-path debt.

**Fix.** Pick a direction and *finish*:
1. **Forward (preferred if new store is better):** complete the backfill to 100% (idempotent, batched), verify every record is in `newStore`, then delete the `oldStore` branch and `oldStore` itself.
2. **Backward (if new store was a mistake):** migrate the 60% back, delete the new path.
Either way the end state is **one** store and **no** conditional. Process fix: a migration ticket isn't done at 60% — "done" means the old path is removed. Half-migrations need an owner and a deadline, like flags.

---

## Scenario 7 — Untested OFF default ships broken to everyone

```java
public List<Item> search(Query q) {
    if (flags.isEnabled("new-search")) return newSearch.run(q);
    return oldSearch.run(q);
}
```
> All the test effort went into `newSearch`. The flag ships **OFF** by default. On deploy, every user hits `oldSearch` — which a recent refactor quietly broke, because no test exercised the OFF path. 100% of production is now broken, and the team is confused because "all the search tests pass."

**Diagnose.** The most-shipped path (OFF default → 100% of prod on day one) was the *least*-tested. CI only covered the ON branch, so a regression in `oldSearch` sailed through green CI. The flag created a false sense of safety: "tests pass" only proved the *new*, not-yet-rolled-out path worked.

**Fix.**
1. Immediately: roll the flag ON (if `newSearch` is proven) or hotfix `oldSearch`, whichever is faster to restore service.
2. Add the missing OFF-path test:
```java
@Test void search_oldPath_works_whenFlagOff() {
    flags.set("new-search", false);
    assertEquals(expected, service.search(q));   // the path that actually ships first
}
```
3. CI gate rule: any flag-gated code must test **both** states. The default-OFF path is what reaches users first — it deserves the *most* test attention, not the least.
