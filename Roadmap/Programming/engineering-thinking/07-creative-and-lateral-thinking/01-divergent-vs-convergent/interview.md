> Interview questions on divergent vs convergent thinking. The interviewer is probing whether you can *separate idea-generation from decision-making* — generate real options under pressure, and converge on explicit criteria without rationalizing. Answers are short and precise; traps and follow-ups are called out. This pairs with [evaluating trade-offs objectively](../../04-critical-thinking/04-evaluating-tradeoffs-objectively/) and the [creative-thinking section](../).

---

## Q1. What's the difference between divergent and convergent thinking?

Divergent thinking *generates* many options — quantity, variety, judgment deferred (brainstorming a design space, listing failure modes). Convergent thinking *evaluates and narrows* to one — applying criteria, deciding. The terms come from Guilford's work on divergent and convergent *production* in the 1950s. Both are necessary; the skill is not running them simultaneously.

**Trap:** Calling divergent "creative" and convergent "analytical" as if one is better. They're complementary phases, not a hierarchy.

## Q2. Why is it a problem to do both at once?

Judging an idea the moment it appears shuts down generation — criticism and generation are opposite stances, so you end up with three timid options instead of fifteen, and the best idea was often one you never reached. The reverse mix — generating forever without ever applying criteria — is analysis paralysis: you never converge. Separating the phases lets each run by its own rules.

## Q3. Walk me through the Double Diamond.

Four phases, two diamonds (Design Council, 2004): **Discover** (diverge on the problem), **Define** (converge on the problem), **Develop** (diverge on solutions), **Deliver** (converge on a solution). The non-obvious part is the *first* diamond — you diverge and converge on the *problem* before touching solutions.

**Follow-up — why does the first diamond matter most?** Because most engineers skip it and start generating solutions to a problem they haven't actually defined, so they solve the wrong thing efficiently.

## Q4. A teammate keeps shooting down ideas during brainstorming. What do you do?

Name the phase: "We're in generate mode — capture everything, evaluate nothing; we'll judge in ten minutes." Make the rule about the *process*, not the person. Osborn's classic brainstorming rules — defer judgment, encourage wild ideas, go for quantity — exist precisely to keep convergence from leaking into the divergent phase.

## Q5. How do you measure whether you actually diverged, versus just felt productive?

Guilford's axes: **fluency** (how many), **flexibility** (how many distinct *categories*), **originality** (how unusual), **elaboration** (how developed). The one engineers fail is flexibility — "Redis / Memcached / in-process LRU" feels like three options but it's one idea (cache it) restyled. Real divergence crosses categories: cache it / precompute it / denormalize / change the access pattern / drop the requirement.

## Q6. What's the single most important convergence discipline?

Fix the decision criteria — and roughly their weights — *before* you look at the options. Otherwise you rationalize: you reach a preferred option fast and then weight whichever criterion it happens to win on. Criteria-first keeps convergence honest. This is the bridge to trade-off analysis.

**Trap:** Saying "list pros and cons." Pros/cons without pre-set weighted criteria still lets you cherry-pick.

## Q7. How does seniority change the balance between the two modes?

Juniors converge too fast — first idea that works, ship it. Seniors hold the design space open longer, especially diverging on the *problem*, and protect the divergent phase from premature judgment. But the senior risk is the opposite: enjoying divergence and under-converging, so the deadline slips. The mark of maturity is closing cleanly *and on time*, calibrated to how reversible the decision is.

## Q8. How does this show up in debugging?

Debugging is structured divergence under pressure: generate the full hypothesis set *before* testing any of it, then test in order of information-gained-per-cost — bisecting the hypothesis space, not tunneling on one guess. The rookie latches onto "must be the cache" and burns an hour; the senior lists six hypotheses and runs the cheapest *discriminating* test first.

**Follow-up — give an example test order.** "Random + multi-node + intermittent" points at shared-state/stickiness hypotheses over single-node ones; pick the query that splits the hypothesis set roughly in half.

## Q9. How does it apply to code review?

Diverge first — "what are *all* the ways this could break?" (concurrency, empty/nil input, partial failure, future-maintainer confusion) — then converge on which matter enough to block versus a non-blocking note. Reviewers who converge instantly ("looks fine" or "change this line") miss the failure modes you only see by holding the space open for a moment.

## Q10. What is SCAMPER and when would you reach for it?

SCAMPER (Bob Eberle) is a divergence checklist — Substitute, Combine, Adapt, Modify/Magnify, Put-to-other-use, Eliminate, Reverse/Rearrange — that generates variations by applying different *operations* to an existing design. Reach for it when you're anchored on one design and can't see alternatives: "Eliminate the sync step → go eventually consistent" or "Reverse → compute at write-time instead of read-time."

## Q11. How is this related to lateral thinking?

Edward de Bono's *lateral thinking* is a sibling concept: deliberately approaching a problem from unexpected angles rather than straight-ahead (vertical) logic. It's essentially a family of divergence techniques. Divergent/convergent is the broader *phase* framework; lateral thinking is one toolkit for forcing the divergent phase wider.

## Q12. What role does psychological safety play?

Group divergence is a direct function of safety. If a half-formed or "wrong" idea draws a smirk, people only voice safe, conventional options — you get fluency but no originality, and originality is exactly what dies first under judgment. The lead sets it: voice a rough idea yourself early, respond to wild ideas with "what if we pushed that further" rather than critique.

**Follow-up:** Brainwriting (silent written generation before discussion) protects divergence structurally — it captures everyone's options before the first speaker anchors the room.

## Q13. When should you deliberately converge *fast* with little divergence?

When the decision is a two-way door — cheap to reverse. A library choice behind an interface, a feature-flag rollout: decide quickly, ship, watch. Spending heavyweight divergence on reversible decisions is its own failure; it slows everything and teaches the org that all decisions are expensive. Deep divergence is earned by one-way doors — API contracts, data models, the primary datastore.

## Q14. A design review approved the first option presented, fast, with everyone agreeing. Good sign or bad sign?

Usually bad. Quick consensus on a non-trivial design typically means *low divergence*, not a great idea — the group anchored on what was presented and elaborated it instead of comparing alternatives. I'd ask "what options did we *not* consider, and why?" and check whether the problem itself was diverged on. Easy agreement is a smell to investigate, not a result to celebrate.

## Q15. You've been diverging on a design for a while. How do you know it's time to converge?

Two signals. (1) Flexibility has plateaued — the last several ideas are restyles of earlier categories, so new options stop adding information. (2) The decision deadline is closer than the remaining analysis would take. When new *categories* dry up and the clock is real, converge: eliminate the now-impossible options first, then score the survivors against the pre-set criteria, and decide. Holding it open past that point is just cost.
