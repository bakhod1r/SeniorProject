# Keeping the System Shippable — Professional

> **Source:** Jez Humble & David Farley, *Continuous Delivery*; Martin Fowler, "FeatureToggle" & "ContinuousIntegration"

The professional view treats shippability as an **economic and risk-management discipline**, not just an engineering preference. You can put numbers on why "always shippable" beats "big-bang merge," you choose and operate real tooling, you measure flag debt as a tracked liability, and you own the rollout/rollback playbooks that get invoked at 2 a.m. This file is about running the discipline at organizational scale.

## 1. The economics: why "always shippable" pays

Frame it as **batch size and the cost of failure.** Two variables dominate:

- **Mean time to detect (MTTD)** — how fast you notice a problem.
- **Blast radius** — how many users / how much money a problem touches before it's contained.

A big-bang merge maximizes both: 40 changes land together (you can't tell which broke), and they hit 100% of users at once. Cost of a failure ≈ `(time to find the culprit among 40 changes) × (full user base) × (revenue/incident rate)`.

The shippable approach attacks both terms:

- **Small batches → low MTTD.** One change at a time means a regression is attributable to *one* commit. Debugging time collapses from "bisect a 40-change merge" to "look at the one commit we just ramped."
- **Staged rollout → small blast radius.** A canary at 1% caps the worst-case loss at ~1% of users for the detection window. A flag flip is a sub-second rollback with no redeploy, versus a 20-minute emergency deploy.

This is the DORA / *Accelerate* result in operational terms: elite teams deploy in **small batches, frequently**, and as a direct consequence have **lower change-failure rate and faster recovery**. Shippability is the *mechanism* behind those metrics — small shippable steps are what make small frequent deploys possible.

**The counter-cost is real and must be priced in:** the discipline tax (extra flags, dual paths, shadowing infra, governance), and **flag debt** if you don't pay it down. The professional doesn't pretend the machinery is free — they confirm the change is large/risky/shared *enough* that reduced MTTD and blast radius outweigh the tax. For a tiny isolated change, a clean freeze can win on pure economics; for a payment-path rewrite, the machinery is cheap insurance.

## 2. Flag-management tooling

Hand-rolled flags (a config file, a database table) are fine at small scale. At scale you want a dedicated **flag-management platform**, because the operational features matter more than the `if`:

- **LaunchDarkly** — the dominant commercial platform. Percentage rollouts, targeting rules by user/segment, instant kill-switch propagation, audit log of who flipped what when, scheduled changes, and — critically — **flag lifecycle / "code references"** features that find every place a flag is used and flag stale toggles for removal.
- **Unleash** — popular open-source / self-hostable platform with similar targeting, gradual rollout strategies, and an API; good when data-residency or cost rules out SaaS.
- Cloud-native options (e.g. AWS AppConfig, OpenFeature as a vendor-neutral SDK standard) sit in the same space.

What you're buying over a homegrown `flags.isEnabled()` is the **operational and governance layer**: instant global propagation of a kill-switch, targeting without a deploy, an **audit trail** (essential for incident review and compliance), and **stale-flag detection** that fights flag debt automatically. The `if` statement was never the hard part; *operating thousands of flags safely* is.

> **When NOT to buy a platform:** a handful of release toggles on a small service don't justify a LaunchDarkly contract or an Unleash deployment. A config map and discipline are cheaper. Adopt the platform when flag *count*, *targeting complexity*, or *audit/compliance* needs cross the threshold — not before.

## 3. Measuring flag debt as a tracked liability

Flag debt is the defining hidden cost of this whole section, so professionals **measure** it instead of hoping. Treat it like financial debt with a ledger:

- **Flag inventory.** Total flags, broken down by kind (release / experiment / ops / permission). Release toggles are the ones expected to trend toward zero.
- **Flag age.** Per release toggle: days since creation. Anything past its expected lifespan is overdue.
- **Always-true / always-false flags.** A release toggle stuck at 100% for > N days is a *defect* — its dead branch is untested, misleading code. This count should be near zero.
- **Orphaned flags.** Defined in the platform but no longer referenced in code (or referenced but never evaluated). Both are leaks.
- **Flag debt ratio.** Overdue release toggles ÷ total release toggles. Trend it on a dashboard.

Pay it down on a **cadence**: a recurring flag-cleanup rotation, plus a hard rule that creating a release toggle creates its scheduled removal ticket. Tooling that does "code reference" scanning automates most of the detection. The professional stance: an un-removed release toggle is **work that isn't done**, not a harmless leftover — the refactor isn't complete until the flag and the old path are gone.

## 4. Rollout and rollback playbooks

Shippability gives you escape hatches; playbooks make sure you actually *use* them correctly under stress.

**Rollout playbook (the happy path):**

1. Deploy with flag **OFF**. Confirm no behavior change in prod. (This deploy is the riskless part — code is latent.)
2. **Internal / dogfood** cohort ON. Validate.
3. **Canary**: 1% of traffic. Watch the *right* signals — error rate, p99 latency, and **business KPIs** (conversion, revenue), not just "did it crash." A change can be technically healthy and commercially harmful.
4. **Ramp** 1% → 5% → 25% → 50% → 100%, holding at each step long enough to detect slow-burn problems.
5. **Soak** at 100%, then **remove the flag and old path** (contract).

**Rollback playbook (the unhappy path):**

- **Flag flip first, always.** If the new path misbehaves, flip the flag OFF — sub-second, no redeploy, the whole reason the flag exists. *Then* investigate calmly with users back on the proven path.
- **Define rollback triggers in advance.** "If error rate > X% or p99 > Y ms for Z minutes, auto-revert the flag." Pre-deciding removes hesitation during the incident.
- **Every single step is revertible.** Because each commit was independently shippable, you can revert *exactly* the offending step without unpicking the rest. That property is the payoff of all the small-commit discipline.
- **Data-path caveat:** for stateful migrations a flag flip un-routes *reads* instantly, but data already written in the new format may need reconciliation. Keep the old path readable until the new one has soaked (senior §5). Don't drop the old column until rollback is genuinely off the table.

**Incident safety:** the kill-switch (an *ops* toggle, distinct from the release toggle) for any risky subsystem must be flippable *without* a deploy, owned by on-call, and tested — a kill-switch nobody has ever exercised is a hope, not a control. Rehearse it.

## 5. Trunk-based development at scale (Google, Meta)

The "always shippable" discipline is not a small-team luxury — the largest engineering orgs in the world run on it precisely *because* it scales where long-lived branches don't.

- **Google** is famously near-trunk-based on a single massive monorepo: developers commit to (or very close to) head, an enormous CI system gates every change, and **large migrations across millions of lines** are done as long sequences of small, automated, individually-green changes — often with mechanical tooling (large-scale change tools, automated refactoring) rather than a giant hand-merged branch. The entire model assumes head is always buildable; a broken head blocks thousands of engineers, so it's an emergency.
- **Meta** likewise runs trunk-based development on a monorepo with heavy CI and **feature gating** (their long-standing internal flag/experimentation system) so that incomplete work ships dark and is rolled out via gates and experiments rather than via merges. New code lands continuously behind gates; rollout and rollback are gate operations.

The shared lesson: **at scale, long-lived branches are infeasible, so "every commit keeps trunk shippable" stops being a nice-to-have and becomes the only model that works.** Flags/gates and small green commits aren't optional ceremony — they're load-bearing. The flag-debt problem also scales with them, which is why these orgs invest heavily in automated stale-flag and stale-code detection.

## When NOT to (professional framing)

- **Don't build rollout infrastructure you won't use.** Canary tooling, shadow pipelines, and a flag platform are investments justified by deploy frequency and blast radius. A low-traffic internal tool deploying monthly may rationally skip all of it and accept a short freeze for big changes — the *expected* cost of failure is too low to amortize the machinery.
- **Don't keep flags as a permanent rollback hedge.** "We might want to flip back someday" is the rationalization that creates flag debt. A release toggle's rollback value expires after the soak; past that, the flag is pure liability. Remove it.
- **Don't let the discipline tax exceed the risk.** The whole apparatus is risk reduction priced in engineering time. When the risk is genuinely small and isolated, the cheapest correct answer is sometimes a clean, well-announced freeze and one careful change. Knowing *that* is also professionalism.

## Next

- **[interview.md](interview.md)** — the questions that probe whether you actually understand this, with model answers.
- Capstone synthesis lives across this section; the supporting techniques are [Refactoring to Patterns](../../03-refactoring-to-patterns/01-when-to-refactor-to-patterns/junior.md), [Moving Features](../../02-refactoring-techniques/02-moving-features/junior.md), and the seam patterns [Adapter](../../../design-patterns/02-structural/01-adapter/junior.md) / [Proxy](../../../design-patterns/02-structural/07-proxy/junior.md) / [Strategy](../../../design-patterns/03-behavioral/08-strategy/junior.md).
