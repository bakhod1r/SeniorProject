> Debugging questions probe *method*, not trivia. The interviewer wants to hear a systematic, hypothesis-driven process — reproduce, observe, falsifiable hypothesis, cheapest discriminating test, change one thing, verify by toggling — and to catch the anti-patterns (shotgun changes, symptom-fixing, "it works now"). Answers below are short and sharp; the traps and follow-ups are what separate a senior answer from a junior one.

---

## Q1. Walk me through your process for debugging an unfamiliar bug.

Reproduce it reliably first — a bug you can trigger on demand is half-solved. Then observe the actual behavior (read the error, the stack trace, the logs, the state) rather than theorizing. Form *one* falsifiable hypothesis. Design the cheapest test whose outcome differs depending on whether the hypothesis is true. Run it, update, repeat — each test halving the search space. Change one thing at a time, keep notes. Stop only when I can turn the bug on and off, which proves I understand the mechanism.

**Trap:** Candidates who jump straight to "I'd add a fix here." There's no fix before there's a confirmed cause. **Follow-up:** "What if you can't reproduce it?" → that *is* the bug; find the hidden variable (data, timing, env, order) and pin it.

---

## Q2. Production is down. Walk me through it.

Two parallel tracks, stated explicitly: **mitigate** and **diagnose**. Mitigation first — what changed? If a deploy correlates with the onset, roll it back or flag it off to stop the bleeding; don't wait to fully understand it. In parallel, diagnose: use metrics to find what/when, traces to find which service/hop, logs/events for why. Bisect by cohort (region, tenant, build, version) to shrink the population. One mitigating change at a time, announced. Root cause is a separate, non-urgent track after the bleeding stops.

**Trap:** Conflating mitigation and root cause — debugging the system while it's still on fire instead of rolling back. **Follow-up:** "No deploy correlates?" → bisect topology (disable a dependency, fail over) and cohort instead.

---

## Q3. Why is "I changed it and now it works" not good enough?

Because you don't know *why*. If you changed several things, you don't know which fixed it (and you may have added new bugs). If you changed one thing but don't understand the mechanism, the symptom is hidden, not fixed — it'll return at the worst time. "It works now and I don't know why" is a red flag, not a resolution. Agans Rule 9: *if you didn't fix it, it ain't fixed.*

**Follow-up:** "How do you *know* it's fixed?" → I can toggle it: apply the fix → gone, revert → back, reapply → gone. That round-trip proves my change addressed this bug and I understand the mechanism.

---

## Q4. What does "change one thing at a time" buy you, and when is it hard?

It preserves the cause-and-effect link: if you change one variable and the behavior changes, you've learned something exact. Change three and the result is uninterpretable. It's hard under incident pressure (you want to try everything at once) and across people (a sev-1 call with five engineers each changing config). The discipline is to serialize changes — announce each, predict its effect, have a rollback.

**Trap:** Treating it as a nicety rather than the thing that makes experiments *mean* anything.

---

## Q5. Explain binary search applied to debugging. Give three forms.

Each test splits the remaining suspects roughly in half: O(log n) instead of O(n) guessing. (1) **`git bisect`** over commits — "worked at this tag, broken now" + a deterministic test → ~log₂(N) checkouts find the introducing commit, automatable with `git bisect run`. (2) **Bisect the input** — delete half a failing 10k-line file, re-run; the half that still fails contains the cause; repeat. (3) **Bisect the stack/pipeline** — check the value at the midpoint of the call chain; if it's already wrong, the bug is upstream, else downstream.

**Follow-up:** "What's the prerequisite for `git bisect`?" → a reliable, scriptable pass/fail test for each commit.

---

## Q6. What's the difference between fixing the symptom and fixing the cause? Give an example.

The symptom is where the failure *surfaces*; the cause is where the wrong state *originates*. Example: a 500 because `tax` is `NaN`. Symptom fix: `if (isNaN(tax)) tax = 0` — crash stops, wrong totals ship silently, disease lives on. Cause fix: trace back via the five whys — the tax service returned `undefined` for a new region whose row was never seeded — and add a NOT NULL constraint plus an onboarding step. Always fix where the wrong value is born, not where it explodes.

**Trap:** A `try/catch` that swallows the error, a `?? default` that masks the null, or a retry that hides a race — all symptom fixes dressed up as solutions.

---

## Q7. A test passes alone but fails in the suite. What's your hypothesis and how do you confirm?

Hypothesis: test pollution — shared mutable state (a global, a DB row, a singleton, a cached connection) leaked by an earlier test. Confirm by bisecting the suite: run the failing test with halves of the others until you find the minimal predecessor that triggers it. Then randomize test order to expose the hidden coupling. The fix is isolation — each test sets up and tears down its own state.

**Trap:** Blaming the test runner or "flakiness" instead of suspecting shared state. Order-dependence is a real, findable cause.

---

## Q8. What's a heisenbug, and how do you debug one?

A bug that changes or disappears when you observe it — adding a log or attaching a debugger perturbs timing or suppresses a compiler optimization, so the symptom vanishes. The disappearance *is* the clue: it points at a timing- or optimization-sensitive cause — a race, an uninitialized read, or undefined behavior. Switch to low-perturbation observation (ring-buffer logging, post-hoc tracing, core dumps), and reason from the constraint the disappearance reveals rather than from the now-hidden symptom.

**Follow-up:** "Suspect a race specifically?" → run under a race/thread sanitizer, stress-loop to amplify, and widen the window with an injected delay to confirm and localize.

---

## Q9. How do you make a flaky, 1-in-500 bug reproducible?

Find the hidden variable that flips the outcome, then amplify or pin it. **Loop it** — run the failing case thousands of times so a rare event becomes near-certain per batch. **Widen the window** — for a suspected race, inject a delay at the suspect point; if the failure rate jumps, you've confirmed and localized it. **Pin the environment/data** — diff the environments (versions, config, locale, clock) and bisect the dataset to the specific record. The goal is to turn "sometimes" into "every time" or to explicitly name the variable that flips it.

---

## Q10. How does a stack trace help, and how do you read one?

It's a map from the crash back to its origin. Read the **error message** first — its *type* already halves the search space (e.g. "undefined reading 'name'" → something was undefined). Then go to the **top frame** — that's where it actually broke; go there first. The lower frames are the path that got you there: useful for "who passed the bad value," but the top frame is where you start. Open that line and ask which value could be in the failing state — that's your first hypothesis.

**Trap:** Scrolling past the error to start guessing in the code. The message and line number are free, precise facts.

---

## Q11. What are the five whys and when do you use them?

A root-cause technique (Toyota): ask "why" repeatedly past the proximate failure until you reach a cause you can actually remove. Each "why" moves the fix one layer deeper and far more durable — from `tax=0` (hides it) to "validate at the boundary" to "seed the row" to "add a schema constraint and an onboarding checklist" (makes the class impossible). You use it once you have a confirmed cause, to decide *how deep* to fix. Stop at the layer where the fix is durable and proportionate to the risk.

---

## Q12. The bug seems to be in a third-party library. How do you proceed?

Suspect my own code first — *"select isn't broken"*; it's true the large majority of the time. "Check the plug": confirm I'm on the version, config, and environment I think I am. If evidence still points outward, prove it with a **minimal reproduction outside my code** — a 20-line program or a `curl` that triggers it with nothing of mine involved. That repro is both my proof and my bug report; it ends "works on my machine" and gives the maintainers something they can't argue with.

---

## Q13. How do you debug something you can't reproduce locally, only in production?

You debug from telemetry you already collect — you can't add a debugger to a live fleet. Metrics tell you what and when; distributed traces are the stack trace across services and tell you which hop; high-cardinality events let you bisect the population (slice by user, region, build). The real lesson is that diagnosability is a *design* property: if a prod bug isn't visible in existing telemetry, the first fix is to add the span/metric/SLO so it — and the next one — *is* visible.

**Follow-up:** "What if the telemetry to diagnose it doesn't exist?" → mitigate (rollback/shed), add the instrumentation, wait for recurrence with eyes open. That instrumentation gap is itself a finding for the post-mortem.

---

## Q14. What's rubber-ducking and why does it work?

Explaining the problem out loud, line by line, to an inanimate object (or a colleague). It works because *narrating what each line is supposed to do* forces you to confront the gap between intention and reality — you usually catch the bug mid-sentence. It externalizes your mental model so the inconsistency becomes visible. From *The Pragmatic Programmer*; it's the cheapest debugging tool there is. Agans' "get a fresh view" is the team-scale version: a new perspective sees the assumption you've gone blind to.

---

## Q15. Recite Agans' 9 rules and name the one engineers break most.

Understand the system; make it fail; quit thinking and look; divide and conquer; change one thing at a time; keep an audit trail; check the plug; get a fresh view; if you didn't fix it, it ain't fixed. The most-broken is **"quit thinking and look"** — engineers theorize about what *might* be wrong instead of instrumenting to see what *is* wrong. A close second is **"change one thing at a time"** under pressure. Both feel productive and both cost hours.

**Follow-up:** "Which matters most for hard bugs?" → "make it fail" — without reliable reproduction every other rule has nothing to operate on.

---

← Back to [Problem-Solving](../) · [Hypothesis and falsifiability](../../09-scientific-and-hypothesis-driven/01-hypothesis-and-falsifiability/) · [Engineering Thinking root](../../README.md)
