# Branch by Abstraction — Optimize

> **Source:** Paul Hammant, "Branch by Abstraction"; Jez Humble & David Farley, *Continuous Delivery*

Each item is a rough "before" situation. Propose the right phased plan — *or argue Branch by Abstraction is the wrong tool*. Knowing when **not** to apply it is half the skill. Try before reading the solution.

---

## 1. The three-week branch in progress

A colleague is two weeks into `feature/new-search-backend`, replacing the search component. Trunk has moved 200 commits since they branched. They estimate "one more week, then a big merge." Migration is component-scoped, system must stay shippable.

<details><summary>Worked plan</summary>

**Stop and convert to Branch by Abstraction.** The big-bang merge is the exact pain this technique removes.

1. From trunk, extract a `SearchBackend` interface from what clients use; make the *current* (old) search impl implement it (Phase 1). Land on trunk.
2. Route all search clients through `SearchBackend` (Phase 2), small PRs.
3. Bring the in-progress new backend onto trunk *behind the seam, flag off* (Phase 3). The branch's work isn't wasted — it becomes the dormant second impl, integrated incrementally instead of dumped in one merge.
4. Ramp the flag (Phase 4), then delete the old impl + flag (Phase 5).

Net: the divergence stops *today*, review happens in small pieces, and cutover becomes a reversible flag flip instead of a scary merge. The earlier you convert, the less branch drift you carry.
</details>

---

## 2. The "just rename it" temptation

A method `pp()` (poorly named) needs to become `parsePayload()`. 14 call sites, all in your own module, all under test.

<details><summary>Worked plan — argue against</summary>

**Don't use Branch by Abstraction.** This lands atomically: IDE **Rename** updates all 14 call sites in one compiler-verified, behavior-preserving commit. No seam, no flag, no phases.

Branch by Abstraction would be scaffolding erected and torn down for a thirty-second job — pure waste. The technique's overhead only pays off for changes too large to land safely in one commit. This isn't one.

(If `pp()` were a **published** API other teams depend on, the answer would be **Parallel Change** — add `parsePayload()`, deprecate `pp()`, let consumers migrate, remove `pp()` — not Branch by Abstraction, which is for swapping *components*. See [Parallel Change](../02-parallel-change-expand-contract/junior.md).)
</details>

---

## 3. The tangled component with no seam

You want to replace a 2000-line `BillingManager` that twelve classes reach into — each calling different subsets of its 40 public methods, several reading its public fields directly.

<details><summary>Worked plan</summary>

**Don't start Branch by Abstraction yet — there's no clean seam.** You can't honestly define one interface twelve wildly different clients all depend on; the public *fields* mean clients aren't even going through methods.

Prerequisite refactoring first:
1. Eliminate direct field access — wrap fields behind methods (encapsulate). See [Organizing Data](../../02-refactoring-techniques/03-organizing-data/junior.md).
2. For each client, identify the *semantic* operation it actually needs; consolidate the 40-method surface toward those roles. You may discover `BillingManager` is really 2–3 responsibilities — split it, giving you 2–3 *narrower* seams instead of one god-interface.
3. *Then* run Branch by Abstraction on each clean boundary.

The Mikado Method helps map this prerequisite graph: see [Mikado Method](../03-mikado-method/junior.md). The canonical reference for creating seams in tangled code is *Working with Legacy Code*. Abstracting a mess just yields an abstract mess.
</details>

---

## 4. The unproven new pricing engine

You've written a new pricing engine. It passes unit tests, but pricing bugs are costly and you don't fully trust it under real-world cart variety. You need confidence before cutover.

<details><summary>Worked plan</summary>

Branch by Abstraction **with the verifying (shadow) variant**.

1. Phases 1–2: put a `PricingEngine` seam in front of the old engine; route clients through it.
2. Phase 3 with a twist: wire a `ComparingPricingEngine` that runs **both** engines on real read traffic, returns the *old* (trusted) price, and emits a `pricing.mismatch` metric (see [tasks.md](tasks.md) Task 7).
3. Let it run across a representative traffic sample (include a month-end / peak day). Investigate every mismatch — each is either a new-engine bug or a hidden old-engine quirk worth knowing.
4. Once mismatches are flat at zero, flip the flag for real (Phase 4), ramp, then clean up (Phase 5).

This works *because pricing is a read*. It buys production-grade confidence at near-zero user risk — the user always got the proven price during validation.
</details>

---

## 5. The write-path swap done naïvely

A plan says: "Swap the persistence layer using Branch by Abstraction. Phase 3: shadow-write to both the old and new stores to compare." It's about to be implemented.

<details><summary>Worked plan — fix the plan</summary>

**The shadow-write step is wrong** — see [find-bug.md](find-bug.md) Bug 4. Shadowing only works for idempotent *reads*; shadow-*writing* mutates two stores, diverges under concurrency, and can't be cleanly rolled back.

Corrected plan:
1. Phases 1–2 as normal (seam + route clients).
2. **Migrate reads first.** Shadow-compare `findById`/`findByCustomer` (reads only) to validate the new store's correctness with zero write risk.
3. **Migrate writes last, deliberately.** Choose a real data-consistency strategy:
   - keep the **old store authoritative**, dual-write with an explicit backfill/reconciliation job, and cut over only once the new store is provably consistent; or
   - a planned migration window with backfill if eventual consistency is acceptable.
4. Remember the flag rolls back *code*, not *data* — design so a rollback leaves data recoverable (old store authoritative until full cutover). See the write-path caveat in [professional.md](professional.md).
</details>

---

## 6. Ten half-finished migrations

A team retro reveals ten open Branch-by-Abstraction efforts, six of them past 80% rollout, all with flags still in place. Velocity on new work feels low and incidents are confusing.

<details><summary>Worked plan</summary>

**Stop starting; start finishing.** Ten open coexistence windows have recreated the long-lived-branch problem in flag form — each is a drift risk and cognitive load, and overlapping flags make incident attribution hard.

1. **Freeze new migrations.** Cap in-flight WIP.
2. **Drive the closest to done.** Take the six past 80% to Phase 5: ramp to 100%, bake, delete old impl + flag. Each closed migration removes a coexistence window and a chunk of confusion.
3. **Serialize any that touch the same hot path** so the flag-combination matrix (2 flags = 4 states) stops exploding.
4. **Assign owners and expiry dates** to the remaining flags; add stale-flag CI pressure.
5. Only resume new migrations once in-flight count is low.

The bottleneck isn't the next swap — it's the unfinished ones. See [senior.md](senior.md) on WIP and sequencing.
</details>

---

## 7. The permanent-cruft abstraction

A migration introduced `OrderTotalCalculator` (an interface) purely to swap one calculation implementation for another. The swap is done; there will only ever be one implementation, and no test injects a fake for it. The interface is still there.

<details><summary>Worked plan</summary>

**Phase 5 should inline it, not keep it.** This seam was *scaffolding*, not architecture:
- It has exactly one implementation and no foreseeable second one.
- No test benefits from injecting a fake (the calculation is pure and tested directly).
- It adds an indirection a future reader will puzzle over, mistaking accident for intention.

Plan:
1. Inline `OrderTotalCalculator` — fold the single implementation's logic back into its caller (or keep it as a plain class without the interface). Use **Inline** / collapse-hierarchy refactorings; see [Dealing with Generalization](../../02-refactoring-techniques/06-dealing-with-generalization/junior.md).
2. Remove the interface and the migration flag.

Contrast with a *persistence* or *external-gateway* seam, which you'd **keep** because it's a real boundary that aids testing and future swaps. The deciding question: "does this boundary earn its keep *after* the migration?" Here, no.
</details>

---

## Next

- Back to [middle.md](middle.md) (trade-offs, variants) · [senior.md](senior.md) (seam choice, sequencing) · [professional.md](professional.md) (flag lifecycle, rollback) · [find-bug.md](find-bug.md) · [tasks.md](tasks.md)
- Related: [Parallel Change](../02-parallel-change-expand-contract/junior.md) · [Mikado Method](../03-mikado-method/junior.md) · [Strangler at code level](../04-strangler-at-code-level/junior.md) · [Keeping the system shippable](../05-keeping-the-system-shippable/junior.md)
