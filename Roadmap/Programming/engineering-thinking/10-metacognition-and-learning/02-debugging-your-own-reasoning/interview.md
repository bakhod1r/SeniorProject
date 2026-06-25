> Interview questions on debugging your own reasoning — metacognition applied to engineering judgment. These probe whether you can catch your *own* errors, separate confidence from correctness, and reason about reasoning. Answers are concise with the traps and follow-ups interviewers chase. Strong candidates give concrete examples; weak ones speak in platitudes.

---

## Q1. What does "debugging your own reasoning" actually mean?

Treating your thinking as a system that has bugs and inspecting it the way you inspect code: catching the moment you mistake a *feeling of certainty* for evidence, forcing your assumptions to be explicit (out loud or in writing), and asking what would prove you wrong before you act. The core insight: most expensive mistakes aren't from not knowing — they're from being confidently wrong and never checking.

**Trap:** Don't recite "I'm very self-aware." That's an unfalsifiable claim. Name a concrete mechanism you use.

---

## Q2. You spent two hours sure the bug was in module X. It wasn't. What failed in your reasoning?

Almost always **anchoring on the first hypothesis + confirmation bias**: an early guess felt like a conclusion, and then you looked only for evidence that confirmed it while explaining away contradictions. The fix is procedural, not "try harder": before investigating, write down 2–3 competing hypotheses, and run the *disconfirming* test first — the cheap check that would *kill* your favorite theory, not the one that would confirm it.

**Follow-up:** "How would you have caught it faster?" → Time-box (30 min, no progress → step back), and check the actual data (log the raw value) instead of reasoning about what it "should" be.

---

## Q3. What's the difference between feeling confident and being correct?

They're *different variables*. Confidence is an emotion your brain generates from familiarity and fluency; correctness is a property of the world. A well-calibrated engineer's 90%-confident calls come true ~90% of the time; most people's "90%" is really ~60%. The only way to know your own ratio is to log predictions with confidence levels and score them later.

**Trap:** Saying "I'm always confident *and* correct." That's the answer of someone who has never measured.

---

## Q4. What is the illusion of explanatory depth, and why should an engineer care?

Rozenblit & Keil (2002): people believe they understand things in far more detail than they do, and only discover the gap when forced to *explain* it. You "know how the event loop works" until you try to explain it step by step and stall. It matters because the gap is invisible from the inside — so before claiming you understand a system, try to explain it without hand-waving. The stall *is* the bug, and it's where your next learning is.

**Follow-up:** "How do you exploit this deliberately?" → Rubber-duck / write it down; forced articulation exposes the gap on demand.

---

## Q5. Why does explaining a bug to a rubber duck (or a colleague) so often solve it before they respond?

Silent thinking lets you skip steps; speaking or writing forces every step to be explicit. The bug almost always hides in a step you were skipping because it felt too obvious to state — a wrong assumption. Articulation drags that assumption into the light. From *The Pragmatic Programmer* (Hunt & Thomas).

**Follow-up:** "So why ask a person at all?" → A person catches the assumptions you *don't* even know to articulate, and asks the question you didn't think to ask. But you should draft the question first — half the time you answer it yourself.

---

## Q6. When should you ask for help, and how?

Rough rule: genuinely struggle ~15–30 minutes first (under 15 = you didn't try; over ~30 stuck with no new ideas = you're spinning, not persevering). Then write the problem up precisely: what you expected, what happened, what you tried, the minimal repro. The write-up itself often reveals the answer — so it's never wasted even if you don't send it. A good question respects the helper's time and produces a faster answer.

**Trap:** Two extremes both fail — the person who pings after 90 seconds, and the hero who burns a day rather than ask. Seniority is calibrating *between* them.

---

## Q7. What is the single most useful question to ask before acting on a belief?

**"What would convince me I'm wrong?"** — and make it concrete: a specific observation that would flip the belief ("if cache hit rate is >95%, my 'cache is the problem' theory is dead"). If you *can't* name such an observation, the belief is unfalsifiable — which means it isn't knowledge, and you should distrust it. It flips you from defending a belief to testing it.

**Follow-up:** "How is this different from just being open-minded?" → It's operational, not a disposition: you design and run the disconfirming test *first*.

---

## Q8. What is a premortem and how do you apply it to your own conclusions?

You imagine, in the *past tense*, that your decision already failed, and explain how. "It's three months out and this blew up — what happened?" The future-tense "could this fail?" invites a defensive "nah"; the past-tense framing gives your brain permission to surface the doubts it was suppressing (Gary Klein). Applied to a diagnosis: "I shipped the fix to X and it didn't help — why? Because the symptom also appears if Y is misconfigured, and I never checked Y." Now you check Y first.

---

## Q9. Walk me through calibrating your own estimates.

Stop giving point estimates; give intervals with confidence ("80% by Thursday, 50% by Wednesday, could slip to Tuesday if auth bites"). Then **close the loop**: log each prediction with its confidence and later record the outcome. After ~20, compare — are your 80%s right 80% of the time? Almost everyone learns their confidence is inflated, and adjusts. This is the *Superforecasting* (Tetlock) training loop: calibration is a measurable, trainable skill, and the training is just scoring yourself.

**Trap:** Claiming you're calibrated without ever having tracked outcomes.

---

## Q10. When is an expert's gut intuition trustworthy, and when isn't it?

Kahneman & Klein (2009): intuition is valid only when (1) the environment is *regular* enough to have learnable patterns, and (2) you got *prolonged practice with rapid, clear feedback*. So your gut about "this code will have a race condition" is trustworthy (you've debugged hundreds with fast feedback); your gut about "this hire will work out" usually isn't (low regularity, slow noisy feedback). Same feeling of certainty, very different reliability — the skill is knowing which domain you're in.

---

## Q11. Why do you reason worse when tired, stressed, or ego-invested?

System 2 (deliberate, careful thinking, per Kahneman) is metabolically expensive. Fatigue and stress shrink the budget, so your brain quietly defaults to fast, lazy System 1 — and you don't notice the downgrade. Ego is the sneakiest: once you've *publicly said* "it's definitely X," admitting otherwise costs face, so you defend the wrong theory. Countermeasures: don't make consequential calls exhausted; hold theories *loosely in public* ("my current hypothesis is X") so changing your mind costs nothing.

**Tell:** If you feel the urge to *defend* an idea rather than *test* it, that urge is the bug — you're invested in being right, not in being correct.

---

## Q12. What is a rabbit hole and how do you climb out?

Digging into a sub-problem long after it stopped being relevant, driven by the **sunk cost of attention** ("I've spent two hours on this, can't stop now" — but those hours are gone either way). Fix: time-box before you dive ("30 min, then reassess"), set a literal timer, and when it fires ask "is solving this still the fastest path to my actual goal?" If you can't even remember the goal, you're in a hole. Writing the goal down before diving keeps it visible.

---

## Q13. How does keeping a decision journal improve your reasoning?

Memory rewrites the past (hindsight bias) so you *think* you predicted what happened. A journal records — at decision time — your reasoning, your confidence, the key assumption, and the trigger that should make you revisit. Later you learn one of two things: your reasoning was sound but the world changed (fine, you have a trigger), or your reasoning was *flawed at the time* — which is gold, because that's a recurring bug in your thinking you can now name and install a check against.

**Follow-up:** "Won't you just stop doing it?" → Only journal decisions you'd be embarrassed to get wrong twice; journaling everything dies in a week.

---

## Q14. As a staff engineer, how do you debug a *team's* reasoning, not just your own?

You target group failure modes — groupthink, HiPPO anchoring, information cascades, shared blind spots — with process, not willpower: independent written estimates *before* discussion (kills anchoring), a rotating devil's advocate (makes dissent a role, not an attack), leader-speaks-last (so you don't anchor the room), team premortems, and decision reviews that interrogate the *argument* and record disconfirmers. And you model it: visibly change your mind on evidence so it's safe for others to.

**Follow-up:** "The team keeps under-estimating migrations. What do you do?" → Treat it as a *process* bug, not bad luck: add a guardrail (e.g., mandatory dependency checklist before sizing), then measure whether the failure rate drops. Blame fixes nothing; a missing checklist item, added once, fixes it permanently.

---

## Q15. How do you make your reasoning legible to others?

Write the *reasoning*, not just the conclusion. "We chose Kafka" is undebuggable; "We chose Kafka *because* we need replay + ordered partitions, *accepting* operational complexity, *rejecting* SQS for lack of replay" is a traceable argument — someone can find the exact step that was wrong if it turns out wrong. In RFCs/ADRs, add explicit **assumptions + disconfirmers** and a **confidence level**, turning "here's our plan" into "here's a falsifiable hypothesis we can score later."

**Trap:** Confusing *documentation* (records the decision) with *legibility* (records the causal argument). Only the latter is debuggable.

---

## Related

- [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [tasks](tasks.md)
- [Cognitive biases in code decisions](../../04-critical-thinking/03-cognitive-biases-in-code-decisions/) · [Debugging as problem-solving](../../02-problem-solving/05-debugging-as-problem-solving/)
- Back to [Metacognition & learning](../) · [Engineering Thinking](../../README.md)
