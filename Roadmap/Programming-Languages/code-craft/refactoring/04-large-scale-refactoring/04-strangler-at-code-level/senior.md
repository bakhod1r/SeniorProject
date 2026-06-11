# Strangler at the Code Level — Senior

> **Source:** Martin Fowler, "StranglerFigApplication", martinfowler.com/bliki/StranglerFigApplication.html

At this level you are strangling something large — a god-class with eight responsibilities, a legacy calculation engine the whole product depends on, a subsystem that owns shared mutable state. The mechanics are settled; the hard problems are **sequencing**, **shared state between old and new**, and **knowing when the old code is truly dead**. Getting these wrong produces a migration that stalls at 80% forever.

---

## 1. Strangling a large subsystem

A subsystem isn't one seam — it's a *boundary* with many entry points and, usually, shared state behind it. You don't strangle it in one slice; you decompose it into a *sequence* of strangles, each with its own seam, flag, and parity check.

### Map the boundary first

Enumerate every entry point into the subsystem and every piece of state it owns. You cannot route what you can't see. The Mikado Method (sibling 03) is the tool for discovering this graph — each "I can't move this until I move that" becomes a node.

### Decompose into independently stranglable slices

A large subsystem strangle is a *plan*, not a move. Order the slices so that:

- Early slices are **leaf** behaviors — they read shared state but don't mutate it, so diverting them can't corrupt anything.
- State-owning slices come **last**, after everything that reads that state already goes through a controlled path.

```java
// A subsystem seam: a facade over the legacy engine, with per-capability routing.
public class RatingEngine {                 // the boundary
    private final LegacyRating legacy;
    private final NewRating next;
    private final Flags flags;

    public Premium rate(Policy p) {          // entry point 1
        return flags.isOn("rating.premium.new") ? next.rate(p) : legacy.rate(p);
    }
    public Schedule schedule(Policy p) {     // entry point 2 — migrated later
        return legacy.schedule(p);
    }
    // ...more entry points, each with its own flag and timeline...
}
```

Each entry point migrates on its own clock. The subsystem is "strangled" only when every entry point routes to new code and the legacy class is unreferenced.

---

## 2. Sequencing slices

The order of slices is the senior decision. Heuristics:

1. **Plumbing-first.** Migrate one low-risk, high-traffic slice early purely to prove the seam, flags, shadowing, metrics, and rollback all work end to end. Treat it as a dress rehearsal.
2. **Dependencies before dependents.** If slice B reads a value that slice A produces, you cannot trust B's parity until A is stable. Migrate A first, or migrate them together.
3. **Reads before writes.** Diverting a read is reversible and harmless. Diverting a write changes state. Do all the read-only slices first; they de-risk the writes.
4. **Riskiest slice last, smallest.** The scary edge case migrates when your machinery is battle-tested and the slice is as narrow as you can make it.

> **When NOT to (sequencing):** if the slices have a cyclic dependency — A needs B's new output and B needs A's — you can't order them, and incremental divert won't work. Break the cycle first (often by extracting the shared piece into its own seam), or accept a coordinated cutover of A+B together.

---

## 3. Shared state between old and new

This is where code-level strangling gets genuinely hard, and where it differs most from service-level strangling. In a service migration the two systems have separate databases; in-process, **old and new code often touch the same objects, caches, and fields.** If both paths read and write the same mutable state, parity is not enough — you can get correct outputs and corrupt state.

### The failure mode

```java
// Both paths mutate the same accumulator. Shadowing the new path
// DOUBLE-COUNTS into shared state even though we "only compare".
class Cart {
    int loyaltyPointsEarned;   // shared mutable state
}

void process(Cart cart) {
    legacy.applyPoints(cart);        // mutates cart.loyaltyPointsEarned
    if (shadow) next.applyPoints(cart);  // BUG: mutates it again
}
```

### Tactics for shared state

1. **Make the new path pure during transition.** It computes a *value* and returns it; the seam decides whether to commit. Side effects live in one place, chosen by the flag — never in both.

   ```java
   int points = flags.isOn("loyalty.new")
       ? next.computePoints(cart)      // pure: returns a number
       : legacy.computePoints(cart);   // pure: returns a number
   cart.loyaltyPointsEarned = points;  // single commit, owned by the seam
   ```

2. **Shadow on a copy.** If the new code must mutate, give it a deep copy and compare the copy's resulting state to the real one. Never let the shadow touch the authoritative object.

3. **Define ownership of each state field.** During transition, exactly one path *writes* each field. The other may read it but never writes. Document this; violations are the source of the nastiest strangler bugs.

4. **Watch for shared caches and statics.** A `static` cache or a singleton the old code populates and the new code reads (or vice versa) is shared state in disguise. Inventory them with the boundary map.

> **When NOT to strangle (shared state):** if old and new genuinely cannot avoid writing the same mutable state simultaneously, and you can't make either side pure, running both is unsafe at any moment. That's a signal to cut over behind a hard switch instead of diverting a slice at a time.

---

## 4. Knowing when the old code is truly dead

"Truly dead" means *no reachable execution path invokes it*. Verifying this is harder than it sounds, especially with reflection, DI containers, serialization, and flags that might still be on somewhere.

### A checklist for declaring death

1. **Static reachability.** Grep/IDE "find usages" shows no compile-time callers. Necessary but not sufficient — reflection and config-driven instantiation hide callers.
2. **The flag is permanently on and the old branch is unreachable.** If the divert is `flag ? new : old` and the flag has been forced on across all environments for long enough, the `old` branch is dead — but confirm no config can flip it back.
3. **Runtime evidence.** Add a log/metric on entry to the old path (`metrics.counter("legacy.hit")`) and run it in production for a full business cycle — including month-end, year-end, the rare batch job. *Zero hits over a representative period* is the strongest evidence. Code that's only exercised at quarter-close won't show up in a week of traffic.
4. **Then delete** — the class, the old branch, the flag, the shadow harness, and the parity tests that compared against the old code.

```java
// Tombstone the old path before deleting, to gather runtime evidence.
private Result legacyPath(Request r) {
    metrics.counter("strangler.legacy.hit", "slice", "rating").increment();
    log.warn("LEGACY PATH STILL REACHED for {}", r.id());  // should never fire
    return legacy.handle(r);
}
```

If the tombstone fires after you believed the slice was at 100%, you found a route you didn't know about — exactly what this step is for.

> **When NOT to (deleting):** never delete on static analysis alone if the system uses reflection, DI-by-config, or feature flags read from external config. The tombstone-and-wait step is cheap insurance against deleting a path that a quarterly job still uses.

---

## 5. Anti-patterns at scale

- **The 80% strangle.** Easy slices migrated, hard ones abandoned, both paths live forever. Worse than not starting: you pay double-maintenance with no end date. Commit to finishing or don't begin.
- **Seam sprawl.** Every slice gets its own ad-hoc seam in a different style. Standardize the seam shape across the subsystem so readers and tooling can reason about routing uniformly.
- **Parity theater.** Diff tests that only cover the happy path while edge cases route to new code unverified. Parity coverage must match divert scope.
- **State leak.** Old and new both write a shared field; outputs match, state corrupts. The §3 ownership rule prevents it.

---

## 6. When NOT to strangle a subsystem

- The subsystem is small and well-tested → cut over in one reviewed change.
- The state is so entangled that no slice is independently routable → cut over behind a single switch, or first untangle the state (a separate refactor).
- The migration would span quarters and double-maintenance dominates the risk it removes → reduce scope or cut over.
- Cyclic slice dependencies you can't break → coordinated cutover of the cycle.

---

## Next

- Sibling **Branch by Abstraction** (`../01-branch-by-abstraction/`) — often the better tool when the new design fits one interface.
- Sibling **The Mikado Method** (`../03-mikado-method/`) — building the boundary/dependency map a subsystem strangle needs.
- Sibling **Keeping the System Shippable** (`../05-keeping-the-system-shippable/`) — the discipline that lets every slice land on `main`.
- Carving responsibilities out of a god-class: [Moving Features Between Objects](../../02-refactoring-techniques/02-moving-features/junior.md).
- Seam construction: [Refactoring to Patterns: Structural](../../03-refactoring-to-patterns/03-structural/junior.md), [Facade](../../../design-patterns/02-structural/05-facade/junior.md), [Adapter](../../../design-patterns/02-structural/01-adapter/junior.md).
- Continue to [professional.md](professional.md) for economics, observability, and rollback playbooks.
