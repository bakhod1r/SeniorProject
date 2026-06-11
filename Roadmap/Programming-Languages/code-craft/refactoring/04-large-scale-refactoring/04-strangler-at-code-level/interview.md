# Strangler at the Code Level — Interview

> **Source:** Martin Fowler, "StranglerFigApplication", martinfowler.com/bliki/StranglerFigApplication.html

Questions are ordered roughly junior → senior. Each has a model answer; the strongest answers name the trade-off, not just the technique.

---

### Q1. Explain the Strangler Fig pattern at the code level in one or two sentences.

Grow a new implementation alongside the old one, divert callers from old to new in small slices, verify each slice produces identical results, and delete the old code once nothing reaches it. The system compiles, passes tests, and ships after every step — there is never a broken half-migrated state.

---

### Q2. Where does the name come from, and where can the analogy mislead?

A strangler fig grows around a host tree and eventually replaces it, leaving the host hollow and gone. The migration analogy: build new around old, divert as parts become ready, remove old when unused. It misleads if you read "strangler" as passive and automatic — *you* control every diversion, nothing moves unless you route it, and you can route it back instantly. The fig is slow and one-directional; a good strangle is deliberate and reversible.

---

### Q3. What is a "seam," and why does the strangler need one?

A seam (Feathers) is a place where you can change behavior without editing the code on either side of it. The strangler needs a single seam — a choke point all callers pass through — because that is where the divert condition lives. Without one choke point, your divert only catches some traffic, so you can't reason about which path served a request or trust a parity claim.

---

### Q4. What kinds of seams can you use in-process?

Facade (same-API wrapper forwarding to old code) when callers converge on a small API; adapter (translating wrapper) when old and new have different shapes; event interception (route a dispatched event to old or new) in event-driven code; asset-capture (a wrapper owning a resource and routing its reads/writes) when you're really migrating data ownership. In-process the facade/adapter is usually the cheapest and most natural.

---

### Q5. Strangler vs Branch by Abstraction — what's the difference and when does each fit?

Branch by Abstraction puts one interface over the thing you're changing, makes everyone depend on it, builds a new implementation behind the *same* interface, and swaps the implementation. One seam, swap behind it. Strangler grows a *parallel* implementation and diverts callers slice by slice; old and new may have different shapes. Use branch-by-abstraction when a single clean interface naturally fits both old and new and you'll swap wholesale. Use strangler when the new design wants a different shape, or you need partial/percentage rollout with shadowing and per-slice rollback. They combine: the strangler's seam is often an abstraction.

---

### Q6. How is code-level strangling different from service-level strangling?

At service level the old and new systems usually have separate datastores, so the main risk is routing and request parity. In-process, old and new code frequently touch the **same** mutable objects, caches, and statics — so output parity is not enough; you can produce correct results while corrupting shared state. The defining extra discipline at code level is managing shared state: keep the new path pure during transition, give each state field a single writer, and shadow on copies.

---

### Q7. What's the difference between slicing by data and slicing by behavior?

Slicing by data routes specific *inputs* to the new code (digital-goods orders, region EU, requests over a threshold) — useful to limit blast radius by population while the behavior is meant to be identical. Slicing by behavior routes a specific *step* to new code (the tax calc, the discount rule) while the rest stays old — useful when rebuilding internals one responsibility at a time. Both are valid; choose whichever gives a small, independently verifiable, independently routable change.

---

### Q8. How do you prove parity without risking production?

Three tiers. Characterization/diff tests offline: same inputs to old and new, assert equal, using real (anonymized) production samples for the edge cases. Shadowing online: run new alongside old in production, return only old, log disagreements — off the hot path, side-effect-free. Canary divert: make new authoritative for a tiny flagged slice and ramp 1%→10%→100% while watching the diff rate and business metrics. The progression takes you from "I understand the old behavior" to "I've seen the new behavior on real traffic" to "it's safe to make authoritative."

---

### Q9. Why is shadowing dangerous, and when can't you do it?

Shadowing runs the new code for real. If the new path has side effects — writes to a DB, charges a card, sends email, or mutates a shared in-memory object — running it "just to compare" causes those effects. You also risk slowing or failing the real request if shadowing isn't isolated. Don't shadow code with side effects unless you make it pure for the comparison (compute, don't commit) or run it on a deep copy of any state it mutates. Otherwise skip to a tiny canary with real rollback.

---

### Q10. Why should the divert condition be a feature flag rather than a hard-coded `if`?

A flag lets you ramp gradually and, crucially, *roll back without a deploy* — flipping the flag off returns you to the old path in seconds. A hard-coded `if` requires a code change and deploy to change routing, so your "rollback" is a slow fix. The flag is the strangler's signature safety mechanism. The cost: each flag is a tested branch you must remove once the slice hits 100% — a flag with only one live branch is dead weight.

---

### Q11. How do you decide the *order* in which to migrate slices?

Plumbing-first: migrate one low-risk, high-traffic slice early purely to prove the seam, flags, shadow, metrics, and rollback work end to end. Then dependencies before dependents (don't trust B's parity until the A it depends on is stable), reads before writes (diverting a read is reversible; a write changes state), and riskiest slice last and smallest (migrate the scary edge case when the machinery is battle-tested). If two slices depend on each other cyclically, you can't order them — break the cycle or cut them over together.

---

### Q12. How do you know the old code is *truly* dead and safe to delete?

Truly dead means no reachable path invokes it. Static "find usages" showing zero callers is necessary but not sufficient — reflection, DI-by-config, and serialization hide callers. Confirm the flag is permanently on with no config path back, then add a tombstone (log + metric) on the old path and run it in production for a full business cycle, including month-end and rare batch jobs. Zero hits over a representative period is the real evidence. Only then delete the old code, the dead branch, the flag, the shadow harness, and the now-obsolete parity tests.

---

### Q13. What is the "80% strangle" and why is it worse than not starting?

It's a migration where the easy slices were migrated and the hard ones abandoned, leaving both paths live indefinitely. It's worse than not starting because you pay double-maintenance — every fix and feature done twice — plus permanent routing complexity, with none of the payoff of a finished migration. The cure is treating the strangle as a project with a deadline and a definition of done ("old path deleted"), and committing to finish the hard slices or not beginning.

---

### Q14. Give two situations where you should NOT strangle and should cut over instead.

(1) A clean cutover is cheap and safe — solid tests, one reviewed commit keeps the build green; the strangler's seam/flags/shadow are pure overhead. (2) There's no stable choke point and creating one is the whole job, or the shared state is so entangled that no slice is independently routable — then cut over behind a single switch (after untangling state if needed) rather than diverting slices. Also: when the transition would be long and the area changes often, double-maintenance can exceed the risk the strangler removes.

---

### Q15. After the migration is done, what cleanup is part of "done"?

Delete the old implementation, remove the now-dead divert branches, remove the feature flags, tear down the shadow harness, and delete the parity tests that compared against the deleted old code (keep tests that pin the *new* behavior). Simplify the seam — if it now wraps a single implementation, it may be removable entirely. A strangle isn't finished until the codebase looks like the strangler never happened, except cleaner.
