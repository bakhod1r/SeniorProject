> Interview questions on Pólya's fourth stage — *looking back*. Interviewers use these to separate engineers who *ship and forget* from those who turn each solved problem into transferable skill and each incident into a systemic fix. Answers are short and precise; traps and follow-ups are called out. Tie everything back to: verify the *original* problem, extract the general lesson, refactor under green, and run blameless postmortems.

---

## Q1. What is Pólya's fourth stage, and why does it matter?

"Looking back" — examining the solution *after* it works to verify it, find a cleaner derivation, and extract a reusable method. It matters because it's where one solved problem becomes a transferable skill. Pólya (*How to Solve It*, 1945) noted it's the stage students skip most, and that's exactly where the learning is.

**Trap:** Don't reduce it to "double-check your answer." The reuse/generalization half is the bigger payoff.

## Q2. The bug is fixed and tests pass. What do you do *before* closing the ticket?

Four things: (1) re-read the *original* ticket and confirm I solved *that*, not a drifted version; (2) re-run the edge cases I identified up front; (3) one refactor pass while tests are green; (4) write down the general lesson. Maybe five minutes; highest-return habit in the workflow.

**Follow-up — "Why re-read the ticket?"** Scope drift: over the task, the problem in your head mutates. The audit catches "I fixed *a* bug, not *the* bug."

## Q3. What's the danger of skipping looking back?

You solve the same *class* of problem slowly, forever — "one year of experience, repeated twenty times." Without reflection there's no feedback step, so no improvement. Ericsson's deliberate-practice research is explicit: time-on-task without feedback you act on doesn't build expertise.

## Q4. "Make it work, then make it right." Where does looking back fit?

It *is* the "make it right" step. You separate correctness (get to green) from quality (clarity, structure) so you fight one at a time. The refactor is safe precisely because green tests are the seatbelt — you restructure aggressively and know you didn't break anything.

**Trap:** "Make it right" is not optional polish. Skip it and the cost moves into the future as technical debt with interest.

## Q5. Pólya asks "can you check the result a different way?" What does that mean in engineering?

Verify by an *independent route*, because a test you wrote can encode the same misunderstanding as the bug. Examples: a brute-force checker against your optimized solution, a property that must hold (round-trip, invariant), a hand-computed value, or spec-provided examples rather than self-authored ones.

## Q6. What is a blameless postmortem, and what is it *not*?

A post-incident review that assumes every person acted reasonably given what they knew, and hunts the *systemic* cause instead of a culprit. It is **not** consequence-free — Just Culture still addresses negligence/malice. The point: if people fear blame, they hide the information you need to fix the system. (Allspaw/Etsy 2012; Google SRE Book; Dekker's *Just Culture*.)

**Follow-up — "Why blameless specifically?"** Honest signal. Fear produces sanitized timelines and you go blind.

## Q7. A junior engineer pushed a config that took down checkout. Walk me through the postmortem.

I never frame it as "the junior did X." I reconstruct the timeline, then 5-Whys to the system: the config passed review and CI yet failed in prod because no environment had prod traffic shape — the *system* let an unvalidated-at-scale change reach 100% of users. Action items: canary deploys + config schema validation, each owned and dated. The test: the same incident couldn't be caused by a *different* person — if it could, I found a scapegoat, not a cause.

## Q8. How do you make sure postmortem action items actually get done?

Each item gets an **owner, a due date, and a tracking ticket**, prioritized like any other work — "improve deploy safety" is a wish, "add canary stage, owner @sam, due 2 weeks, JIRA-4821" is work. Then review open action items in regular planning. Unactioned items are how the same outage happens twice.

## Q9. After fixing a bug, what's the difference between reflecting on your *output* versus your *reasoning*?

Output-level: "added the missing null check." Reasoning-level: "I assumed the API never returns null because it never had — I trusted a habit over the contract." The first fixes one bug; the second prevents a *class* of bugs by correcting how I think. The reasoning audit is the bigger lever. (See [debugging your own reasoning](../../10-metacognition-and-learning/02-debugging-your-own-reasoning/).)

## Q10. What does "generalize the solution" mean, and when do you do it?

Ask whether the solution now covers a whole *class* or just this instance — e.g., "retry-on-timeout for payments" generalizes to "retry transient failures with backoff" for every flaky call. Discipline: **notice** the pattern every time (free), **extract** it on the second or third occurrence (the Rule of Three) to avoid premature abstraction.

**Trap:** Generalizing on the first occurrence is premature abstraction — its own smell.

## Q11. How does looking back connect to estimation?

It's the only moment you can compare your prediction to the outcome — estimated 4h, took 11h, *why?* You note the gap source (e.g., "didn't know about the legacy auth coupling") and update your personal multipliers. Most engineers estimate badly forever because they never close this loop; they just feel bad about being late. It's a feedback loop on your own forecasting.

## Q12. Your team writes postmortems but the same kind of incident keeps recurring. What's wrong?

The fixes are *surface*, not *systemic* — "be more careful," "add to the checklist humans must remember." Those degrade the instant attention lapses. The fix: for every action item, ask "does this remove reliance on a human doing the right thing under pressure?" Replace human-vigilance fixes with mechanical ones — CI blocks it, the system defaults safe, the dangerous operation is impossible by construction. Also check: are action items even being closed?

## Q13. What's the Prime Directive and why would you read it at the start of a retro?

Norm Kerth's retrospective Prime Directive: *"everyone did the best job they could, given what they knew at the time, their skills, the resources, and the situation."* You state it to reset the room from "who's at fault" to "what does the system need." It's not sentiment — it's the social precondition for honest data.

## Q14. As a staff engineer, what does a *good* retro produce versus a mediocre one?

A mediocre retro produces "we'll communicate better next sprint" — nothing structural changed. A good one changes the *system*: "the on-call rotation has no handoff protocol; here's the protocol, owned, shipping." The principal-level test is whether the retro changed how the *organization* works, and whether you can name other incidents the fix would also prevent.

## Q15. How would you measure whether your org's reflection actually works — and what's the trap?

Measure *outcomes*: repeat-incident rate (by root-cause class), action-item closure time, time-to-recover trend. The trap is Goodhart's law — the moment "number of postmortems written" becomes the target, you get hollow postmortems. Track outcomes (recurrence down, MTTR down), never activity (docs filed).

---

**One-line synthesis:** *Looking back* is verify-the-original-problem + refactor-under-green + extract-the-general-lesson at the individual scale, and blameless-postmortem + systemic-fix + tracked-action-items at the organizational scale — the discipline that converts effort into compounding skill instead of "one year of experience, repeated."

Related: [understanding the problem](../01-understanding-the-problem/) · [carrying out the plan](../03-carrying-out-the-plan/) · [debugging as problem-solving](../05-debugging-as-problem-solving/) · [deliberate practice](../../10-metacognition-and-learning/03-deliberate-practice/) · [feedback loops](../../03-systems-thinking/02-feedback-loops/). Back to the [problem-solving section](../) · [roadmap](../../README.md).
