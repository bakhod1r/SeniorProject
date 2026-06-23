# Branch by Abstraction — Middle

> **Source:** Paul Hammant, "Branch by Abstraction"; Jez Humble & David Farley, *Continuous Delivery*

You know the five phases (if not, read [junior.md](junior.md) first). At this level the question is no longer *how* but *when, how much, and what goes wrong*. Branch by Abstraction is not free — it adds an interface, often a flag, and a period where two implementations coexist. This file is about earning that cost back and avoiding the traps that turn the technique into permanent debt.

---

## When to reach for it

Branch by Abstraction is the right tool when **all** of these hold:

1. **The change is too large to land in one safe commit.** Multiple files, multiple clients, or a replacement that takes days/weeks to build.
2. **The system must stay releasable throughout.** You're on trunk; you can't disappear onto a branch for three weeks.
3. **A clean seam exists or can be cheaply created.** You can name what clients need from the component as an interface.
4. **You can describe both implementations through one contract.** Old and new are *substitutable* — same inputs, same observable outputs (Liskov holds).

If any of these is false, a different approach is probably better — see [the decision table below](#choosing-between-the-family).

---

## Trade-offs

| You gain | You pay |
|---|---|
| Trunk stays green; no big-bang merge | An extra interface (indirection) |
| Small, reviewable PRs | A flag to manage and later remove |
| Instant, low-risk rollback via the flag | A window where two impls coexist (and can drift) |
| The team sees the change evolve | Discipline required to actually finish Phase 5 |
| New impl is independently testable | Temptation to ship dual-write/complex bridging |

The dominant cost is **the coexistence window**. While both implementations live behind the seam, every bug fix and behavior tweak risks being applied to one and not the other. The longer the window, the higher the drift risk. Treat Phase 4→5 as urgent, not "someday."

---

## Variations

### A. No-flag variant (compile-time switch)

For internal components with no need for runtime control, the "switch" is just the composition root choosing which `new` to call. You cut over by editing one line and deploying. Simpler, but cutover is per-deploy and rollback means another deploy. Fine for low-risk, non-customer-facing swaps.

### B. Runtime-flag variant (the default for risky swaps)

The composition root reads a flag. You ramp traffic and roll back in seconds without redeploying. Use this whenever the blast radius is large or the new impl is unproven in production.

### C. Verifying (shadow / dual-run) variant

When correctness is critical, you run **both** implementations and compare, while only the old one's result is returned to the user:

```java
public class ComparingOrderRepository implements OrderRepository {
    private final OrderRepository oldImpl;   // authoritative
    private final OrderRepository newImpl;   // candidate, results compared not returned
    private final Metrics metrics;

    @Override public Order findById(long id) {
        Order authoritative = oldImpl.findById(id);
        try {
            Order candidate = newImpl.findById(id);
            if (!Objects.equals(authoritative, candidate)) {
                metrics.increment("order_repo.mismatch", "method", "findById");
            }
        } catch (RuntimeException e) {
            metrics.increment("order_repo.new_impl_error", "method", "findById");
        }
        return authoritative;   // user always gets the proven result
    }
    // save(...) is trickier — see caveat below
}
```

This is GitHub's "Scientist" pattern in miniature. It buys enormous confidence for reads.

> **When NOT to shadow:** comparison only works cleanly for **idempotent reads**. For writes (`save`), dual-running mutates two stores and you must reconcile them — that's a separate, harder migration (dual-write), not a free comparison. Don't naïvely shadow side-effecting methods.

### D. Per-method migration

Nothing forces you to cut over all of `OrderRepository` at once. You can migrate `findById` to the new impl while `save` still uses the old, using a composite that delegates per method. Useful when the new impl matures unevenly — but it widens the coexistence window, so keep it short.

---

## Pitfalls (and how to avoid them)

### Pitfall 1 — Leaving the abstraction behind as cruft

The migration finishes, the old impl is gone, but the interface remains with exactly one implementation, named for a technology that no longer exists (`OrderRepository` → only `StorageEngineOrderRepository`). Now every reader wonders why the indirection exists.

**Fix:** in Phase 5, *consciously decide* keep-or-inline. Keep the abstraction only if it's a genuinely useful boundary (persistence usually is — it aids testing and future swaps). Otherwise inline it. "We'll clean it up later" means never.

### Pitfall 2 — The immortal flag

The cutover succeeded months ago, but `use-new-order-repo` still sits in the flag system, the config, and the composition root's ternary. Now there's dead branching, a config knob that does nothing, and a trap for the next engineer who toggles it.

**Fix:** treat flag removal as part of the work, not a follow-up. A migration flag has a **death date**. Track it. Some teams add a "flag expiry" lint that fails CI when a migration flag outlives its planned lifetime. See [professional.md](professional.md) for flag lifecycle management.

### Pitfall 3 — The two implementations drift

A bug is reported, someone patches the old impl, and forgets the new one (or vice versa). Now the system behaves differently depending on the flag — and your "instant rollback" rolls back the bug fix too.

**Fix:** keep the coexistence window short. While it's open, code review must explicitly ask "does this change need to land in both implementations?" The shadow/comparing variant (C) catches drift automatically for reads.

### Pitfall 4 — Cutting over before the new impl is trustworthy

Flipping to 100% on day one defeats the purpose. The flag's value is the *ramp* and the *rollback*; using neither is just a riskier deploy.

**Fix:** ramp deliberately (internal → 1% → … → 100%) and watch dashboards at each step. See the rollout playbook in [professional.md](professional.md).

### Pitfall 5 — Forcing a bad contract

If old and new genuinely *can't* share one clean interface (different error semantics, different transactional guarantees, fundamentally different shape), you'll end up with a leaky abstraction full of `if (isNewImpl)` checks. That's a sign the seam is wrong.

**Fix:** either fix the seam (find the contract clients actually depend on, which may be narrower than the old class's full surface) or accept this is a Parallel Change at the *interface* level instead — see [Parallel Change](../02-parallel-change-expand-contract/junior.md).

### Pitfall 6 — Starting without committing to finish

The worst outcome is the abandoned migration: two half-built implementations, a flag at 30%, and the original author gone. The codebase is now *worse* than before you started.

**Fix:** don't start a Branch by Abstraction you aren't resourced to finish. Track it like a project with a clear "done = Phase 5 complete" definition.

---

## Choosing between the family

| Situation | Reach for |
|---|---|
| Swap a whole component, stay on trunk | **Branch by Abstraction** |
| Change a single method / published interface signature | [Parallel Change](../02-parallel-change-expand-contract/junior.md) |
| Replace an entire legacy app/subsystem from the outside | [Strangler at code level](../04-strangler-at-code-level/junior.md) |
| Need to map the dependency graph of a scary change first | [Mikado Method](../03-mikado-method/junior.md) |
| Change is small enough to land atomically | Just do it — no scaffolding |

The new impl behind the seam is frequently selected via the [Strategy pattern](../../../design-patterns/03-behavioral/08-strategy/junior.md); when the new impl has a different interface you must adapt to the seam, that's the [Adapter pattern](../../../design-patterns/02-structural/01-adapter/junior.md).

---

## When NOT to (consolidated)

- Change lands atomically → skip the scaffolding.
- Old and new can't share a clean contract → fix the seam or use Parallel Change at the interface level, not a leaky `if`-laden abstraction.
- No seam exists and clients are deeply tangled → do the seam-creating refactoring *first* (extract methods, break dependencies); *Working with Legacy Code* is the reference.
- You can't commit to reaching Phase 5 → don't start; an abandoned migration is worse than no migration.

---

## Next

- [senior.md](senior.md) — judgment at scale, sequencing multiple efforts, module boundaries.
- [professional.md](professional.md) — flag lifecycle, observability, rollback playbook, team practices.
- [interview.md](interview.md) — questions and model answers.
- [tasks.md](tasks.md) · [find-bug.md](find-bug.md) · [optimize.md](optimize.md)
