# Keeping the System Shippable — Junior

> **Source:** Jez Humble & David Farley, *Continuous Delivery*; Martin Fowler, "FeatureToggle" & "ContinuousIntegration"

## Table of Contents

1. [The one rule that makes large refactoring safe](#1-the-one-rule)
2. [Renovate the house while you live in it](#2-renovate-the-house)
3. [What "shippable" actually means](#3-what-shippable-means)
4. [Why a big-bang branch goes wrong](#4-why-big-bang-goes-wrong)
5. [Additive change: expand before you contract](#5-additive-change)
6. [Feature flags: the basics](#6-feature-flags-basics)
7. [A feature flag, before and after](#7-flag-before-and-after)
8. [Small commits, small PRs](#8-small-commits)
9. [The four siblings are all the same idea](#9-the-four-siblings)
10. [When NOT to do this](#10-when-not-to)
11. [Glossary](#11-glossary)
12. [Review questions](#12-review-questions)
13. [Next](#next)

---

<a id="1-the-one-rule"></a>
## 1. The one rule that makes large refactoring safe

This whole section — Branch by Abstraction, Parallel Change, the Mikado Method, the Strangler — exists to obey **one rule**:

> **The main branch (trunk) is always shippable. Every commit keeps the system releasable.**

A large refactoring is not one giant change. It is a **long sequence of small, individually shippable, behavior-preserving commits**. You could ship to production after *any* of them, even when you are only halfway done.

Read that again, because it is the whole point. "Halfway through replacing the payment system" must still be a state you could ship. If "halfway" means "broken until I finish," you have lost shippability — and you have built a time bomb.

A junior instinct says: *"I'll make a branch, do the whole refactor over two weeks, then merge it."* That feels safe — your mess is hidden on a branch. It is the opposite of safe. While you work, the rest of the team keeps changing trunk, your branch rots, the merge becomes a nightmare, and on the day you merge you discover three conflicts and two bugs at once with no way to tell which change caused what.

The shippable approach feels scarier (your half-done work is on trunk!) but is dramatically safer, because every step is tiny, reviewed, and reversible.

<a id="2-renovate-the-house"></a>
## 2. Renovate the house while you live in it

Here is the mental model. You are renovating a house, but **you still live in it the whole time**. You cannot say "the house is unusable for two weeks." People need to cook, sleep, and use the bathroom every single night.

So you renovate room by room:

- You do **not** knock down all the walls on Monday and rebuild by Friday. One collapsed wall and you have no roof.
- You build the **new** bathroom *next to* the old one, get it working, switch over, *then* demolish the old one. For a few days you have two bathrooms — that is fine, even though it is "untidy."
- Every evening, the house is **livable**. Maybe a room is taped off, maybe there is a temporary wall, but you can still live there.

That "two bathrooms for a few days" is exactly what feature flags and additive change give you in code. The temporary mess is the *price* of never being homeless. In software, "homeless" means "can't ship a hotfix because trunk is broken" — and that can cost you a security patch, a revenue bug, or a 2 a.m. incident with no escape hatch.

<a id="3-what-shippable-means"></a>
## 3. What "shippable" actually means

A commit is **shippable** when all of these hold:

1. **The build is green.** It compiles and all tests pass.
2. **Behavior is preserved.** From the user's point of view, the system does what it did before (or what the flag says it should).
3. **No half-finished state is visible.** Unfinished work is either not wired in yet, or hidden behind a flag that is OFF in production.
4. **You could deploy it right now** and nothing user-facing breaks.

The key insight: **"shippable" is not the same as "feature complete."** You ship code that contains a half-built feature *all the time* — it is just turned off. The half-built payment provider can sit in production for three weeks behind an OFF flag, shipped a dozen times, touched by nobody but you, hurting nobody. That hidden, dormant code is called **latent code**.

<a id="4-why-big-bang-goes-wrong"></a>
## 4. Why a big-bang branch goes wrong

The "do it all on a long-lived branch, merge at the end" approach fails in predictable ways:

- **Merge hell.** The longer the branch lives, the more trunk drifts away from it. Merging a two-week branch can take a day and introduce subtle bugs.
- **All risk lands at once.** When you finally merge, *every* change goes live together. If something breaks, you cannot tell which of your 40 changes did it.
- **No feedback.** Nobody integrates with your work until the end, so design mistakes are discovered too late to fix cheaply.
- **You can't ship anything else cleanly.** If a hotfix is needed mid-refactor, you are stuck: do you ship from your half-done branch, or from a trunk that is about to be obsolete?

This is why **Continuous Integration (CI)** matters — and CI is a *discipline*, not just a server. Beck and Fowler define it as: **integrate your work into trunk frequently (at least daily), keep the build fast and green, and if the build goes red, fixing it is the team's top priority — drop everything.** A red trunk blocks everyone, so a red trunk is an emergency.

The rule "never let trunk go red" is non-negotiable. The moment a team accepts "trunk is a bit broken right now, it's fine," shippability is dead and every later step inherits the breakage.

<a id="5-additive-change"></a>
## 5. Additive change: expand before you contract

The single most useful tactic for staying shippable is **make changes additive**. Add the new thing *alongside* the old thing; keep both working; migrate callers gradually; only delete the old thing once nothing uses it. This three-phase shape is called **expand → migrate → contract** (the heart of [Parallel Change](../../02-refactoring-techniques/02-moving-features/junior.md)-style work):

1. **Expand** — add the new code/field/method. Old code still works. *(Shippable.)*
2. **Migrate** — move callers from old to new, one at a time. After each, *both* still work. *(Shippable at every step.)*
3. **Contract** — once nothing uses the old code, delete it. *(Shippable.)*

The deadly mistake juniors make is doing this **backwards** — *contract before migrate*. You rename or delete the old method first, and now everything that depended on it is broken until you finish. That is a red trunk by design. **Always expand first, contract last.**

Here is the shape in code. Suppose we are renaming `getName()` to `getFullName()`.

```java
// PHASE 1 — EXPAND. Add the new method. Old one still works.
public class Customer {
    public String getName() {        // old — still here, still works
        return getFullName();        // delegate so logic lives in one place
    }
    public String getFullName() {    // new
        return firstName + " " + lastName;
    }
}
// Trunk is green. Every old caller still compiles. SHIPPABLE.

// PHASE 2 — MIGRATE. Change callers one PR at a time.
// invoice.print(customer.getName())  ->  invoice.print(customer.getFullName())
// Each migration is a tiny, separate, shippable commit.

// PHASE 3 — CONTRACT. Once NOTHING calls getName(), delete it.
public class Customer {
    public String getFullName() {
        return firstName + " " + lastName;
    }
}
// Trunk still green. SHIPPABLE.
```

Compare the broken way:

```java
// DON'T: contract first.
public class Customer {
    public String getFullName() { ... }   // renamed
    // getName() is GONE
}
// Now 30 callers of getName() don't compile. Trunk is RED until you fix all 30
// in one giant commit. You just lost shippability.
```

<a id="6-feature-flags-basics"></a>
## 6. Feature flags: the basics

A **feature flag** (a.k.a. feature toggle) is a runtime switch that decides which code path runs, *without* changing which code is deployed. It is the software equivalent of building the new bathroom next to the old one and choosing which door to open.

```java
if (flags.isEnabled("new-pricing-engine")) {
    return newPricingEngine.price(cart);   // new path
} else {
    return oldPricingEngine.price(cart);   // old path
}
```

Both code paths are deployed. The flag picks one **at runtime**. This unlocks everything:

- You can **merge unfinished work into trunk** behind an OFF flag — it ships but does nothing yet (latent code).
- You can **turn the new path on for 1% of users**, watch, then ramp to 100%.
- If the new path misbehaves, you **flip the flag OFF** — instant rollback, no redeploy.

There are different *kinds* of flags (you'll learn the full taxonomy in [middle.md](middle.md)). For now, the one you care about most is the **release toggle**: a short-lived flag that hides in-progress work until it's ready. It exists to let you keep shipping while you build. Its whole purpose is to be **deleted** once the feature is fully on — keeping a release toggle forever is a bug, which we'll come back to.

<a id="7-flag-before-and-after"></a>
## 7. A feature flag, before and after

**Before — no flag.** You want to switch from `LegacyTaxCalculator` to `NewTaxCalculator`. Without a flag, your only option is "swap it everywhere in one commit and hope." If `NewTaxCalculator` has a bug, every user is affected the instant you deploy, and your only fix is a panicked redeploy.

```java
// Before: a hard swap. All-or-nothing, no escape hatch.
public Money tax(Order order) {
    return new NewTaxCalculator().compute(order);  // crosses fingers
}
```

**After — behind a flag.** Now you deploy *both* calculators, gated by a flag. Roll out gradually; if anything is wrong, flip OFF.

```java
public class TaxService {
    private final FeatureFlags flags;
    private final TaxCalculator legacy;   // LegacyTaxCalculator
    private final TaxCalculator next;     // NewTaxCalculator

    public TaxService(FeatureFlags flags, TaxCalculator legacy, TaxCalculator next) {
        this.flags = flags;
        this.legacy = legacy;
        this.next = next;
    }

    public Money tax(Order order) {
        if (flags.isEnabled("new-tax-calculator", order.customerId())) {
            return next.compute(order);
        }
        return legacy.compute(order);
    }
}
```

Deployment day is now boring:

1. Deploy with the flag **OFF**. Production behaves exactly as before. *(Shippable, zero risk.)*
2. Turn it **ON for internal staff only**. Test in production safely.
3. Ramp to **1% → 10% → 50% → 100%** over days, watching error rates.
4. Once 100% is stable and proven, **delete the flag and the legacy calculator** (the contract phase).

Notice the flag is *temporary*. Step 4 is not optional. Leaving the flag in forever leaves dead `else` branches and confusing dual code paths — that is **flag debt**, the hidden cost of this whole section.

<a id="8-small-commits"></a>
## 8. Small commits, small PRs

Shippability lives or dies on commit size. The discipline:

- **One commit = one shippable step.** Each commit should leave trunk green and behavior-preserving. If a commit "only works together with the next three," it is too big.
- **Small PRs, not long-lived branches.** A PR open for a day, reviewed, merged. Not a branch open for two weeks. **Trunk-based development** means everyone integrates into trunk constantly, with branches measured in hours.
- **Separate behavior changes from structural changes.** Don't move code *and* change what it does in the same commit. Reviewers can't tell a pure rename from a logic change buried inside it. Do the refactor in one commit, the behavior change in another.

A good test: *"If I stopped right after this commit and went on vacation, would the system be fine in production?"* If yes, the commit is well-sized. If "no, it's half-done," split it.

<a id="9-the-four-siblings"></a>
## 9. The four siblings are all the same idea

The other four topics in this section are not four unrelated tricks. They are **four named techniques for obeying the one rule** — four ways to keep trunk shippable while making a large change. This topic is the capstone that ties them together:

- **Branch by Abstraction** *(sibling 01)* — introduce an abstraction (interface) in front of the thing you want to replace, build the new implementation behind it, switch, then remove the old one. It is "expand → migrate → contract" applied at the level of an interface, often combined with a flag to pick the implementation. Closely related to the [Adapter](../../../design-patterns/02-structural/01-adapter/junior.md) and [Strategy](../../../design-patterns/03-behavioral/08-strategy/junior.md) patterns.
- **Parallel Change (expand/contract)** *(sibling 02)* — the additive three-phase shape from §5, applied to method signatures, schemas, and data formats.
- **The Mikado Method** *(sibling 03)* — a way to *discover* the dependency order so that each step is small and trunk stays green. It stops you from starting a change that can't be finished in one safe step.
- **Strangler Fig at code level** *(sibling 04)* — grow the new system *around* the old one, route traffic over piece by piece, then delete the old one — the [Facade](../../../design-patterns/02-structural/05-facade/junior.md) and [Proxy](../../../design-patterns/02-structural/07-proxy/junior.md) patterns are common tools here.

Every one of them is "additive change + small shippable steps + (often) a flag to choose the path." Learn this capstone and the other four stop being four things to memorize.

> Note: as of writing, siblings 01–04 are scaffolded but their lesson files may not exist yet, so they are named here rather than linked. The cross-links above point to the related *refactoring techniques* and *design patterns*, which do exist.

<a id="10-when-not-to"></a>
## 10. When NOT to do this

Keeping everything shippable has a real cost — call it the **discipline tax**: extra flags, dual code paths, more commits, more reviews. Usually it is worth it. Sometimes it is not.

**When NOT to keep the system shippable mid-refactor:**

- **Tiny, fast, atomic changes.** Renaming a private method used in three places? Just do it in one commit. Don't build a flag and a two-bathroom dance for thirty seconds of work.
- **A short clean freeze is genuinely cheaper.** For a small, low-traffic internal tool with no release pressure, a one-hour "nobody touches trunk while I finish this" freeze can be cheaper than the flag machinery. The shippability discipline pays off when *other people* and *production* depend on trunk during your change — not when you're alone on a weekend script.
- **Prototypes and spikes.** Throwaway exploration on a branch you'll delete doesn't need to be shippable. (But don't let a spike sneak into production.)

The skill is judgment: use the heavy machinery (flags, parallel change) when the change is **large, risky, multi-day, or shared**; skip it when the change is **small, fast, and isolated.** Every technique in this section has a "when NOT to" — overusing flags creates *flag sprawl*, which is its own mess.

<a id="11-glossary"></a>
## 11. Glossary

- **Shippable / releasable** — a commit you could deploy to production right now with no user-facing breakage.
- **Trunk** — the main shared branch (e.g. `main`). "Never let trunk go red" = keep it always shippable.
- **Trunk-based development** — everyone integrates into trunk constantly; branches live hours, not weeks.
- **Continuous Integration (CI)** — the discipline of integrating frequently into trunk, keeping a fast green build, and fixing a red build immediately.
- **Feature flag / toggle** — a runtime switch choosing between code paths without redeploying.
- **Release toggle** — a short-lived flag hiding in-progress work; meant to be deleted once the feature ships.
- **Latent code** — code deployed to production but inactive, hidden behind an OFF flag.
- **Additive change** — adding new code alongside old, rather than modifying/deleting in place.
- **Expand → migrate → contract** — add new, move callers over, delete old. The shape of a shippable migration.
- **Flag debt** — the accumulated cost of flags that were never removed: dead branches, dual paths, confusion.
- **Canary** — exposing a change to a small slice of traffic first to catch problems before full rollout.
- **Rollback** — reverting to the previous safe state; with flags it's a flip, not a redeploy.

<a id="12-review-questions"></a>
## 12. Review questions

1. State the one rule of this whole section in a single sentence.
2. Why is a two-week feature branch *less* safe than putting half-done work on trunk behind an OFF flag?
3. What is the difference between "shippable" and "feature complete"?
4. What are the three phases of additive change, and why must "contract" come last?
5. What is latent code, and why is it safe to have in production?
6. Give one example where you should NOT use a feature flag and should just commit directly.
7. What is flag debt, and which step in §7 prevents it?
8. In one line each, how do Branch by Abstraction, Parallel Change, Mikado, and Strangler each serve the one rule?

<a id="next"></a>
## Next

- **[middle.md](middle.md)** — the full flag taxonomy and lifecycle, dark launching / shadowing, CI gates, and how to decompose one big change into a sequence of shippable steps.
- Related techniques that all serve this rule: [Composing Methods](../../02-refactoring-techniques/01-composing-methods/junior.md), [Moving Features](../../02-refactoring-techniques/02-moving-features/junior.md), and [When to Refactor to Patterns](../../03-refactoring-to-patterns/01-when-to-refactor-to-patterns/junior.md).
