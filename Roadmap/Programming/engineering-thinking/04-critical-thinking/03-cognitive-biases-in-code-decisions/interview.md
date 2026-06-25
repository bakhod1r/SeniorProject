> Interview questions on cognitive biases in technical decisions. Strong answers name the bias precisely, give a concrete engineering manifestation, and pair it with a *structural* debiasing tactic — not "just be aware." Watch for the trap in nearly every question: "awareness" is not a debiasing strategy. References worth knowing: Kahneman *Thinking, Fast and Slow*; Tversky & Kahneman (1974, 1979); Kruger & Dunning (1999); Parkinson (1957); Flyvbjerg (reference-class forecasting); Heath & Heath (curse of knowledge).

---

## Q1. What is confirmation bias and how does it show up in debugging?

It's the tendency to seek, interpret, and recall evidence that confirms a hypothesis you already hold. In debugging it makes you fixate on the first suspected cause, read only the logs that fit it, and dismiss contradicting signals. You "confirm" a theory for an hour while the real bug sits untouched.

**Debias:** before fixing, state the *cheapest test that would prove the theory wrong* and run it first; list at least two hypotheses so no single one gets privileged.

**Trap:** "I just stay objective" is not an answer — confirmation bias is strongest in people who believe they're objective. **Follow-up:** how would you bake disconfirmation into a *team's* process? (Assign a reviewer to argue the opposite reading.)

---

## Q2. Explain anchoring with an estimation example.

Anchoring (Tversky & Kahneman, 1974) is the pull of an initial reference value on subsequent judgments. Someone says "this is about 2 days," and every later estimate orbits that number even after you discover hidden complexity. The anchor doesn't have to be relevant to bias you.

**Debias:** independent silent estimates *before* anyone speaks a number, revealed simultaneously; estimate by decomposing and summing sub-tasks from scratch.

**Follow-up:** is anchoring only about numbers? No — a first design proposal anchors a whole architecture discussion the same way.

---

## Q3. Distinguish the availability heuristic from recency bias, with an incident example.

Availability: things *easy to recall* feel more frequent/likely (the dramatic outage, not the boring base rate). Recency: a special case where *recent* events dominate because they're freshest. After a memorable security incident, the team over-invests in security for a year (availability) while a statistically larger reliability risk is ignored.

**Debias:** decide from the *incident base rate* across the whole history, not the most salient one; maintain an incident-class dashboard so prioritization uses the distribution.

**Trap:** candidates often conflate the two — recency is a subset of availability driven specifically by recentness.

---

## Q4. What is the planning fallacy, and what's the single best tactic against it?

The planning fallacy (Kahneman & Tversky, 1979) is the systematic tendency to underestimate task time/cost because we take the **inside view** — imagining this specific task on its best behavior and skipping the friction (review, tests, surprises).

**Best tactic: reference-class forecasting** (Flyvbjerg) — the **outside view**. Ignore the task's details; ask "how long did *similar* tasks actually take?" and use that distribution. It beats decompose-and-imagine because it captures the friction you systematically forget.

**Follow-up:** what if you have no historical data? Use a rough reference class anyway (industry experience, analogous projects); even a crude outside view beats a confident inside-view point estimate. Quote a *range*.

---

## Q5. Walk through reference-class forecasting on a concrete estimate.

"Small third-party API integration." Inside-view gut: 2 days. Pull the last several integrations from the tracker — say actuals of 5, 4, 6, 3, 9, 2 days → mean ≈ 4.8, with a fat right tail. So the honest estimate is ~5 days, quoted as a range (3–9) because the historical spread is real signal, not noise.

The discipline: **look up what actually happened to this class of task; don't imagine your way to a number.** Optionally compute a *class multiplier* (median actual/estimate) and apply it to future inside-view guesses.

**Trap:** picking a too-narrow reference class ("only integrations with *this exact* vendor") to get back to the number you wanted — a form of confirmation bias.

---

## Q6. What is the IKEA effect / not-invented-here, and how does it distort architecture?

The IKEA effect (Norton, Mochon & Ariely, 2012) is over-valuing what you built yourself; NIH is the related distrust of external solutions. In architecture they keep a home-grown scheduler/queue/cache alive past its usefulness because *we built it* and it feels more valuable than it is — defended with reasons that are really attachment.

**Debias:** force the symmetric question — "if we didn't have this today, would we build it again exactly like this?" — and judge the artifact as if a stranger submitted it.

---

## Q7. What is bikeshedding and what causes it?

Bikeshedding (Parkinson's law of triviality, 1957) is a group spending time on an issue in *inverse* proportion to its importance, because everyone can form an opinion on the easy, visible thing. Parkinson's example: a committee approves a nuclear reactor quickly but argues for an hour about the bike shed's roof. In reviews: 40 comments on variable naming, zero on the subtle pagination off-by-one.

**Debias:** timebox; route trivial decisions to a single owner rather than the group; mark non-blocking comments (`nit:`) so triviality can't masquerade as a blocker.

---

## Q8. Why is hindsight bias dangerous in postmortems, and how do you counter it structurally?

Hindsight bias (Fischhoff, 1975) makes the outcome look inevitable and obvious *once you know it*, so a reasonable action taken with the information available at the time looks negligent in retrospect. It assigns unfair blame and produces useless "be more careful" action items.

**Counter:** blameless postmortem with a **knowable-at-the-time** timeline; the question is never "why didn't you see it sooner?" but "why did the system make it hard to see?" Rule: *every action item changes a system, tool, or process — none changes a person's attitude.*

**Follow-up:** does blameless mean no accountability? No — Dekker's *Just Culture*: honest errors and reasonable judgments are learning signals; reckless choices still carry accountability. Also separate postmortems from performance review or you lose the truth.

---

## Q9. What's the curse of knowledge and why does it make senior devs write bad docs?

The curse of knowledge (Camerer, Loewenstein & Weber, 1989; Heath & Heath, 2007) is the inability to un-know what you know — you can't simulate not understanding a concept you've internalized. So experts omit the "obvious" steps that are actually reflexes, producing docs full of unexplained jargon and skipped context that novices can't follow. (The tappers-and-listeners study: tappers expected ~50% recognition; actual was ~2.5%.)

**Debias:** you can't introspect out of it — *outsource the test.* Novice-test the docs (watch a new person follow them silently; every stumble is a missing step); treat every "how do I…" question as a documentation defect; have recent joiners author/review docs.

---

## Q10. Explain the Dunning–Kruger effect — including the part people get wrong.

Kruger & Dunning (1999): low-skill individuals overestimate their competence because the skill needed to do the task is the same skill needed to evaluate it. The commonly-omitted half: high-skill individuals tend to *underestimate* their relative standing (assuming what's easy for them is easy for all — itself curse-of-knowledge), and experts can over-extend confidence from a domain they know into an adjacent one they don't.

**Engineering form:** a strong backend engineer redesigns the frontend build with unwarranted confidence. **Debias:** require a second opinion from *outside the decider's expertise* on cross-domain calls; normalize saying "I'm out of my domain here."

---

## Q11. What is automation bias and why is it growing?

Automation bias is over-trusting automated outputs and under-weighting contradicting evidence: merging because CI is green, accepting an AI code suggestion because it looks plausible, trusting the autoscaler. It grows as more of the toolchain becomes "smart." Two shapes: *commission* (do what the tool says, the tool was wrong — e.g., shipping an AI-hallucinated API) and *omission* (the tool didn't flag it, so you assumed it was fine — a passing linter ≠ correct).

**Debias:** treat automation output as a *strong hypothesis, not a verdict*; keep a human verification step on what matters; know each tool's blind spots (a green SAST scan is not "secure").

---

## Q12. What's the difference between a cognitive bias and a logical fallacy?

A bias is a systematic error in *judgment/perception* (how the mind estimates likelihood, value, time). A fallacy is an error in the *structure of an argument* (an invalid inference). They interact: confirmation bias (judgment) often produces cherry-picking (a fallacious argument); availability bias shows up as anecdotal-evidence reasoning. **Follow-up:** which is easier to fix? Fallacies are easier to catch because they're in the explicit argument; biases operate pre-consciously, which is why they need *structural* defenses, not just inspection.

---

## Q13. Why doesn't "just being aware of biases" work, and what does?

Because biases operate in fast, automatic System 1 (Kahneman) — they fire *before* deliberate reasoning, so knowing the name doesn't disarm the reflex. Anchoring still works on people who can define it. What works is **structure**: independent estimates before discussion (anchoring), pre-mortems (confirmation), blind/uniform review (halo), reference-class forecasting (planning fallacy), rotated devil's advocate (groupthink), checklists (uniformity). The pattern: make the bias *hard to act on* rather than relying on willpower.

---

## Q14. A senior insists on keeping a custom-built tool over an off-the-shelf one. Which biases might be operating and how do you handle it?

Likely a cocktail: **IKEA effect** (over-valuing what they built), **NIH** (distrust of external tools), **status-quo bias** (change feels riskier than staying), and possibly **sunk-cost** reasoning (years invested). The reasons given are often aesthetic or about attachment rather than data.

**Handle it without making it personal:** force the symmetric, neutral question — "if we had neither today, which would we choose for the next three years?" — and make the *cost of keeping it* (maintenance, bus factor, opportunity) explicit on the same page as the cost of switching. Decide from that comparison, not from authorship. See also [evaluating tradeoffs objectively](../04-evaluating-tradeoffs-objectively/).

---

## Q15. How would you design an org-level process so estimates resist the planning fallacy by default?

Instrument **estimate-vs-actual** for every meaningful work item to build a reference-class dataset; derive per-class multipliers (median actual/estimate) and apply them to inside-view guesses; require **ranges with confidence**, never single dates; **separate estimate from commitment** (estimate is empirical, commitment is a business risk decision); **buffer at the portfolio level** not per task (Parkinson's law eats per-task padding); and **audit calibration quarterly** (do your 90% ranges contain the outcome ~90% of the time?). This institutionalizes reference-class forecasting so the average team is debiased *without* a bias-aware facilitator present.

**Trap:** answering only at the individual level — the question is about *defaults* and *governance*, the staff/principal scope.
