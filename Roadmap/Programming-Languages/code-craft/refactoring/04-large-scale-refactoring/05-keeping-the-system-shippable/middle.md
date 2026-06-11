# Keeping the System Shippable — Middle

> **Source:** Jez Humble & David Farley, *Continuous Delivery*; Martin Fowler, "FeatureToggle" & "ContinuousIntegration"

You learned the one rule in [junior.md](junior.md): **every commit on trunk stays shippable; a large refactoring is a sequence of small, behavior-preserving, individually shippable steps.** This file gives you the working machinery — the flag taxonomy and its lifecycle, dark launching, CI gates, and a repeatable method for turning one scary change into a stream of safe ones.

## 1. The flag taxonomy — four kinds, four lifecycles

"Feature flag" is one word for several very different things. Fowler's "FeatureToggle" article splits them by **how long they live** and **how fast they change**. Mixing the categories is a common source of mess, because each kind wants different treatment.

| Kind | Purpose | Lifespan | Changes how often | Owner |
|---|---|---|---|---|
| **Release toggle** | Hide in-progress work so unfinished code can ship | Days–weeks | Once (off→on), then deleted | Dev team |
| **Experiment toggle** | A/B test; route cohorts to variants for data | Weeks | Per-request, by cohort | Product / data |
| **Ops toggle** | Operational kill-switch / circuit breaker for a risky subsystem | Months–permanent | Rarely, under load | Ops / SRE |
| **Permission toggle** | Gate features by user / plan / region (entitlements) | Permanent | Per-request, by user | Product |

For *this section* — large refactoring — the flag you reach for is almost always the **release toggle**. It is the most dynamic-feeling but the *least* dynamic in intent: it should flip exactly once (off → on) and then be **removed**. The other three legitimately live a long time. The release toggle that overstays its welcome becomes flag debt.

A subtle but important rule: **decouple the decision point from the decision logic.** Don't scatter `if (env == "prod" && date > X)` checks through the code. Call one `flags.isEnabled("x")` and keep all the routing logic (percentages, cohorts, kill-switches) in the flag system. This keeps the code paths clean and makes the flag removable later.

```java
// BAD: decision logic tangled into business code, impossible to clean up.
if (!isProd() || customer.getRegion().equals("EU") || rolloutPercent() > hash(id)) { ... }

// GOOD: business code asks a yes/no question; logic lives in the flag config.
if (flags.isEnabled("new-tax-calc", customer)) { ... }
```

## 2. The release-toggle lifecycle (and where it rots)

A release toggle has a life. Knowing the stages tells you when you're done — and stops you from leaving a corpse in the codebase.

1. **Introduce** — add the flag, default **OFF** in prod. Merge latent code behind it. Trunk shippable.
2. **Internal** — turn ON for staff / test accounts only. Validate in production safely.
3. **Ramp** — 1% → 10% → 50% → 100%, watching metrics (error rate, latency, business KPIs).
4. **Full on** — 100%, flag still in code but always true. *Soak* for a week to be sure.
5. **Remove the flag** — delete the flag check and the **old** code path. This is the *contract* phase. Trunk shippable.
6. **Retire the config** — delete the flag definition from the flag system.

**Where it rots:** teams reliably do steps 1–4 and then stop. The feature is at 100%, everyone's moved on to the next thing, and steps 5–6 never happen. Now the codebase carries a dead `else` branch forever, a flag that's "always true," and a reader who can't tell whether the old path is still reachable. Multiply by every refactor and you get **flag debt**: hundreds of always-true toggles and orphaned legacy paths nobody dares delete.

> **Rule of thumb:** the ticket that *creates* a release toggle must also create the *removal* ticket, scheduled. A flag with no removal date is a leak.

## 3. Dark launching and shadowing

Sometimes you want to test a new path under **real production load** before any user sees its output. Two techniques:

- **Dark launch** — run the new code path in production but **don't use its result**. You exercise it (build the request, call the new service) to find out if it falls over under real traffic, latency, and data shapes. The user still gets the old result.
- **Shadowing (mirroring)** — run **both** old and new paths for the same request, return the **old** result to the user, and **compare** the two. Log every divergence. This is how you prove the new path is behavior-preserving *before* trusting it.

```java
public Money tax(Order order) {
    Money legacyResult = legacy.compute(order);

    if (flags.isEnabled("shadow-new-tax-calc")) {
        try {
            Money shadowResult = next.compute(order);          // run new path
            if (!shadowResult.equals(legacyResult)) {
                log.warn("tax mismatch order={} legacy={} new={}",
                         order.id(), legacyResult, shadowResult);  // record divergence
            }
        } catch (Exception e) {
            log.warn("shadow tax calc threw for order={}", order.id(), e);
            // swallow — shadow failures must NEVER affect the user
        }
    }
    return legacyResult;   // user always gets the proven path during shadowing
}
```

After a week of zero divergences, you have *evidence* the new path is correct, and you can flip the real flag with confidence instead of hope. The non-negotiable rule: **a shadow path must never affect the user's result or fail their request** — catch everything, return the old answer.

**When NOT to shadow:** if the new path has side effects (writes, charges, emails), naive shadowing double-fires them. You need the shadow to run in a read-only / no-op mode, or skip shadowing and rely on staged rollout instead.

## 4. CI gates — what "green build" must actually enforce

"Keep trunk green" is only as strong as what your CI checks. A CI gate is the set of automated checks a commit must pass *before* it can land on trunk. Minimum gates for shippability:

1. **Compile / build** — obvious, but it's the most common cause of red trunk when skipped locally.
2. **Unit + integration tests** — the proof of behavior preservation.
3. **Both flag states tested.** This is the one teams forget. If code is gated by a flag, your test suite must exercise the flag **OFF** path *and* the **ON** path. Otherwise the OFF default ships untested, or the new path is never run in CI until rollout.
4. **Fast feedback.** Beck's rule: the build must be *fast* (ideally under ~10 minutes) or people stop integrating frequently and batch up changes — which kills trunk-based development.

```java
@Test void price_isUnchanged_whenNewEngineFlagOff() {
    flags.set("new-pricing-engine", false);
    assertEquals(Money.of(100), service.price(cart));   // legacy behavior preserved
}
@Test void price_usesNewEngine_whenFlagOn() {
    flags.set("new-pricing-engine", true);
    assertEquals(Money.of(100), service.price(cart));   // new path matches
}
```

The CI discipline (Fowler/Beck) in three lines: **integrate at least daily; keep the build fast and green; if it goes red, fixing it is the team's #1 priority — no new work lands on a red trunk.** A red build is a stop-the-line event, not background noise.

## 5. Decomposing a big change into shippable steps

Here is the core middle-level skill: take a change that *feels* atomic ("replace the pricing engine") and chop it into commits that are each green and behavior-preserving. The procedure:

1. **Find the seam.** Identify the interface (or introduce one) between "the thing changing" and its callers — this is Branch by Abstraction. If there's no seam, *adding the seam* is your first shippable commit.
2. **Make it additive.** New implementation lives *alongside* old, chosen by a flag. Expand, never replace-in-place.
3. **Order by dependency.** Use Mikado-style thinking: what must exist before what? Each prerequisite is its own commit. Never start a step you can't finish green.
4. **One concern per commit.** Separate (a) pure structural refactors, (b) adding the new path, (c) flipping callers, (d) removing the old path. Each is its own shippable commit.
5. **Migrate callers incrementally.** Move one caller at a time; both paths work after each.
6. **Verify, then contract.** Shadow/ramp to prove correctness, then delete the old path and the flag.

Worked example — "replace `LegacyTaxCalculator` with `NewTaxCalculator`" becomes:

```
Commit 1: extract TaxCalculator interface; LegacyTaxCalculator implements it.   [green, no behavior change]
Commit 2: add NewTaxCalculator (latent — not wired in yet).                      [green, dead code, OFF]
Commit 3: add flag "new-tax-calc"; TaxService picks impl by flag (default OFF).  [green, behavior unchanged]
Commit 4: add shadow comparison logging behind a shadow flag.                    [green]
... operate: shadow a week, then ramp 1% -> 100% over days ...
Commit 5: remove flag check; TaxService uses NewTaxCalculator directly.          [green]
Commit 6: delete LegacyTaxCalculator + flag config.                             [green]
```

Six shippable commits instead of one terrifying one. You could stop and ship after *any* of them.

## 6. Pitfalls

- **Flag debt** (the big one). Always-true toggles and orphaned legacy paths. Prevention: removal ticket created with the flag; a soak window; periodic audits (covered in [professional.md](professional.md)).
- **The half-migration.** You migrate 60% of callers and lose interest. Now the code permanently supports *both* old and new, and every new caller has to choose. Half-migrations are worse than not starting — finish or revert.
- **Contract-before-migrate.** Deleting/renaming the old thing first → red trunk. (See junior §5.) Always expand first.
- **Flag sprawl.** Dozens of overlapping flags, combinatorial states nobody understands. `flagA && !flagB && flagC` is untestable. Keep flags few, independent, and short-lived.
- **Untested OFF path.** The default-OFF path ships to 100% of prod first — but if CI only tests ON, it's the *least* tested code in the riskiest position.
- **Long-lived branches sneaking back in.** "It's just a small feature branch" that lives three weeks defeats the whole discipline. Branches in hours, not weeks.

## Next

- **[senior.md](senior.md)** — coordinating large refactors across multiple teams on one trunk, flag governance, dependencies between in-flight migrations, and choosing the right granularity of shippable steps.
- Technique deep-dives: [Moving Features](../../02-refactoring-techniques/02-moving-features/junior.md), [Simplifying Conditionals](../../02-refactoring-techniques/04-simplifying-conditionals/junior.md) (flag checks are conditionals — keep them clean), and [Strategy](../../../design-patterns/03-behavioral/08-strategy/junior.md) for swapping implementations behind a flag.
