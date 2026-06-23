# Branch by Abstraction — Professional

> **Source:** Paul Hammant, "Branch by Abstraction"; Jez Humble & David Farley, *Continuous Delivery*

This file is about running Branch by Abstraction as a real migration in a real organization: the economics that justify it, the flag debt it can create, the observability you need to flip safely, the rollback playbook when the flip goes wrong, and the team practices that keep a fleet of migrations from rotting. The mechanics are in [junior.md](junior.md); the judgment is in [senior.md](senior.md). This is operations.

---

## The economics: why this is cheaper than it looks

The instinct that Branch by Abstraction is "more work" compares it to the *happy path* of a feature branch. The honest comparison includes the tail.

**Cost of the long-lived branch** is dominated by the rare-but-catastrophic outcomes: the multi-day merge conflict resolution, the big-bang cutover that breaks production for everyone at once, the revert-the-giant-merge rollback. These are low-probability, high-cost events — and you pay the *expected* cost (probability × magnitude) every time.

**Cost of Branch by Abstraction** is steady and small: an extra interface, a temporary flag, slightly more code review across many small PRs. In exchange the catastrophic tail is *removed* — there's no big merge, cutover is incremental, rollback is a flag flip.

The trade is "a known, modest, continuous cost" for "the elimination of a rare, severe, discontinuous cost." For any change large enough to need it, that trade is strongly positive. The technique is, in risk terms, buying insurance — and the premium is small.

The one place the economics flip negative is **the abandoned migration**: you pay the continuous cost *and* keep the coexistence risk forever. That's why "don't start what you won't finish" is an economic statement, not a moral one.

---

## Flag lifecycle and debt

A migration flag has a **birth, a job, and a death date**. Managing that lifecycle is where most teams accrue debt.

| Stage | State | Action |
|---|---|---|
| Born | default OFF, new impl dormant | Register flag with an owner and an expiry date |
| Ramping | 1% → 100% | Watch dashboards; record decisions |
| Baked | 100% stable for N days | Mark for removal; the old path is now dead weight |
| Dead | flag + old impl + branching removed | Close the migration |

Discipline that keeps flag debt down:

- **Every migration flag has an owner and an expiry date** recorded at creation. Ownerless flags become immortal.
- **Migration flags are not config flags.** Don't conflate a short-lived cutover toggle (meant to die) with a permanent operational switch (meant to live). Name and categorize them differently so cleanup tooling can tell them apart.
- **Automate expiry pressure.** A CI lint or a scheduled report that flags migration toggles past their expiry date turns "we'll clean it up" into a tracked, failing-build obligation. Companies running thousands of flags (e.g., as documented in trunk-based-development practice) treat stale-flag detection as table stakes.
- **Removal is in the definition of done.** The migration ticket isn't closed until the flag, the old impl, and the branching code are gone. See Phase 5 in [junior.md](junior.md).

> **When NOT to flag at all:** for a low-risk internal swap, a runtime flag is overhead you'll have to pay down. A one-line composition-root change shipped through normal CI/CD may be the right, lower-debt choice. Reserve runtime flags for swaps whose blast radius justifies ramp-and-rollback.

---

## Observability during the swap

You cannot safely flip what you cannot see. Before Phase 4, instrument so that "is the new impl behaving?" is answerable from a dashboard, not from intuition.

Minimum signal, tagged by which implementation served the request:

- **Error rate** — new impl vs old, same metric, dimensioned by `impl`.
- **Latency** — p50/p95/p99 per impl. A new impl that's correct but 3× slower is still a failed cutover.
- **Correctness** — where you can, the shadow/comparing approach (see [middle.md](middle.md), variant C) emits a mismatch counter. For reads this is the single most valuable signal: it tells you the new impl agrees with the proven one *before* you trust it.
- **Throughput / saturation** of any new downstream the new impl talks to (a new storage engine, a new external service).

Practical instrumentation:

```java
public class StorageEngineOrderRepository implements OrderRepository {
    private final StorageEngineClient client;
    private final Metrics metrics;

    @Override public Order findById(long id) {
        long start = System.nanoTime();
        try {
            Order o = client.fetchOrder(id);
            metrics.timing("order_repo.findById", System.nanoTime() - start, "impl", "storage_engine");
            return o;
        } catch (RuntimeException e) {
            metrics.increment("order_repo.error", "impl", "storage_engine", "method", "findById");
            throw e;
        }
    }
}
```

The `impl` dimension is the point: every chart can be split old-vs-new, so during the ramp you compare the two side by side on identical traffic.

---

## Rollback playbook

The whole reason for the flag is that rollback is *cheap and instant*. Have the playbook written **before** you ramp, not during the incident.

1. **Trigger conditions, pre-agreed.** Define the numbers that mean "abort" *before* flipping: e.g., new-impl error rate > old by X%, p99 latency regression > Y%, any data-correctness mismatch above threshold. Pre-deciding removes judgment under pressure.
2. **Flip the flag to OFF.** This routes 100% of traffic back to the proven old implementation. No deploy, no merge revert — seconds, not minutes. This is the action that makes Branch by Abstraction safe.
3. **Confirm recovery.** Watch the same dashboards return to baseline. The old path is known-good, so recovery should be immediate; if it isn't, the problem may not be the new impl.
4. **Preserve evidence.** Capture the mismatch logs, error samples, and traces from the failed window *before* they age out. You'll need them to diagnose.
5. **Diagnose off the hot path.** Fix the new impl behind the (now-off) flag. Re-ramp from a low percentage; don't jump back to 100%.
6. **Account for in-flight state.** For read-only swaps, flipping is clean. For write paths, a rollback after the new impl has written somewhere means you must reconcile what each store now holds — this is why write-path cutovers demand extra care and often a dual-write/reconciliation plan rather than a naïve flag. Know your data-consistency story before you flip writes.

> **Rollback caveat:** the flag rolls back the *implementation*, not the *data*. If the new impl wrote to a new store, flipping back doesn't un-write it. Design the write-path migration so that a rollback leaves data in a recoverable state — or keep the old store authoritative until you've fully cut over.

---

## Real-world team practices

- **Trunk-based development is the home turf.** Branch by Abstraction exists to make large changes compatible with "everyone integrates to trunk daily." If your team lives on long-lived branches, you'll feel the technique fighting your workflow; the two are designed together. See [Keeping the system shippable](../05-keeping-the-system-shippable/junior.md).
- **Small PRs, frequent merges.** Each phase decomposes into many small PRs (one per migrated client, etc.). This keeps review fast and trunk continuously green — the opposite of one unreviewable mega-diff.
- **Document the migration's "you are here."** A short living doc — current phase, flag percentage, owner, expiry — lets anyone on the team understand the half-migrated state. Half-migrated code is confusing precisely because it looks like two ways to do one thing; the doc explains why.
- **Code review asks the coexistence question.** While both impls live, every relevant PR is reviewed with "does this need to land in both?" to prevent drift (see [middle.md](middle.md), Pitfall 3).
- **Migrations are tracked to completion like projects.** A migration at "95% rolled out" for two quarters is an incident waiting to happen and a perpetual drift risk. Sequencing and WIP limits across multiple migrations are covered in [senior.md](senior.md).
- **Bake before you delete.** Let the new impl run at 100% long enough to survive a full business cycle (a month-end, a peak day) before deleting the old path. The old impl is your rollback option; don't discard it until you're sure you won't need it.

---

## When NOT to (professional framing)

- **Low-risk swap** → skip the runtime flag; ship via normal CI/CD to avoid flag debt.
- **Write-path swap without a data-consistency plan** → the flag rolls back code, not data; design reconciliation first or keep the old store authoritative.
- **Team can't fund Phase 5** → don't start; the abandoned-migration economics are strictly worse than not migrating.
- **No observability on the component** → instrument *before* Phase 4; flipping blind defeats the safety the technique is meant to provide.

---

## Next

- [interview.md](interview.md) — questions and model answers.
- [tasks.md](tasks.md) · [find-bug.md](find-bug.md) · [optimize.md](optimize.md)
- Back to: [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md)
- Related: [Parallel Change](../02-parallel-change-expand-contract/junior.md) · [Strangler at code level](../04-strangler-at-code-level/junior.md) · [Mikado Method](../03-mikado-method/junior.md)
