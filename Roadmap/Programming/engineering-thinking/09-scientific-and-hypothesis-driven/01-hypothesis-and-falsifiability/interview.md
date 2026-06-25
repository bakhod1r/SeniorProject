> Interview questions on hypothesis-driven engineering and falsifiability. Answers are deliberately short and precise. Watch the **traps** — most candidates can recite "form a hypothesis" but fail the follow-ups about *falsifiability*, the *null hypothesis*, and *trying to disprove* rather than confirm their favorite theory. Use these to probe whether someone actually debugs scientifically or just guesses with confidence.

---

## Q1. What's the difference between a hunch and a hypothesis?

A hunch is a vague belief ("the cache is the problem"). A hypothesis attaches a **specific, falsifiable prediction**: "if I disable the cache, p99 drops below 200ms." The hypothesis names an action and a predicted, checkable result — so it can be *wrong*, which is what makes it useful.

**Trap:** candidates who think adding jargon ("I hypothesize the cache is suboptimal") makes it a hypothesis. Without a refutable prediction, it's still a hunch.

---

## Q2. What does "falsifiable" mean, and why does it matter in debugging?

Falsifiable (Popper) means there exists an observable result that would prove the claim **false**. It matters because a claim nothing can disprove tells you nothing and can't be acted on. "It's probably a network blip" is unfalsifiable as stated — no result contradicts it — so it stalls investigations instead of advancing them.

**Follow-up:** *Make "network blip" falsifiable.* → "If transient, the errors cluster in a <60s window and don't recur; if I see them steadily over the next hour, it wasn't a blip."

---

## Q3. What is a "kill criterion" and when do you write it?

The result that makes you **abandon** the hypothesis — written *before* you run the experiment. "If I don't see Y, X is wrong." Pre-committing it stops you from staring at ambiguous output afterward and convincing yourself it "kind of confirms" the theory (goalpost drift).

---

## Q4. You believe a slow query is the cause of a latency spike. How do you test it scientifically?

Form a falsifiable prediction with a number and a kill criterion: "If this query causes the spike, p95 returns under 80ms when I revert it; **kill** if reverting leaves p95 unchanged." Change **one variable** (revert only that query) so the result is attributable. Critically, also try to *disprove* it: check whether the spike occurs in windows where that query didn't run.

**Trap:** changing several things at once, then unable to say which fixed it.

---

## Q5. What is the null hypothesis, and how does it apply to debugging?

The null hypothesis is the default "no effect / it's coincidence" position you hold until evidence forces you to reject it. In debugging the null is usually: "this is noise," "nothing changed — I just noticed it now," or "my fix did nothing." You should check it **first** and cheaply. Example: before hunting a post-deploy bug, confirm the error rate was actually *lower* before the deploy — if it was already high, the deploy is innocent and all your causal theories are distractions.

---

## Q6. You "fixed" an intermittent test, ran it once, it passed. Is it fixed?

No. The null hypothesis — "my change did nothing; it's still flaky" — is very much alive. A 50%-flaky test passes half the time by chance. You haven't rejected the null until it passes enough times (e.g., 50–100 runs) that "still broken but got lucky" is negligible.

**Trap:** treating one success as proof for an *intermittent* failure.

---

## Q7. Explain strong inference. How does it change how you debug?

Strong inference (Platt, 1964): enumerate **multiple alternative** hypotheses, then design the experiment whose outcome **excludes** one or more of them, and repeat on the survivors. It changes debugging from "test my favorite idea" to "run the test that splits the field." A good experiment is one where *every* possible outcome kills something; if a test leaves all hypotheses standing regardless of result, don't run it.

---

## Q8. Three plausible causes for a bug. How do you pick which to test first?

Rank by **expected information per unit cost** — prior probability divided by cost to test — not by likelihood alone. The most-likely cause isn't always first: if it's expensive to test and a less-likely one can be eliminated in two minutes, eliminate the cheap one first. Ideally pick the single experiment that discriminates among *several* hypotheses at once (e.g., joining the errors against multiple log sources in one query).

**Trap:** always chasing the highest-prior hypothesis regardless of test cost.

---

## Q9. What is confirmation bias and how do you fight it in an investigation?

The tendency to seek and over-weight evidence **for** your theory and ignore evidence against it. Fight it structurally, not with willpower: (1) pre-register the kill criterion publicly; (2) search for **disconfirming** evidence first; (3) write predictions *before* looking at the data (avoid HARKing); (4) assign someone to argue the null / play devil's advocate. Feynman: "you must not fool yourself — and you are the easiest person to fool."

---

## Q10. When is "change one variable at a time" wrong?

When factors **interact** (the effect of A depends on B) — one-at-a-time can't reveal interactions, so you need a factorial/multivariate design. Also when you're **firefighting** and recovery beats diagnosis (change several, restore service, isolate later). And to *localize* in a large space, structured multi-step "bisection" beats naive one-at-a-time. Default to one variable when the goal is **causal attribution**.

---

## Q11. Your top hypothesis is confirmed by the experiment. Are you done?

Not necessarily. Check whether it explains the **full magnitude** of the symptom. If the suspected cause accounts for 700ms but p99 rose by 780ms, there's an 80ms residual — a second cause. Stopping at the first confirmation is how partial fixes ship and the bug "comes back."

---

## Q12. A teammate closes an incident with "it was probably a transient blip." What do you say?

That it's an unfalsifiable, incomplete root cause. Either produce the prediction that would confirm "transient" and check it ("if so, no recurrence in the next N hours, and the errors were clustered, not steady"), or label it explicitly "root cause unknown — here's the experiment that would find it." Accepting "probably a blip" as closure is how the same incident recurs.

---

## Q13. How would you frame a system-design claim like "this will scale" so it's falsifiable?

Attach a number, a test, and a kill criterion: "At 10k RPS on this instance type, p99 stays under 250ms; we'll verify with a load test before GA. **Kill:** if p99 exceeds 250ms at 6k RPS, the design is wrong." Then run the cheap version early — a spike or prototype — *before* committing to the full build.

---

## Q14. How do you use falsifiability to challenge a long-running project you suspect is a zombie?

Reconstruct its **founding premise** from the original docs and test *that*, depersonalized. E.g., premise "the monolith can't scale to 2026 traffic" → load-test the current monolith at 3× traffic. If it falls over, the project is justified. If it sustains 3× comfortably, the stated premise is **falsified** and the project needs a new, explicitly stated justification or it winds down. You attack the premise's prediction, not the people.

---

## Q15. Quick one: give an example of an unfalsifiable claim engineers make daily, and fix it.

"Works on my machine." Unfalsifiable as stated — it predicts nothing about the broken environment. Fixed: "If the difference is environmental, the failing host differs in a specific config/version/flag; let me diff the two environments — **kill** that line if they're identical, which would point at data or load, not environment." The fix forces it to rule something out.

---

### References

- Karl Popper, *The Logic of Scientific Discovery* (1934) — falsifiability.
- John R. Platt, "Strong Inference," *Science* (1964) — exclusionary experiment design.
- Richard Feynman, "Cargo Cult Science" (1974) — not fooling yourself.
- See also: [debugging as problem-solving](../../02-problem-solving/05-debugging-as-problem-solving/), [critical thinking](../../04-critical-thinking/), [measure before optimize](../03-measure-before-optimize/).
