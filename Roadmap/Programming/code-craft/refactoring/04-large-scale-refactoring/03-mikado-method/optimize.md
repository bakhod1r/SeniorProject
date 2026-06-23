# The Mikado Method — Optimize

> **Source:** Ola Ellnestam & Daniel Brolund, *The Mikado Method* (Manning, 2014)

Each "before" is a refactoring situation about to be tackled badly. Produce the Mikado graph and plan — *or* argue that a simpler approach beats Mikado here. The skill being trained: choosing the right strategy, then sequencing it leaf-first.

---

## Situation 1 — Remove a god-object reference

**Before.** `AppContext` is a static god-object (`AppContext.get().db()`, `.cache()`, `.userSession()`, `.featureFlags()`). `CheckoutController` calls all four. You want `CheckoutController` to receive what it needs explicitly.

**Plan.** Mikado fits — deep, unknown fan-out. Goal: *"`CheckoutController` receives `Db`, `Cache`, `UserSession`, `FeatureFlags` via constructor; no `AppContext.get()` in the class."* First attempt reveals four prerequisites (one per accessor) plus caller breaks:

```
[~] GOAL: CheckoutController takes Db, Cache, UserSession, FeatureFlags via ctor
   ├── [ ] read db from injected field            (overloaded ctor, default AppContext.get().db())
   ├── [ ] read cache from injected field         (overloaded ctor default)
   ├── [ ] read session from injected field       (overloaded ctor default)
   ├── [ ] read flags from injected field         (overloaded ctor default)
   └── [ ] caller(s) of new CheckoutController() pass the four collaborators
```

Each accessor leaf is independent (Parallel Change: overloaded ctor defaulting to the `AppContext` value, switch body to field, commit). Caller leaf last, then root removes the defaults. **Optimization insight:** if `AppContext.get()` appears under *every* controller's graph, the real finding is "AppContext is a pervasive coupling point" — schedule its removal as its own initiative rather than fighting it controller-by-controller forever.

---

## Situation 2 — A two-line rename dressed up as a migration

**Before.** Someone proposes a Mikado graph to rename `calcTotal()` → `calculateTotal()` across 40 call sites and "carefully migrate."

**Argue simpler.** **Don't use Mikado.** Scope is fully known and the change is mechanical — the IDE's Rename refactoring updates all 40 sites atomically and safely in one green step. There's no unknown dependency tree to discover, so there are no leaves to find. A graph here is pure overhead. Reserve Mikado for *deep, unknown-dependency* changes.

---

## Situation 3 — Untangle vs. strangle

**Before.** `LegacyPricing` (1,800 lines, no tests, reaches into 6 globals, called from 22 places) must be replaced by a new pricing engine. The team's instinct: in-place Mikado.

**Plan / argue.** First do a **learning spike** to draw the graph (the build is slow and the class is huge, so a tight revert loop is painful — junior.md §9). If the spike's graph is wide-but-shallow and the globals are few real seams, in-place Mikado works: extract a `PricingEngine` interface (Branch by Abstraction) as the first shared leaf, migrate callers to it, then swap the implementation.

But if the graph comes back **dense and cyclic** — globals tangled across all 22 callers, cycles you'd have to break everywhere — argue for a **Strangler at code level** instead: stand the new engine up behind the same interface, route callers over one at a time, and delete `LegacyPricing` when traffic is zero. The Mikado *graph* is exactly the evidence that justifies the strangle: "untangling in place is N leaves of cyclic risk; strangling is M independent caller-cutovers." Also: get **characterization tests** on `LegacyPricing` *first* either way — without a green signal, neither approach is safe.

---

## Situation 4 — The deep, narrow chain

**Before.** Proposed graph:

```
[~] GOAL: A uses new format
   └── [ ] B must change
         └── [ ] C must change
               └── [ ] D must change
                     └── [ ] E must change
```

**Optimize.** A deep, single-child chain is a smell: zero parallelism, no early shippable value, and a long sequential risk. Before executing, ask whether the goal can be **re-cut so more work is independent** — e.g. introduce an abstraction at B so that C/D/E migrate behind it independently rather than in lockstep. If the chain is genuinely irreducible (a true linear pipeline), Mikado still works, but you commit E→D→C→B→A bottom-up and accept that there's nothing to parallelize. Set stakeholder expectations accordingly: this one is a relay, not a swarm.

---

## Situation 5 — Behavior change smuggled into a refactor

**Before.** "While I'm Mikado-ing `OrderService` onto constructor injection, I'll also fix the rounding bug and add the new loyalty discount."

**Optimize / argue.** **Separate the concerns — Mikado is for structure only.** Mikado's signal is "green build = behavior preserved." If you also change behavior, a green build no longer means "I didn't break anything," and the revert discipline loses its meaning (you can't tell a behavior regression from intended change). Plan: (1) run the structural Mikado refactor to constructor injection, committing green leaves; (2) *then*, on a clean green baseline with the class now testable, fix the rounding bug and add the discount as ordinary TDD changes. Mixing them forfeits the method's core guarantee.

---

## Situation 6 — Parallelize a wide graph

**Before.** A real graph after the discovery phase, three engineers free:

```
[~] GOAL: ReportingService takes ReportRepository (no static DB)
   ├── [~] A: PdfRenderer subtree (3 leaves)
   ├── [~] B: CsvRenderer subtree (2 leaves)
   ├── [~] C: Scheduler subtree (2 leaves)
   └── [ ] X: extract ReportRepository interface   <-- needed by A, B, and C
```

**Plan.** Optimize for throughput *without* creating merge contention. **X is a shared serialization barrier** — one engineer does it first, everyone rebases on the green commit. *Then* fan out: engineer 1 owns subtree A, engineer 2 owns B, engineer 3 owns C — whole subtrees, not interleaved leaves, so no shared files. Every cleared leaf commits green to trunk for continuous integration. Only the GOAL (root) waits for all three subtrees; assign it to whoever finishes last. **Anti-pattern avoided:** handing out individual leaves across subtrees would create overlapping edits and merge conflicts — and starting the fan-out *before* X is done would force everyone to re-do the interface extraction.

---

## Situation 7 — Estimate from a partial graph

**Before.** Two days into a refactor, stakeholders want a date. You have 9 leaves committed; the last three attempts added 5, 3, and 2 new prerequisites respectively; the graph currently shows 7 open leaves; average leaf cost ≈ 1.5 hours.

**Optimize the answer.** Don't give a point estimate. Compute: **lower bound** = 7 open × 1.5h ≈ 10.5h of *known* work. **Trend** = discovery rate is falling (5 → 3 → 2 new per attempt), so the graph is *converging* — open count should keep shrinking. Report a **range with the trend**: "we've cleared 9 leaves; ~7 known remain (≈1.5 days), and the rate of new discoveries is dropping fast, so I expect it to land within 2–3 days, all shipped green as we go — and we can stop at any leaf with banked, shippable value." That is a defensible, decision-useful estimate; "Thursday" is not.
