# Keeping the System Shippable — Interview

> **Source:** Jez Humble & David Farley, *Continuous Delivery*; Martin Fowler, "FeatureToggle" & "ContinuousIntegration"

Model answers below. They're written the way a strong candidate would *speak* them — claim, reason, concrete example, and the trade-off — not as textbook definitions.

---

### Q1. State the core principle of large-scale refactoring on a shared codebase in one sentence.

**A.** A large refactoring is a sequence of small, individually shippable, behavior-preserving commits, and trunk stays releasable after *every* one of them — you could deploy at any point, even halfway through. The whole discipline exists to never let trunk go red.

---

### Q2. A junior wants to do a two-week refactor on a feature branch and merge at the end. Talk them out of it.

**A.** A long-lived branch loses the two things that make change safe: small batch size and continuous integration. While the branch lives, trunk drifts, so the merge becomes a big risky event where *all* the risk lands at once and you can't attribute a regression to any single change. You also get zero integration feedback until the end, so design mistakes surface when they're expensive. The alternative — put the half-done work on trunk behind an OFF feature flag — *feels* scarier but is far safer: each step is tiny, reviewed, green, and revertible, and the unfinished code ships as harmless latent code. Branches should live hours, not weeks.

---

### Q3. What's the difference between "shippable" and "feature complete"?

**A.** Shippable means "I could deploy this commit to production right now with no user-facing breakage." Feature complete means "the feature is fully built and on." They're independent. You ship shippable-but-incomplete code constantly — a half-built feature behind an OFF flag is shippable (it does nothing) but not complete. Conflating them is what pushes people toward big-bang branches: they think they can't ship until it's done. With flags and additive change, you ship the *whole journey*, not just the destination.

---

### Q4. Explain expand → migrate → contract and why ordering matters.

**A.** It's the shape of an additive change. *Expand*: add the new thing (method, column, implementation) alongside the old — both work. *Migrate*: move callers from old to new one at a time — both still work after each step. *Contract*: once nothing uses the old thing, delete it. Each phase leaves trunk green. The ordering is the whole point: if you *contract first* — rename or delete the old thing before migrating callers — everything depending on it breaks immediately and trunk is red until you fix it all in one giant commit. Expand first, contract last, always.

---

### Q5. Walk through the kinds of feature flags. Which one matters for refactoring?

**A.** Four kinds, by lifespan and change rate. **Release toggles** hide in-progress work; short-lived, flip once, then deleted. **Experiment toggles** route cohorts for A/B tests; medium-lived, change per request. **Ops toggles** are kill-switches/circuit-breakers for risky subsystems; long-lived, rarely flipped. **Permission toggles** gate features by user/plan/region; permanent. For refactoring you almost always want a *release toggle* — and the key fact is it's *supposed to die*. It flips off→on once and then gets removed along with the old code path. Treating a release toggle like a permanent one is how flag debt is born.

---

### Q6. What is flag debt, why is it this section's biggest hidden cost, and how do you prevent it?

**A.** Flag debt is the accumulated cost of release toggles that were never removed: dead `else` branches, dual code paths, "always-true" flags, and orphaned legacy code nobody dares delete. It's the biggest hidden cost because the *fun* part (ship behind a flag, ramp to 100%) is easy and the *boring* part (delete the flag and the old path) is what teams skip — and it compounds across every refactor. Prevention: the ticket that creates a release toggle must also create its scheduled removal ticket; soak then remove; naming conventions that mark a flag as short-lived; automated stale-flag detection (LaunchDarkly/Unleash do this); and treating an always-true release toggle as a defect, not a leftover. The refactor isn't *done* until the flag is gone.

---

### Q7. What's the difference between dark launching and shadowing, and when would you use each?

**A.** Both run new code in production without trusting its output. **Dark launch**: run the new path but ignore its result — you're testing whether it survives real load, latency, and data shapes. **Shadowing (mirroring)**: run *both* old and new for the same request, return the *old* result to the user, and *compare* the two, logging divergences. Use dark launch to find capacity/operational problems; use shadowing to *prove behavior preservation* before you trust the new path. The non-negotiable rule for both: the shadow/dark path must never affect the user's result or fail their request — catch all exceptions, always return the proven answer. Caveat: if the new path has side effects (writes, charges), naive shadowing double-fires them, so you need a no-op mode or skip it.

---

### Q8. How is "Continuous Integration" a discipline, not just a server?

**A.** The server runs tests; the discipline is the behavior. Beck/Fowler's CI is: integrate into trunk frequently — at least daily; keep the build *fast* (so people don't batch up changes) and *green*; and if it goes red, fixing it is the team's number-one priority — no new work lands on a red trunk. A CI server with a team that lets red builds sit for a day, or batches a week of work before integrating, isn't doing CI. The discipline is what keeps trunk shippable; the server just enforces it.

---

### Q9. How do Branch by Abstraction, Parallel Change, Mikado, and Strangler relate to this topic?

**A.** They're four named techniques for obeying the one rule — keep trunk shippable through a large change. *Branch by Abstraction* puts an interface in front of the thing you're replacing so old and new implementations coexist (expand/contract at the interface). *Parallel Change* is expand→migrate→contract applied to signatures, schemas, and formats. *Mikado* is how you *discover* the dependency order so each step stays green. *Strangler* grows the new system around the old and routes over piece by piece. All four are "additive change + small shippable steps + often a flag to choose the path." This topic is the capstone that names the shared principle underneath them.

---

### Q10. You're replacing the pricing engine. Decompose it into shippable steps.

**A.** (1) Extract a `PricingEngine` interface; legacy implements it — pure structural, no behavior change, green. (2) Add `NewPricingEngine` as latent code, not wired in. (3) Add a release flag and make the service pick implementation by flag, default OFF — behavior unchanged. (4) Add shadow comparison behind a shadow flag; soak a week, log divergences. (5) Ramp the real flag 1% → 100% over days, watching error rate and conversion. (6) Remove the flag check; use the new engine directly. (7) Delete the legacy engine and flag config. Seven steps, each green and shippable, each revertible on its own — versus one terrifying swap.

---

### Q11. When would you *not* keep the system shippable mid-refactor and just freeze?

**A.** When the machinery costs more than the risk it removes. For a tiny atomic change — renaming a private method used in three places — you just commit it; building a flag is absurd. For a small, low-traffic, single-owner service with no cross-team dependencies and infrequent deploys, a short, well-announced freeze ("nobody touches trunk for an hour while I land this") can genuinely be cheaper than flags, shadowing, and governance. The discipline pays off when the change is large, risky, multi-day, multi-team, or on a hot shared trunk that production depends on *during* the change. Reaching for flags on a low-risk isolated change is its own waste — that's flag sprawl and discipline tax with no payoff.

---

### Q12. How does a feature flag enable instant rollback, and what's the limit of that?

**A.** Because both code paths are *deployed* and the flag picks one at runtime, flipping the flag OFF reverts behavior in under a second with no redeploy — versus a 20-minute emergency deploy. That's the whole point of having an escape hatch. The limit is *state*: a flag flip instantly un-routes reads and logic, but data already written in a new format isn't undone by flipping a flag. For stateful migrations you keep the old data path readable until the new format has soaked, and you don't drop the old column until rollback is genuinely off the table. Flags give you instant *behavioral* rollback, not instant *data* rollback.

---

### Q13. How do Google and Meta keep an enormous monorepo shippable?

**A.** Both run trunk-based development at scale precisely *because* long-lived branches are infeasible there — a single broken head blocks thousands of engineers, so "head is always buildable" is mandatory, not aspirational. Large migrations are done as long sequences of small, individually-green changes, often with mechanical/automated refactoring tooling rather than a hand-merged branch. Incomplete work ships dark behind gates/flags and is rolled out via gradual rollout and experiments. They invest heavily in automated stale-flag and stale-code detection because flag debt scales right along with the model. The lesson: at scale, "every commit keeps trunk shippable" isn't ceremony — it's the only model that works.

---

### Q14. Two teams are running large refactors that touch the same module. How do you keep trunk shippable?

**A.** Make the contention explicit instead of discovering it in a merge conflict. Keep a visible register of in-flight large refactors — modules touched, flags owned, phase, owner. If refactor B depends on the abstraction A is introducing, prefer to *sequence* (A lands its expand phase as a stable, shippable seam before B builds on it), or agree the interface up front and treat it as a published contract, or decouple via Branch by Abstraction so each works behind the same seam independently. The thing you never do is let B build on A's half-finished, still-moving internals — that couples two unfinished migrations into one unshippable blob, which is just a big-bang branch spread across two teams.

---

### Q15. A teammate says "trunk's a little broken right now, but it's fine, we'll fix it after this sprint." What's your response?

**A.** That sentence is the single most dangerous thing a team can normalize. The entire shippability discipline rests on trunk *actually* being green — every technique in this section (flags, parallel change, strangler) is meaningless if "halfway" isn't really shippable. A normalized red trunk means: nobody can ship a hotfix safely, every new change inherits the breakage, and "shippable" steps built on a broken base aren't shippable at all. A red trunk is a stop-the-line incident — fixing it is the team's top priority, above new feature work. The fix is cultural and mechanical: CI blocks red merges, and the team treats red trunk as an emergency, not a shrug.
