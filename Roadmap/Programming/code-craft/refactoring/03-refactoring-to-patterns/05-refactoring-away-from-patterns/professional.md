# Refactoring Away From Patterns — Professional Level

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); Sandi Metz, "The Wrong Abstraction" (2016); Ward Cunningham on technical debt (1992).

At the professional level, "this is over-engineered" must become a number, a budget line, and a risk plan. A staff engineer arguing to delete an abstraction layer is competing for the same time as feature work, and "it's cleaner" loses that argument. This level makes the case in the language leadership funds: **carrying cost**, **technical debt**, **measured performance**, and **risk-managed change**.

## Measuring the carrying cost of a needless pattern

Every needless abstraction is a recurring liability. Make each component explicit so the total is undeniable.

**Indirection / reading cost.** The dominant cost. With code read roughly 10x more than written, a layer that adds one navigation hop per read is taxed on every read by every engineer, forever. Estimate it: *hops added × reads per month × engineers × minutes per hop.* A one-implementor interface that adds one "go to implementation" hop, read 20 times a month across an 8-person team at ~1 minute of context-switch each, is ~160 minutes/month — ~32 hours/year of pure navigation, for an interface delivering zero variation. That is a fundable number.

**Onboarding cost.** New hires must learn the codebase's *invented* abstractions before they're productive. Pattern fever inflates time-to-first-meaningful-PR. If you track ramp-up, correlate it with abstraction density; teams that cut speculative layers routinely report faster onboarding because there's simply less invented vocabulary to absorb.

**Debugging cost.** Indirection lengthens the path from symptom to cause. A stack trace through a Strategy, a Factory, and two Decorators is longer to walk than a stack trace through one class; dynamic dispatch hides *which* implementation ran. During an incident, every extra hop is minutes of MTTR while the system is degraded — the most expensive minutes you spend. Needless indirection directly inflates incident duration.

**Runtime cost (allocation + dispatch).** Each pattern layer typically adds an object allocation (the wrapper, the strategy instance, the listener) and a virtual/interface dispatch. Per call this is nanoseconds. In a hot path — a pricing loop over a million line items, a request handler at 50k RPS — it compounds into measurable latency, GC pressure, and cloud spend. Quantified below.

**Change-amplification cost.** A field added to a product type fans out across the interface, the implementor, the factory, and the base class — four edits for one logical change. Track it via *files-touched-per-change* on the module; high counts on a low-variation module are the signature of structure that amplifies rather than absorbs change.

## Tech-debt framing of over-engineering

The crucial reframing for stakeholders: **over-engineering is technical debt, exactly like under-engineering.** Cunningham's debt metaphor is usually invoked for shortcuts, but a speculative abstraction is debt too — you "borrowed" complexity against a future that hasn't arrived, and you pay interest (the carrying costs above) every sprint until it does or you remove it.

This reframing matters because over-engineering is *socially camouflaged*. Messy, under-built code looks like debt and gets debt's scrutiny. A tidy, heavily-patterned, "enterprise-grade" module looks like *quality* and escapes scrutiny — yet it can carry more interest than the mess, because it's larger, more coupled, and scarier to change. Name it on the same ledger:

- **Principal:** the work to remove the abstraction (the simplification campaign).
- **Interest:** the per-sprint carrying cost (reading, onboarding, debugging, change-amplification, runtime).
- **Risk premium:** the chance the abstraction's hidden behavior bites you during an unrelated change.

A speculative abstraction with high interest and a near-zero chance of ever being needed is a *bad loan you should pay off*. Putting it on the same backlog as under-engineering debt — with the same prioritization math — is how you win the time to remove it.

## Performance wins from removing indirection — measured

Indirection's runtime cost is real but *must be measured*, never assumed — premature de-optimization is as much a sin as premature optimization. The professional discipline: **profile, find the indirection is actually hot, remove it, re-measure, keep the change only if the benchmark moved.** ([Profiling techniques](../../../design-principles/) apply.)

Where removing indirection reliably pays off:

- **Hot loops with per-element dispatch.** A pricing pipeline modeled as a Decorator chain (`Rounding(Tax(Base))`) does, per line item, two extra interface dispatches and walks two wrapper allocations. Over a million-item batch that's millions of megamorphic calls the JIT can't inline. Folding the always-on decorators into the base often cuts the loop's time meaningfully and removes the wrapper allocations from the GC's path. Measure with [JMH](../../../design-principles/), not intuition.
- **Megamorphic call sites.** A Strategy interface with one implementor is *monomorphic* — the JIT inlines it and the abstraction is nearly free. But a Strategy interface that the JVM sees called with *many* implementors at one site becomes megamorphic; dispatch can't be inlined and costs real cycles. If profiling fingers such a site, collapsing the polymorphism (or splitting the call sites so each is monomorphic) is a legitimate, measurable optimization.
- **Allocation pressure from wrappers.** Per-request Decorator/Strategy objects created on a hot path generate short-lived garbage. Removing the wrappers cuts allocation rate, which cuts GC frequency and tail latency. Confirm with allocation profiling.

The honest caveat for stakeholders: for the *vast majority* of code, indirection's runtime cost is negligible and removing it for speed is wasted effort — the real wins from removal are the *human* costs (reading, debugging, onboarding). Lead with those. Reserve the performance argument for paths you've *profiled and proven* hot; there it can be decisive (and it makes a crisp, defensible benchmark to put in the PR).

## Risk management when deleting widely-used seams

The wider an abstraction's reach, the higher the blast radius of removing it. Manage the risk like any production change:

1. **Map the blast radius first.** Count callers, find every implementor (including test fakes and reflection/DI-wired ones a grep misses), and identify external consumers. An abstraction used by other teams or published as API is a *contract*, not just an internal seam — its removal is a breaking change requiring deprecation, not a refactor.
2. **Land the safety net before the change.** Characterization/integration tests at the *kept* boundary ([middle.md](middle.md)). For a seam touching money, auth, or data integrity, also stage *shadow comparison*: run old and new paths in parallel in production, log divergences, and only cut over when they agree. This catches the incidental behaviors (init order, exception swallowing, side effects) that tests miss.
3. **Sequence as small reversible steps.** Migrate callers in batches behind a flag; each batch is independently shippable and revertable ([senior.md](senior.md)'s strangler-for-removal). Never a single big-bang deletion across a widely-used seam.
4. **Have a rollback that's faster than a fix-forward.** Keep the old path alive (flag-off) until the new path has soaked in production. Deleting the old code is the *last* step, taken only after confidence is earned. The seam you're removing is load-bearing; treat its removal with deploy-grade caution, not editor-grade casualness.
5. **Communicate the deprecation for shared seams.** Announce, give a migration window and a codemod if you can, mark `@Deprecated` with a pointer to the replacement, *then* remove. The engineering is the easy part; not surprising a downstream team is the professional part.

The asymmetry to respect: removing structure is *higher-risk per line* than adding it, because you're relying on the assertion "no one needs this," and absence is hard to prove. That's not an argument against removal — carrying dead abstractions has its own compounding cost — it's an argument for *doing it with production discipline*: measure, stage, soak, then delete.

## Next

- [interview.md](interview.md) — Q&A on over-engineering economics, the wrong-abstraction tax, safe Singleton removal, YAGNI vs future-proofing.
- [senior.md](senior.md) — essential vs accidental complexity, paying down the wrong abstraction, sequencing a large simplification, team buy-in.
- [middle.md](middle.md) — Decorator/interface/Observer removals, Rule of Three, characterization tests, cost model of indirection.
- [junior.md](junior.md) — foundational removals and the "earning its keep" checklist.
- [tasks.md](tasks.md) · [find-bug.md](find-bug.md) · [optimize.md](optimize.md)
- Related: [Anti-patterns: over-engineering](../../../anti-patterns/) · [Design principles: KISS/YAGNI](../../../design-principles/)
