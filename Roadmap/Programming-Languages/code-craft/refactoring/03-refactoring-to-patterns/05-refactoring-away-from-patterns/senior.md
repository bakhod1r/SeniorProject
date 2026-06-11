# Refactoring Away From Patterns — Senior Level

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); Sandi Metz, "The Wrong Abstraction" (2016); Fred Brooks, "No Silver Bullet" (1986) on essential vs accidental complexity.

[Junior](junior.md) and [middle](middle.md) taught the individual removals. At senior level the question is no longer "how do I inline this Strategy" but "*should* this whole abstraction layer exist, who decides, and how do I retire it across a codebase a team depends on without breaking them or losing their trust?" This is judgment work: separating complexity that's intrinsic to the problem from complexity we added ourselves, recognizing the wrong-abstraction tax and paying it down deliberately, and treating **de-abstraction as a legitimate architectural move** — not a confession.

## Essential vs accidental complexity

Brooks' distinction is the sharpest tool you have for deciding whether a pattern stays. **Essential complexity** is inherent in the problem: a payroll system *must* handle multiple tax jurisdictions, retroactive corrections, and pay frequencies — no amount of cleverness removes that; the best you can do is *model it honestly*. **Accidental complexity** is what we add: the layers, the indirections, the cleverness that exists because of *how we built it*, not *what it is*.

Patterns are a tool for *organizing essential complexity* — Strategy gives the many real tax algorithms a home, Decorator composes the genuinely-optional embellishments. The failure mode is using patterns to add **accidental** complexity: a Strategy interface for one algorithm, a plugin architecture for one plugin, a configurable rules engine for three `if` statements. That accidental complexity *masquerades* as essential because it looks like the patterns you'd legitimately use for a hard problem.

The senior discipline is to keep asking: *does this structure reflect a distinction the domain actually makes, or a distinction we invented?* When you remove a pattern, you're asserting "this complexity was accidental — the domain doesn't actually vary here." You must be right about the domain, which is why these decisions belong to people who understand it, not to whoever read the most pattern books.

A useful test: imagine explaining the abstraction to a domain expert (an accountant, a clinician, a logistics planner). If they'd nod — "yes, discounts really do come in those distinct kinds" — the structure reflects essential complexity; keep it. If they'd be baffled — "why are there four classes for one fixed rule?" — it's accidental; it's a candidate for removal.

## The wrong-abstraction tax and how to pay it down

Sandi Metz's "The Wrong Abstraction" (2016) is the essay every senior should internalize. Her sequence:

1. A programmer sees duplication and extracts an abstraction. Good instinct.
2. New requirements arrive that *almost* fit. The abstraction is *almost* right, so people add a parameter, a flag, a conditional inside it to handle the new case.
3. Repeat. The abstraction accretes parameters and branches until it's a tangle of special cases — a `render(thing, isAdmin, skipHeader, legacyMode, ...)` that no longer abstracts anything; it just dispatches.
4. Now it's terrifying to touch, because it's used everywhere and does subtly different things per caller. So people add *more* flags rather than untangle it. The tax compounds.

Her two famous conclusions:

> **"Duplication is far cheaper than the wrong abstraction."**
> **"Prefer duplication over the wrong abstraction."**

And critically, her advice on *how to recover* — the move most engineers won't make: **re-inline the abstraction.** Don't try to fix the tangled abstraction in place. Instead:

1. **Inline the abstracted code back into each caller.** Each call site gets its own copy of what the abstraction did, with that caller's specific flags resolved to concrete behavior (the `isAdmin=true` branch becomes just the admin code, inline, at the admin caller).
2. **Delete the dead branches** at each site — each caller only needed one path through the conditional jungle.
3. **Now you have honest duplication.** Look at it fresh. The *right* abstraction (if any) is often obvious now that you can see the real, divergent cases side by side — and it's frequently *different* from the wrong one you removed, and *smaller*.

This is de-abstraction as a *path back to good design*, not as a retreat. You deliberately go from "one wrong abstraction" to "N honest duplicates" precisely because the duplicates tell the truth and the abstraction lied. The wrong abstraction's tax is paid down by demolishing it back to ground and, only if warranted, rebuilding to fit reality.

The hardest part is *psychological*. Re-inlining feels like going backward; the abstraction was someone's good work; deleting code feels like waste. Metz's framing — the sunk cost of the existing abstraction is irrelevant; what matters is the *forward* cost of keeping versus removing it — is what gives a senior license to delete.

## De-abstraction as a deliberate architectural move

Architectures over-abstract for predictable reasons, and recognizing the *category* helps you argue for removal:

- **The framework that fits one app.** An internal "platform" built to support many future products that only ever hosts one. The abstraction layer (plugin SPI, config DSL, generic pipeline) is pure carrying cost. Removing it means collapsing the framework into the single app it serves — often deleting 40% of the code.
- **The premature service boundary.** A module split into a separate service "for scalability" before any scaling pressure existed, paying network latency, serialization, partial-failure handling, and distributed-debugging costs to solve a problem you don't have. The de-abstraction is to *merge it back* into the monolith (the "monolith-first" / right-sizing move). This is removing a *distributed-systems pattern* that isn't earning its keep — the same judgment at a larger grain.
- **The inner-platform effect.** A configurable rules engine, workflow engine, or entity-attribute-value schema that reimplements the language/database you already have, worse. De-abstraction replaces the engine with plain code in the host language. (See [anti-patterns: inner-platform / over-engineering](../../../anti-patterns/).)

The senior framing: **the simplest design that meets the *current, real* requirements is the target, and the requirement set changes over time.** A pattern that fit last year's requirements can stop fitting; removing it is then *responsive* design, not regression. You're not "tearing down good work" — you're keeping the design matched to the requirements, in both directions.

## Sequencing a large simplification

Removing one Singleton is a tactical edit. Retiring an abstraction layer that 200 files depend on is a *campaign*. Sequence it so the codebase compiles and ships green at every step:

1. **Establish the safety net first.** Characterization tests ([middle.md](middle.md)) at the boundary you'll *keep* — the public behavior, not the seam you're deleting. If integration coverage is thin, add it before you start. You cannot safely simplify what you can't observe.
2. **Make the new (simpler) path coexist with the old.** Don't flip everything at once. Introduce the direct call alongside the abstracted one; migrate callers in small batches; keep both green. This is the *Branch by Abstraction* / *Strangler* technique applied to *removal* — you strangle the abstraction by routing callers around it.
3. **Migrate leaf callers before hub callers.** Convert the code with the fewest dependents first; each conversion shrinks the blast radius of the next.
4. **Delete the abstraction only when its caller count hits zero.** A dead abstraction with no callers is a trivially safe delete. Getting to zero callers is the whole job; the final `git rm` is anticlimactic, which is the goal.
5. **One reviewable change per logical step.** A 4,000-line "simplification" PR is unreviewable and unrevertable. A sequence of small PRs ("migrate batch 3 of N off `ReportFactory`") is both. Each lands independently; if one regresses, you revert *it*, not the campaign.

Watch the failure mode where removing the abstraction *reveals* that callers were quietly relying on its incidental behavior — the Singleton's lazy-init order, the Decorator's wrapping side effect, the Observer's exception-swallowing. The characterization tests catch the obvious cases; for the subtle ones, ship behind a flag and watch production before deleting the old path.

## Getting a team to agree to delete abstractions

The technical removal is the easy half. The hard half is *organizational*: abstractions have authors, advocates, and inertia. "We might need it" is unfalsifiable and emotionally safe; "delete it" requires someone to be wrong. How seniors get a team to yes:

- **Lead with carrying cost, not aesthetics.** "This is over-engineered" is an opinion and starts a fight. "This interface has one implementor, forces a mock in 14 tests, and adds a hop every reader takes — and in two years no second implementor appeared" is evidence. Quantify the tax ([professional.md](professional.md)).
- **Make removal *reversible* and say so.** "It's in git; if a second implementor shows up next quarter, re-adding the interface is a 20-minute, mechanical change — far cheaper than carrying it idle for two years." This dissolves the loss-aversion that keeps dead abstractions alive: people hoard structure because re-adding feels expensive, so prove it's cheap.
- **Use the Rule of Three as shared, neutral language.** A team that agrees "we abstract at three real cases, not one imagined one" has a *rule* to point at instead of relitigating each case as a clash of personalities.
- **Separate uniqueness/seam decisions from access decisions.** Often the disagreement dissolves once you clarify you're removing *global static access* (everyone agrees that hurts tests), not the object's uniqueness (which they wanted to protect). Naming the actual axis of disagreement resolves most of these.
- **Respect Chesterton's Fence.** Before removing an abstraction, find out *why it's there.* Some one-implementor interfaces encode a hard-won architectural boundary, satisfy a compliance requirement, or exist because the second implementor was deleted last month and is coming back. If you can't explain why the fence was built, you haven't earned the right to remove it. This is also the strongest *argument* — once you *can* explain it and show the reason no longer holds, the case for removal is airtight.
- **Pilot, then generalize.** Remove one instance, let the team see the simpler code and unchanged behavior, then propose the pattern of removal. A demonstrated win converts skeptics faster than a design doc.

## Next

- [professional.md](professional.md) — quantifying carrying cost, tech-debt framing, measured performance wins, production risk management.
- [middle.md](middle.md) — Decorator/interface/Observer removals, Rule of Three, characterization tests, the cost model of indirection.
- [junior.md](junior.md) — the foundational removals and the "earning its keep" checklist.
- [interview.md](interview.md) · [tasks.md](tasks.md) · [find-bug.md](find-bug.md) · [optimize.md](optimize.md)
- Related: [When to Refactor *to* Patterns](../01-when-to-refactor-to-patterns/junior.md) · [Anti-patterns: over-engineering / inner-platform](../../../anti-patterns/) · [Design principles: KISS/YAGNI](../../../design-principles/)
