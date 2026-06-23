# Keeping the System Shippable — Tasks

> **Source:** Jez Humble & David Farley, *Continuous Delivery*; Martin Fowler, "FeatureToggle" & "ContinuousIntegration"

Work each task before reading the solution. The goal isn't a "right answer" — it's the *shape*: a sequence of green, behavior-preserving, independently-shippable steps, with a clear flag lifecycle and a stated trade-off.

---

## Task 1 — Decompose a big change into shippable steps

You must replace `LegacyEmailSender` (synchronous SMTP) with `QueueEmailSender` (enqueues to a message broker). 200 call sites send email. Break this into a sequence of commits where trunk is green and shippable after each. Mark which commits are pure refactor, which add latent code, and where the flag lives.

<details><summary>Solution</summary>

```
C1  Extract interface EmailSender; LegacyEmailSender implements it.          [refactor, green]
C2  Change call sites to depend on EmailSender (not the concrete class).     [refactor, green]
      -> can be several commits, batches of call sites. Both still legacy.
C3  Add QueueEmailSender implementing EmailSender. Not wired in.             [latent code, OFF, green]
C4  Add release flag "queue-email"; a routing EmailSender picks impl by flag,
      default OFF.                                                           [flag introduced, green]
C5  Add shadow mode behind "shadow-queue-email": enqueue to the broker but
      STILL send via SMTP, compare/log (careful: email has side effects —
      shadow must enqueue to a throwaway/dev queue, NOT actually send).      [green]
--- operate: shadow a week, then ramp "queue-email" 1% -> 100% ---
C6  Remove flag check; route directly to QueueEmailSender.                   [green]
C7  Delete LegacyEmailSender, remove "queue-email" + "shadow-queue-email"
      flag configs.                                                          [contract, green]
```

Key points the solution must hit: interface seam first (C1), depend-on-abstraction before adding the new impl (C2), new impl is latent (C3), one release flag (C4), and — because **email has side effects** — naive shadowing would double-send, so the shadow targets a non-delivering queue. The flag is removed in C6–C7; the task isn't done until then.

</details>

---

## Task 2 — Design a flag plan (with lifecycle)

For Task 1's `queue-email` flag, write the full lifecycle plan: default state, who can flip it, rollout stages, rollback trigger, soak period, and removal. Classify the flag.

<details><summary>Solution</summary>

- **Kind:** release toggle (short-lived, flips off→on once, then deleted).
- **Default:** OFF in production; ON in CI for the "flag-on" test path.
- **Owner / who flips:** the team owning email delivery; ramp changes made via the flag platform, audited.
- **Rollout stages:** internal/staff ON → canary 1% → 10% → 50% → 100%, holding ≥1 day per step (email problems are often slow-burn: bounces, deliverability).
- **Signals watched:** send success rate, broker enqueue errors, end-to-end delivery latency, bounce/complaint rate.
- **Rollback trigger:** if enqueue error rate > 1% or delivery latency p99 regresses beyond threshold for 10 min → flip OFF (instant, back to SMTP).
- **Soak:** 1 week at 100% with zero regressions.
- **Removal:** removal ticket created *at the same time as the flag*, scheduled for soak-end. C6/C7 above delete the flag check and `LegacyEmailSender`.

The mark of a good answer: the **removal** is planned up front, not "someday." A release toggle with no removal date is a leak.

</details>

---

## Task 3 — Spot and fix the contract-before-migrate ordering

A teammate proposes this plan to rename `Account.balance()` to `Account.availableBalance()`:

```
Step 1: rename balance() to availableBalance() in Account.
Step 2: fix all the compile errors across the codebase.
Step 3: ship.
```

What's wrong, and what's the shippable plan?

<details><summary>Solution</summary>

**Wrong:** Step 1 *contracts first* — the moment `balance()` is renamed, every caller breaks and trunk is red until step 2 fixes them all in one giant commit. There is no shippable point in the middle. If you stop after step 1, the system is broken.

**Shippable plan (expand → migrate → contract):**
```
C1  Add availableBalance(); make balance() delegate to it. Both work.   [expand, green]
C2..Cn  Migrate callers from balance() to availableBalance(), in batches.
        Both methods work after every batch.                            [migrate, green]
Cn+1 Once nothing calls balance(), delete it.                          [contract, green]
```
Every commit is green and shippable. You could stop after any of them.

</details>

---

## Task 4 — Decide: flag or freeze?

For each scenario, decide whether to use the full shippable machinery (flag + parallel change) or just a clean freeze / direct commit. Justify.

(a) Rename a `private` helper used in 4 places in one class.
(b) Replace the auth token validation logic in a service handling 50k req/s.
(c) Reorder fields in a DTO used only by an internal cron job that runs nightly, single-team-owned.
(d) Migrate the primary payments provider integration.

<details><summary>Solution</summary>

- **(a) Direct commit.** Atomic, private, trivial, no external dependents. A flag would be absurd. One green commit.
- **(b) Full machinery.** High traffic, security-critical, behavior must be provably preserved. Branch by Abstraction + shadow (compare new vs old validation result on live traffic) + staged rollout + instant flag rollback. Worth every bit of the discipline tax.
- **(c) Freeze / direct.** Low traffic, internal, single-team, runs nightly so blast radius and deploy pressure are tiny. A short "I'm changing this DTO, don't deploy the cron for an hour" is cheaper than flags. (Still make it backward-compatible if anything else reads the DTO.)
- **(d) Full machinery, maximum care.** Money path — shadow first (no double-charge: shadow in a no-op/sandbox mode), tiny canary, business-KPI monitoring, pre-defined rollback trigger, ops kill-switch. The most expensive failure mode in the list; the machinery is cheap insurance.

The skill is matching effort to **risk × blast radius × shared-ness**, not applying flags everywhere.

</details>

---

## Task 5 — Add the "both flag states" test

This code is gated by a flag but only the ON path is tested. Write the missing test and explain why it matters.

```java
public Money price(Cart cart) {
    if (flags.isEnabled("new-pricing")) return newEngine.price(cart);
    return legacy.price(cart);
}

@Test void usesNewEngine_whenOn() {
    flags.set("new-pricing", true);
    assertEquals(Money.of(100), service.price(cart));
}
```

<details><summary>Solution</summary>

```java
@Test void priceUnchanged_whenFlagOff() {
    flags.set("new-pricing", false);
    assertEquals(Money.of(100), service.price(cart));   // legacy behavior preserved
}
```

**Why it matters:** the flag defaults OFF in production, so the OFF path is what *actually ships to 100% of users first*. If CI only tests the ON path, the most-deployed code path is the *least*-tested — exactly backwards. A CI gate for flagged code must exercise **both** states.

</details>

---

## Task 6 — Pay down flag debt

You inherit a service with these flags. Classify each and decide its fate.

```
release.new-search        -> 100% on for 8 months, else-branch is old search
exp.checkout-color        -> running A/B test, 3 weeks old
ops.payments-killswitch   -> off, never triggered
release.csv-export-v2     -> 40% rollout, stalled 5 months, owner left team
permission.beta-dashboard -> gates a paid feature by plan
```

<details><summary>Solution</summary>

- **`release.new-search`** → **DELETE the flag and the old search code.** A release toggle 100%-on for 8 months is a defect: the `else` branch is dead, untested, misleading. This is classic flag debt; the refactor was never finished. Remove flag + legacy path.
- **`exp.checkout-color`** → **Keep, but set an end date.** Legitimate experiment toggle; it has a natural lifespan (the test concludes). Ensure it's scheduled to be removed when the experiment ends, not left to rot.
- **`ops.payments-killswitch`** → **Keep — and TEST it.** Legitimate long-lived ops toggle. The risk isn't that it exists; it's that it's *never been exercised* — a kill-switch nobody has flipped is a hope, not a control. Schedule a game-day to verify it works.
- **`release.csv-export-v2`** → **Worst case: a stalled half-migration with no owner.** 40% means the code permanently supports *both* paths and every new caller must choose. Assign an owner; *decide* — either finish the rollout to 100% then remove the flag and old path, or revert to 0% and delete the new path. Do not leave it at 40%. Half-migrations are worse than not starting.
- **`permission.beta-dashboard`** → **Keep.** Legitimate permanent permission toggle (entitlement); it's not debt — it's product logic. It's correctly long-lived.

The lesson: not all flags are debt. *Release* toggles that overstayed are debt; ops/permission toggles are supposed to live long; experiment toggles need an expiry. Triage by **kind**, not by age alone.

</details>

---

## Task 7 — Order the dependency (Mikado-style)

You want to make `OrderService` use a new `InventoryClient`. Attempting it directly reveals: `InventoryClient` needs a `RetryPolicy`; `OrderService` is constructed by hand in 12 tests with no DI; and `InventoryClient` reads config that isn't loaded yet. Produce an ordering of small shippable commits.

<details><summary>Solution</summary>

Work the prerequisites *first*, each green and shippable on its own, bottom-up:

```
C1  Add the inventory config keys + loader. Nothing uses them yet.        [latent, green]
C2  Introduce RetryPolicy as a standalone, tested component.              [green]
C3  Introduce constructor injection on OrderService; update the 12 tests
    to pass dependencies. Behavior unchanged.                             [refactor, green]
C4  Add InventoryClient (using RetryPolicy + config). Not wired into
    OrderService yet.                                                     [latent, green]
C5  Wire InventoryClient into OrderService behind a release flag, OFF.    [green]
--- ramp the flag ---
C6  Remove flag; OrderService uses InventoryClient directly.             [green]
C7  Remove any now-dead old inventory path + flag config.                [contract, green]
```

The Mikado insight: you discovered the prerequisites by *trying* the change, then *backed out* and did the leaves first (config, RetryPolicy, DI) so the final wiring (C5) is a small, green step rather than a tangled mess. Never start a step (like C5) before its prerequisites (C1–C4) are landed and green.

</details>
