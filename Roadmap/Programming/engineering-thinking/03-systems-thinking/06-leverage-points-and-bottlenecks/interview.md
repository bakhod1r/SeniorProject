> Interview questions on leverage points and bottlenecks: Theory of Constraints (Goldratt's five focusing steps), Amdahl's law with worked numbers, Donella Meadows' leverage hierarchy, and the senior judgment of "you optimized X and nothing got faster — why?" Answers are short and precise, with the traps and follow-ups that separate someone who memorized the terms from someone who can find the real constraint. Defining a system's *flow* and *constraint* is the recurring through-line.

---

## Q1. A pipeline has stages running at 1000, 1000, 200, and 5000 req/s. What's the throughput, and why?

**200 req/s** — the rate of the slowest stage. A serial pipeline runs at the speed of its bottleneck, not the average and not the fastest. The slow stage gates everything; faster stages just sit idle or build a queue in front of the constraint.

**Follow-up — what if you double the first stage to 2000/s?** No change. Still 200/s. You optimized a non-constraint. **Trap:** candidates who say "it gets a bit faster" don't understand that non-bottleneck improvements are exactly zero on throughput.

## Q2. State Goldratt's five focusing steps.

**Identify** the constraint → **Exploit** it (max output from it as-is) → **Subordinate** everything else to it → **Elevate** it (add capacity) → **Repeat** (go back to step 1, because the constraint moved).

**Trap:** the order matters. The most common mistake is jumping straight to *elevate* (buy more hardware) before *exploit* (remove idle time and junk work). Exploiting is free and often recovers more than elevating.

## Q3. Why is "subordinate everything else to the constraint" a real instruction and not just a slogan?

Because running non-constraints at full speed is actively harmful: they pile inventory/queue in front of the constraint, consume memory, and can starve or flood it. A producer racing 5× ahead of the bottleneck just OOMs a buffer. Subordinating means *pacing* non-constraints to the constraint's rhythm — slower non-constraints, same throughput, calmer system.

## Q4. State Amdahl's law and its key corollary.

Speedup = `1 / ((1 - p) + p/s)`, where `p` is the fraction of work you speed up and `s` is the factor. **Corollary:** as `s → ∞`, max speedup = `1 / (1 - p)`. So the size of the part you optimize is a hard ceiling — optimize a 10% part and you're capped at ~1.11×, no matter how good the optimization.

## Q5. A function is 5% of total runtime. You make it 100× faster. What's the overall speedup?

`p = 0.05, s = 100`. Speedup = `1 / (0.95 + 0.05/100) = 1 / 0.9505 ≈ 1.052×`. About **5%**. And the ceiling even at `s = ∞` is `1/0.95 ≈ 1.053×`. The 100× was almost entirely wasted — the part was too small to matter. **This is the quantitative reason to measure first.**

## Q6. "You optimized X and nothing got faster." Give every reason this happens.

1. **X wasn't the bottleneck** — you sped up a stage with spare capacity (the #1 cause).
2. **X's `p` was tiny** — Amdahl capped the reward near zero even if X was on the path.
3. **The constraint moved** before you finished — you fixed last week's bottleneck.
4. **The real constraint is a wait, not work** — e.g. connection-pool saturation, a lock, a queue — and X was busy-work, not wait-work.
5. **You measured the wrong thing** — local latency improved but throughput is gated elsewhere.

The unifying answer: **X was not the constraint.** The fix is to measure and find what actually gates the outcome.

## Q7. What does Donella Meadows mean by "people find leverage points but push them in the wrong direction"?

People intuit *where* to intervene but turn the knob backwards. Engineering example: latency spikes, so the team *increases* retries — which multiplies load on the struggling service and makes latency worse. They found the leverage point (retries) and pushed it the wrong way; the high-leverage move was to *shed load / back off*. Recognizing the right point is necessary but not sufficient; direction matters.

## Q8. Order these by leverage, weakest to strongest: a goal, a timeout value, a feedback loop's delay, the system's paradigm.

Timeout (parameter, weakest) → feedback-loop delay (mid) → goal (very high) → paradigm (strongest). Meadows' point: engineers spend almost all effort on the weakest tier (parameters) because it's easy and safe, and almost none on the strongest (goals, paradigms) because it's political and slow — exactly inverted from where the leverage is.

## Q9. The page takes 4 seconds and users blame the frontend. Where do you look first, and why might the frontend be the wrong place?

**Measure where the 4 seconds actually go** — profile/trace the request end to end. The pain is felt in the frontend, but the constraint is frequently elsewhere (a 3.4s unindexed query, a saturated connection pool, a slow downstream call). "The constraint is rarely where the pain is felt." Optimizing frontend render when 85% of the time is in a query is treating the symptom.

## Q10. Your DB shows 1800ms of wait per request but the DB CPU is at 3%. What's the constraint?

**Not the DB.** The DB is idle — work is *waiting to reach it*, almost certainly queuing on a saturated connection pool (or a lock). The constraint is the pool size, not the database. Elevating the DB (bigger instance) does nothing; raising/right-sizing the pool fixes it. **Trap:** big *wait* with low *utilization* always means the bottleneck is the thing limiting *access* to the resource, not the resource.

## Q11. One flaky test fails 1-in-5 CI runs and CI must be green to merge. Why is this a high-leverage fix?

Because that test is the constraint on the *entire team's shipping throughput* — every engineer's merges queue behind it. Rough cost: 8 engineers × 3 merges/day × 20% flake × ~12 min re-run ≈ ~10 engineer-hours/day. Fixing one test returns more than weeks of feature work. It's high-leverage because it gates *everything*, yet it festers because it's nobody's job — the classic invisible constraint.

## Q12. After you fix the bottleneck, what happens — and what's the discipline?

**The bottleneck moves** to the next-slowest part (a second-order effect). The discipline: **re-measure after every fix.** Never assume the part you just fixed is still the problem, and never assume the part you dismissed earlier still isn't. Repeat the loop until the next fix costs more than it's worth — at which point "good enough" is the legitimate new constraint and you stop.

## Q13. Distinguish Theory of Constraints from Amdahl's law. When do you use each?

**ToC tells you *which* part to fix** (the constraint that gates throughput) and gives a process (five focusing steps). **Amdahl tells you *how much* a fix can help** (the `1/(1-p)` ceiling). Use ToC to pick the target; use Amdahl to decide whether that target is worth the effort before you start. They're complementary: locate with ToC, size with Amdahl.

## Q14. A team wants to hire 10 engineers to ship faster. They're blocked on a 3-person shared platform team. What do you predict?

Hiring makes the org **slower**, not faster. The new engineers generate more demand on the platform-team constraint, more coordination overhead, and more work piling up *in front of* the constraint. Goldratt: throughput is governed by the constraint; everything else is just inventory and operating expense. The high-leverage move is to elevate the platform-team constraint (delegate authority, self-serve tooling) — possibly *before* any hiring.

## Q15. What's the single question that captures this whole topic?

**"What is the ONE constraint right now, and am I actually working on it?"** If you can't name the constraint → go measure. If you can name it but you're working on something else → you're doing low-leverage busywork no matter how hard you're working. Everything — ToC, Amdahl, Meadows — is in service of answering that question correctly.

## Q16. What's the highest-leverage point of all, per Meadows, and why is it the hardest to use?

The **paradigm** — the shared, usually-unspoken mindset from which the system's goals arise (and beyond it, the power to *transcend* paradigms / hold models loosely). It's highest leverage because changing it redirects everything downstream — goals, rules, parameters all follow. It's hardest because it's invisible, deeply held, and slow to shift; you can't ticket it. The best engineers switch frames — see the same system as throughput, feedback, and incentives — to find the constraint others can't.
