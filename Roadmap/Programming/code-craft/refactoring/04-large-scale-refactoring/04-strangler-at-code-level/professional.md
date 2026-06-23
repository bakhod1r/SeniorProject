# Strangler at the Code Level — Professional

> **Source:** Martin Fowler, "StranglerFigApplication", martinfowler.com/bliki/StranglerFigApplication.html

The professional question is not "how do I strangle?" but "is the strangle *worth it*, and how do I run it so it actually finishes?" That means accounting for the economics, instrumenting the routing so you can see what's happening, building a rollback you can trust, and treating the migration as a project with a definition of done — not an open-ended cleanup.

---

## 1. The economics of strangling

The strangler trades **temporary cost** for **reduced risk**. You must be able to name both sides of that trade before you start.

**What you pay:**
- **Double maintenance.** While both paths are live, bug fixes and new requirements may land twice. Cost ≈ (rate of changes to this area) × (duration of transition).
- **Routing complexity.** Flags, seams, and shadow harnesses are code that must be tested, monitored, and eventually removed.
- **Cognitive load.** Every reader must understand "which path runs when." This tax is paid on every PR that touches the area until the old path is gone.

**What you buy:**
- **Bounded blast radius.** A bad slice affects 1% of traffic, not 100%, and rolls back in seconds.
- **Continuous shippability.** No long-lived branch, no freeze, no big-bang release night.
- **Evidence before commitment.** Shadowing and canaries let you *measure* correctness instead of betting on it.

**The decision rule:** strangle when the risk of a clean cutover (cost of being wrong × probability of being wrong) exceeds the carrying cost of the transition. For a small, well-tested change, cutover wins. For a high-traffic money path with shaky tests, the strangler's carrying cost is cheap insurance.

> **When NOT to (economics):** if the transition will be long *and* the area changes frequently, double-maintenance can dominate. Either shorten the transition (fewer, bigger slices, hard ramp) or cut over. An indefinite strangle is a permanent tax.

---

## 2. Double-maintenance discipline

While two paths live, prevent drift deliberately:

1. **Freeze the old path to fixes-only.** No new features go into legacy. New requirements go into the new path only; if a slice isn't migrated yet, that's a reason to prioritize it.
2. **Mirror every fix.** A production bug fix during transition must be applied to *both* paths and re-verified by the parity test, until the old path is deleted.
3. **Make the parity test a guardrail.** It runs in CI and fails the build on divergence — so a fix that lands in only one path is caught before merge.
4. **Set a deadline.** A strangle with no end date drifts into the 80% trap. Put a date on "old path deleted" and track slices burned down against it.

---

## 3. Observability for routing

You cannot run a safe strangle blind. Instrument three things:

### Routing split — *which path served each call*

```java
String impl = flags.isOn("pricing.new-tax") ? "new" : "legacy";
metrics.counter("pricing.requests", "impl", impl, "slice", "tax").increment();
```

A dashboard of new% vs legacy% per slice tells you the real ramp state — not what the config *says*, but what actually ran. It also catches the surprise: a slice you thought was at 100% still serving 0.3% legacy means there's a route you missed (the tombstone of senior §4).

### Diff rate — *how often new disagrees with old*

```java
if (shadow) {
    boolean match = approxEqual(authoritative, candidate);
    metrics.counter("pricing.diff", "slice", "tax", "match", String.valueOf(match)).increment();
    if (!match) diffRecorder.record(req, authoritative, candidate);
}
```

Ramp the slice only while the diff rate is at or near zero. A rising diff rate is your stop signal.

### Business and health metrics per path

Tag your existing business metrics (revenue, error rate, latency) by `impl` so you can compare old vs new on the metrics that matter, not just on output equality. A new path that matches outputs but doubles p99 latency is not ready.

---

## 4. Rollback

The flag *is* the rollback, and that is the strangler's signature advantage over a cutover. But a rollback is only real if you've made it real:

1. **Flip-to-old must be instant and deploy-free.** If "rollback" requires a deploy, you don't have one — you have a slow fix.
2. **Old path stays runnable until deletion.** The moment you delete the legacy branch, you lose the rollback. Keep it until runtime evidence says the slice is dead (senior §4).
3. **Rollback must be state-safe.** If the new path wrote state the old path can't read, flipping back leaves orphaned or inconsistent state. This is why senior §3 insists on single-writer ownership during transition — it keeps rollback clean.
4. **Rehearse it.** Flip a slice off in staging (or briefly in prod during low traffic) and confirm metrics return to baseline. An untested rollback is a hope.

```java
// Rollback is one config change away — no deploy.
flags.force("pricing.new-tax", false);   // back on legacy in seconds
```

---

## 5. Real-world incremental-replacement playbook

A repeatable sequence for strangling a code-level subsystem in production:

1. **Justify.** Write down the carrying cost vs cutover risk. If cutover wins, stop here and cut over.
2. **Map the boundary.** Enumerate entry points and shared state (Mikado, sibling 03).
3. **Insert the seam.** Facade/adapter at the choke point; route all callers through it; ship — behavior unchanged.
4. **Instrument.** Routing split, diff rate, per-path business metrics — *before* the first divert.
5. **Plumbing slice.** Migrate one low-risk, high-traffic slice behind a flag to prove seam + flags + shadow + metrics + rollback end to end.
6. **Shadow then canary.** For each slice: characterization tests → shadow (read-only) → 1% → 10% → 100%, watching diff rate and business metrics, with the parity test in CI.
7. **Burn down slices** in dependency-then-risk order; reads before writes; riskiest last.
8. **Tombstone and wait.** Log/metric the old path; wait a full business cycle for zero hits.
9. **Delete everything transitional** — old code, dead branches, flags, shadow harness, old-vs-new parity tests — and simplify the seam.
10. **Close the project.** "Old path deleted" is the definition of done. Until then, it's not finished.

---

## 6. When NOT to strangle (professional view)

- **Cutover is cheap and safe** → the strangler's carrying cost and observability overhead are pure waste.
- **No deploy-free rollback is possible** → you lose the strangler's main benefit; reassess whether incremental routing helps at all.
- **Long transition × high change rate** → double-maintenance dominates; cut over or compress.
- **Shared state can't be made single-writer** → rollback isn't state-safe; cut over behind one switch instead.
- **No organizational will to finish** → an unfinished strangle is worse than none; if the team won't fund step 8–10, don't start.

---

## Next

- Sibling **Branch by Abstraction** (`../01-branch-by-abstraction/`) — lower carrying cost when one interface fits both.
- Sibling **Keeping the System Shippable** (`../05-keeping-the-system-shippable/`) — the trunk-based discipline that makes deploy-free rollback possible.
- Sibling **Parallel Change (Expand/Contract)** (`../02-parallel-change-expand-contract/`) — the same expand/contract economics for interface changes.
- Seam patterns: [Refactoring to Patterns: Structural](../../03-refactoring-to-patterns/03-structural/junior.md), [Facade](../../../design-patterns/02-structural/05-facade/junior.md), [Adapter](../../../design-patterns/02-structural/01-adapter/junior.md).
- Continue to [interview.md](interview.md) for the Q&A drill.
