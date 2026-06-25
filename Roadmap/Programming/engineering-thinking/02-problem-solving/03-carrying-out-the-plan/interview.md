> Interview questions on Pólya's third stage — **carrying out the plan**. The interviewer is probing for execution discipline: do you verify each step or barrel ahead and hope? Do you keep the system shippable? Do you adapt a plan deliberately or thrash / force / cling to sunk cost? Answers below are short and precise, with the traps and follow-ups an interviewer will press on. Related: [Devising a Plan](../02-devising-a-plan/), [Looking Back](../04-looking-back-and-reflecting/), [Debugging](../05-debugging-as-problem-solving/).

## Q1. What does Pólya mean by "check each step" in the carry-out stage?

For every step of executing your plan, ask two things: *can you see clearly that this step is correct, and can you prove it?* It's the discipline of verifying each increment as you make it — running it, testing it, checking the effect — rather than writing the whole solution and discovering at the end that something, somewhere, is wrong.

**Trap:** treating stage three as the trivial "just type the plan in" stage. Pólya singles it out precisely because skipping verification here is where solutions silently go wrong.

## Q2. Why is verifying each step better than verifying at the end?

Because it collapses the search space when something breaks. If you verify after every step and step 5 fails, the bug is in step 5 — steps 1–4 were confirmed good. If you write all ten steps and *then* run, the failure could be anywhere, the steps interact, and the failure point isn't the cause point. Continuous verification turns N unknowns into one.

**Follow-up — "what's the cost model?"** A wrong assumption caught in the step that introduced it costs minutes; caught at integration, hours; caught in production, an incident. Cost grows with detection latency.

## Q3. Your plan hits an obstacle mid-execution. A step fails. What do you do?

Stop — don't pile more changes on a broken foundation. Then triage between three options: **adapt** (a tactical assumption was wrong, the goal stands, reroute around it and keep the verified work), **persist** (the obstacle is real but surmountable and the plan is still the best path), or **kill** (a core assumption is now proven false). A failed step is information about which assumption was wrong, not just a problem to grind through.

**Trap:** the two reflex answers — *force it* (hammer the same approach harder, ignoring what reality just told you) or *panic-abandon* (throw out the whole plan and the good steps with it). Both are emotional, not analytical.

## Q4. How do you decide between persisting and killing a plan?

Apply the from-scratch test: *knowing what I know now, would I choose this plan if I were starting today?* If yes, persist. If no, the only thing keeping you on it is sunk cost — the effort already spent, which is gone whether you continue or not. The only real question is whether the *next* hour is well spent.

**Follow-up — "name the bias."** Sunk-cost fallacy — see [Cognitive Biases in Code Decisions](../../04-critical-thinking/03-cognitive-biases-in-code-decisions/). Interviewers love when you name it and note it cuts both ways: clinging *and* abandoning at the first bump are both failures.

## Q5. What does "the plan is a hypothesis" mean for execution?

Your plan encodes assumptions about a problem you only partially understood when you made it. Production is the experiment. When a step's result contradicts an assumption, the plan — not reality — is what's wrong. Good execution is structured to *falsify the plan as early and cheaply as possible*: test the riskiest assumptions first, define in advance what observable would prove each step, and update the plan when reality disagrees.

## Q6. How do you order the steps of a plan when you execute it?

By risk, not by tidiness. Pull the least-certain, highest-impact assumption forward and verify it with the cheapest probe — a spike, a one-day dark launch — before building anything that depends on it. The tidy bottom-up order (schema → data → service → API) tests your riskiest integration assumption *last*, after you've sunk the most cost. Invert it.

**Trap:** "I start with the easy parts to build momentum." Visible progress on a plan that's about to die is the most expensive work you can do.

## Q7. What's a walking skeleton and why does it matter for carrying out a plan?

Cockburn's walking skeleton is a tiny end-to-end implementation that exercises every layer of the architecture but does almost nothing — a thin thread through the whole system. It matters because it gives you a *working, deployable system on day one*, so integration risk surfaces early and every later step is a verifiable addition to something that already runs, rather than a leap of faith verified only at the end.

**Follow-up — relation to Beck?** Same spirit as *make it work, make it right, make it fast* — get a working (ugly) path first, because a working ugly thing is shippable and testable while a half-built elegant thing is neither.

## Q8. How do small commits / keep-main-green relate to this stage?

They're the mechanics of "check each step" and "keep a working state." A small commit is a verified save point: if your next step goes wrong, you revert one commit and you're at a known-good state, not in a half-migrated mess. Keeping main green means you always have a floor to stand on — you can ship, demo, or bisect at any moment. Both shrink the distance between "I changed something" and "I know whether it worked."

## Q9. How do you make a big, unsafe change while keeping the system working?

Expand/contract (parallel change): **expand** — add the new thing alongside the old so both work; **migrate** — move readers/writers to the new path incrementally, verifying each; **contract** — remove the old path once nothing uses it. Each phase is independently deployable and reversible, so the system is never broken and a wrong step costs a flag flip, not a rollback war.

**Trap:** proposing a single atomic cutover for something like a column rename other services read. That's a big-bang with no safe revert.

## Q10. What does "leaving a trail" mean and why does it matter?

As you execute, you create a record: commit messages that say *why*, a decision log of pivots ("believed X, reality showed Y, decided Z"), notes on what you tried. It matters because it enables **backtracking** — you know what state each step left things in, so you can step back instead of starting over — and because at team scale, if only you can revert your change, your change is a single point of failure.

## Q11. You're deep into a plan and realize an early assumption was wrong. Walk me through it.

Stop adding to it. Identify exactly which assumption broke and where. Run the from-scratch test to decide adapt vs. kill. If adapting: update *only* the affected part of the plan, preserve the verified steps that are still valid, re-sequence if the new info changes the risk order. Write the pivot in the decision log so sunk cost stays a number on paper, not a feeling. Then continue, checking each step.

**Follow-up — "what if you can't even tell why the step failed?"** Then you've crossed from executing into debugging — switch methods to [Debugging as Problem-Solving](../05-debugging-as-problem-solving/): reproduce, isolate, form a hypothesis, test one variable at a time.

## Q12. How do you maintain execution discipline during an incident?

Treat it as a normal plan under time pressure — the method doesn't change because the stakes did. Mitigate before you diagnose (roll back the deploy, shed load, flip the flag — restore service first). Form one hypothesis. Change one thing, verify its effect, keep or revert. Narrate continuously so the team stays coordinated and you get a post-mortem timeline for free. Always have a revert — never make an unrevertable change in an already-degraded state.

**Trap:** "I'd quickly try a few things." Multiple simultaneous changes destroy your ability to attribute the effect — you can no longer learn what helped, and you've made the system *less* understood.

## Q13. Why is "change one thing at a time" so important under pressure?

Because attribution requires it. If you change five things and the metric improves, you don't know which one helped — and if it gets worse, you don't know which one hurt. You've spent your most expensive minutes and learned nothing. One change, verified, keeps every step provable, which is exactly Pólya's demand, hardest to honor when adrenaline says flail.

## Q14. How do you tell the difference between persistence and stubbornness in execution?

Persistence is continuing because the from-scratch test still says yes — the plan is genuinely the best path and the obstacle is surmountable. Stubbornness is continuing because of effort already spent, or attachment to your own idea, while reality keeps saying no. The tell: can you state, in evidence, *why the plan is still right*? If your only reason is "we've come too far," it's sunk cost wearing the costume of grit.

## Q15. At staff/principal scale, how do you make "check each step" hold across many teams?

You can't verify every step yourself, so you build a system that verifies them: enforce keep-main-green with required checks and trunk-based defaults, make small reversible changes the easy path (fast CI, trivial rollback, flags as standard), and replace narrative status with *observable* plan health (trunk health, flow metrics, assumption-tripwires that fire from telemetry). The goal is that a wrong assumption announces itself and a broken step can't land — so the discipline happens thousands of times a day without you watching.

**Follow-up — "and adapting the roadmap?"** Pre-commit the pivot criteria while calm, adapt only on material signals (not every tremor — thrash demoralizes teams), preserve verified work on every pivot, and always communicate the *why*.

> More: [Devising a Plan](../02-devising-a-plan/), [Understanding the Problem](../01-understanding-the-problem/), [Looking Back and Reflecting](../04-looking-back-and-reflecting/), [Techniques When You're Stuck](../06-techniques-when-you-are-stuck/). Back to the [Problem-Solving section](../) or the [Engineering Thinking roadmap](../../README.md).
