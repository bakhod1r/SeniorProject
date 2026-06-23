# Keeping the System Shippable — Senior

> **Source:** Jez Humble & David Farley, *Continuous Delivery*; Martin Fowler, "FeatureToggle" & "ContinuousIntegration"

By now the mechanics are familiar: additive change, release toggles, shadowing, expand→migrate→contract, six small commits instead of one big one ([middle.md](middle.md)). The senior problem is different. It is not "how do I keep *my* change shippable." It is **"how do we keep trunk shippable when five people are running five large refactors on it at the same time, and some of those refactors depend on each other."** That is a coordination problem, a governance problem, and a granularity-judgment problem.

## 1. Trunk is a shared resource — treat it like one

On a small team, "keep trunk green" is mostly personal discipline. At scale, trunk is a **shared resource under contention**, like a production database. Several large migrations are in flight simultaneously. Each one, in isolation, follows the rules. Together they can still wreck shippability:

- Two migrations touch the same module; commit ordering matters and nobody owns the ordering.
- Refactor A introduces a seam that refactor B needs — but B started first and is now blocked or building on a moving foundation.
- A flag from team X interacts with a flag from team Y, producing a state neither team tested.

The senior move is to make the *contention explicit*. Maintain a lightweight, visible **register of in-flight large refactors**: what's changing, which modules it touches, which flags it owns, who owns it, and its current phase (expand / migrating / contracting / removing-flag). This is the same instinct as a schema-change register. When two refactors collide, you see it on the register, not in a merge conflict at 6 p.m.

## 2. Dependencies between in-flight migrations

The hardest case: **migration B depends on migration A** (B needs the abstraction A is introducing). Three ways to handle it, in order of preference:

1. **Sequence them.** A fully lands its expand phase (the seam exists, shippable) *before* B starts depending on it. The seam is published, stable, and not going to move. Slower, but safe and simple.
2. **Share the seam deliberately.** A and B agree on the interface up front; A introduces it as an early, isolated, shippable commit that *both* then build on. The interface becomes a contract between two teams — treat it like a published API: don't break it without coordination.
3. **Decouple via the abstraction layer.** This is exactly what Branch by Abstraction buys you: A and B each work behind the same abstraction, swapping implementations independently. The abstraction is the firewall between two in-flight changes.

What you must **never** do: let B build on A's *half-finished, still-moving* internals. That couples two unfinished migrations into one giant unshippable blob — you've recreated the big-bang branch, just spread across two teams.

> **Mikado at team scale:** the Mikado Method's dependency graph isn't just for one developer's change. Drawn for two interacting refactors, it shows you exactly which prerequisite must land before which, and reveals when a "small" change actually pulls in another team's work-in-progress.

## 3. Granularity — how big should a shippable step be?

Juniors hear "small commits" as "smallest possible commits." Seniors choose granularity deliberately, trading off two costs:

- **Too coarse** → steps that aren't independently shippable, big risky merges, the failures we already know.
- **Too fine** → 80 microscopic commits, review fatigue, a flag for every trivial step, coordination overhead that swamps the actual work. *Excessive* shippability discipline is its own waste — the discipline tax (junior §10) is real and at scale it compounds.

A good shippable step is the **largest unit that is still green, behavior-preserving, independently reviewable, and revertible on its own.** Heuristics:

- **One reviewable concept per step.** If a reviewer needs the next three PRs to understand this one, it's too fine; if they can't hold this one in their head, it's too coarse.
- **Revert as the unit test of granularity.** If you couldn't cleanly `git revert` exactly this step without unpicking three others, your boundaries are wrong.
- **Flag-per-feature, not flag-per-commit.** Many commits can sit behind *one* release toggle. Don't mint a flag per commit — that's flag sprawl.
- **Coarser when isolated, finer when shared.** A change nobody else touches can take bigger steps. A change on a hot, shared module wants finer steps so other people's work interleaves cleanly.

## 4. Flag governance

At one or two flags, governance is "remember to delete it." At fifty flags across teams, you need rules, or flag debt becomes structural:

- **Every flag has an owner and an expiry.** A release toggle with no owner and no removal date is an orphan the moment it's created. Encode this — many teams fail CI if a release toggle is older than N days without a removal ticket.
- **Naming conventions encode intent and lifespan.** e.g. `release.new-tax-calc`, `ops.payments-killswitch`, `exp.checkout-layout`. The prefix tells everyone whether this flag is supposed to die soon or live forever, so nobody "cleans up" a kill-switch or leaves a release toggle to rot.
- **No flag-on-flag dependencies.** `if (flagA && flagB)` across team boundaries is a combinatorial trap. Flags should be independent; if two features truly interact, that coupling belongs in one flag's logic, not in tangled checks.
- **A removal cadence.** Flag debt is paid down on a schedule (a recurring "flag cleanup" rotation), not "when someone notices." Treat it like dependency upgrades.
- **Audit the always-true flags.** A release toggle that has been 100%-on for a month is a *defect*: its old `else` branch is dead, untested, misleading code. Surface these automatically.

## 5. Keeping shippable when the change is data, not code

Code refactors are the easy case — flags switch in milliseconds. The senior nightmare is when the migration involves **state**: a schema change, a data backfill, a format change. You can't flip a flag to un-migrate a million rows. The discipline still holds, but the steps get more careful:

- **Expand the schema additively first** — add the new column/table, deploy code that *writes both* old and new, *reads* old. Shippable, reversible.
- **Backfill** the new column for historical rows, in batches, idempotently. Shippable throughout.
- **Switch reads** to the new column behind a flag; shadow-compare first.
- **Stop writing** the old column. Shippable.
- **Contract** — drop the old column, only after a soak long enough that you're sure no rollback will need it.

The rule "never break shippability" forces **every** schema change to be backward-compatible at each step — old code and new code must both run against the database simultaneously during a rolling deploy. (This is "expand/contract" applied to data; the database-migration discipline is a topic of its own, but the shippability principle is identical: each step is independently deployable and reversible.)

## 6. Making it cultural, not heroic

Shippability that depends on one diligent senior reviewing every PR doesn't scale and doesn't survive that person leaving. The senior job is to make it the *path of least resistance*:

- **CI enforces it**, so red trunk is mechanically blocked, not socially discouraged.
- **The default branch flow is trunk-based**, so long-lived branches require swimming upstream.
- **"Is this shippable on its own?" is a standard review question**, asked every time until it's reflexive.
- **A normalized red trunk is treated as an incident**, not a shrug. The single most corrosive thing a team can do is accept "trunk's a bit broken right now." Once that's normal, every technique in this section is dead, because none of them mean anything if trunk isn't actually green.

## When NOT to (senior framing)

A senior also knows when the machinery is overkill *at the org level*. For a self-contained service owned by one small team, with low deploy frequency and no cross-team dependencies, the full apparatus — flag governance, shadowing infrastructure, registers — can cost more than the risk it removes. A brief, well-communicated freeze and a careful single migration can be the right call. Reserve the heavy coordination machinery for changes that are **large, multi-team, on a hot shared trunk, or touching production-critical paths.** Spending senior coordination budget on a low-risk isolated change is its own waste.

## Next

- **[professional.md](professional.md)** — the economics and risk math, named tooling (LaunchDarkly, Unleash), measuring and paying down flag debt, rollout/rollback playbooks, incident safety, and how Google/Meta run trunk-based development at enormous scale.
- Related: [When to Refactor to Patterns](../../03-refactoring-to-patterns/01-when-to-refactor-to-patterns/junior.md) and [Structural patterns](../../03-refactoring-to-patterns/03-structural/junior.md) — seams are built from [Adapter](../../../design-patterns/02-structural/01-adapter/junior.md), [Facade](../../../design-patterns/02-structural/05-facade/junior.md), and [Proxy](../../../design-patterns/02-structural/07-proxy/junior.md).
