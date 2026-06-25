> Interview questions on separating claims from evidence and reasoning in engineering arguments. Answers are short and precise; each flags the trap and a likely follow-up. The skill being probed is whether you reason about *evidence quality* and *causation* under pressure — not whether you can recite Toulmin.

---

## Q1. Decompose this into claim, evidence, and reasoning: "We should rewrite the parser in Rust because it'll be faster."

- **Claim:** rewrite the parser in Rust.
- **Evidence offered:** none — "it'll be faster" is a prediction, not an observation.
- **Reasoning/warrant (implicit):** "Rust is faster than our current language, therefore our parser will be faster," which assumes the language is the bottleneck.

**Trap:** treating "Rust is faster" as evidence. It's a warrant, and an unverified one. **Follow-up:** "What evidence would justify this?" → a production profile showing the parser is a meaningful share of time, plus a spike proving the rewrite actually moves it.

## Q2. What's the difference between an anecdote, a measurement, and a proof?

- **Anecdote:** one uncontrolled observation ("it failed once for me"). Valid as a reason to *investigate*, not to *conclude*.
- **Measurement:** a counted, repeatable observation under known conditions ("0.3% of 10k requests 500'd").
- **Proof:** a logical guarantee independent of any run ("the type system makes this branch unreachable").

**Trap:** treating one green test run (anecdote, n=1) as a guarantee (proof). **Follow-up:** "Where does a passing CI suite sit?" → measurement, not proof — it shows the cases you tested pass, not that the code is correct.

## Q3. Rank these from weakest to strongest evidence that a service is slow: a production flame graph, "it feels slow," a microbenchmark, a single timeout report, a load test.

Weakest → strongest: **"it feels slow"** (impression) < **single timeout report** (anecdote) < **microbenchmark** (isolated, synthetic) < **load test** (realistic, controlled) < **production flame graph** (real workload, real system).

**Trap:** ranking the microbenchmark above the load test because it has a number. A number from unrealistic conditions is weaker than a measurement under real load. **Follow-up:** "When could the flame graph mislead?" → bad provenance — captured on a laptop, cold cache, single-threaded, or during a non-representative window.

## Q4. A microbenchmark shows `parseDate` is 40% faster. Is "the service will be 40% faster" a valid conclusion?

No. The local speedup only matters in proportion to how much of total time `parseDate` consumes. By Amdahl's law, if it's 0.5% of request time, a 40% improvement yields `1 / (0.995 + 0.005/1.4) ≈ 1.0014` — about 0.2% overall. **The claim leaps from a component measurement to a system claim without the warrant that the component dominates.**

**Follow-up:** "What evidence makes the rewrite worth it?" → a production profile showing `parseDate` is a large fraction of time.

## Q5. p99 latency spiked one minute after a deploy. Is the deploy the cause?

Not established — that's correlation. The deploy *preceded* the spike (temporality holds), but other things could have changed simultaneously: a traffic surge, a batch job, a dependency degradation, a noisy neighbor.

**To upgrade to causation:** roll back and see if it recovers, then re-deploy and see if it returns (consistency/experiment); confirm a *mechanism* (how would this change add latency?); rule out concurrent changes. **Trap:** "we rolled back and it recovered, so it was the deploy" — invalid if a confounder (e.g. the batch job finishing) recovered at the same time.

## Q6. Name the Bradford Hill–style criteria you'd use to move from "A correlates with B" to "A caused B" in an incident.

Temporality (cause precedes effect), strength (effect large vs. noise), consistency (reproduces on intervention), dose-response (more cause → more effect), plausibility (a named mechanism), and experiment (controlled intervention — the decisive one).

**Trap:** stopping at temporality. "It happened after" is the *weakest* signal — post hoc ergo propter hoc. **Follow-up:** "Which is strongest?" → the controlled experiment / intervention; everything else only adjusts your prior.

## Q7. A teammate says "Google does it this way, so we should too." How do you respond?

It's an appeal to authority/prestige; the warrant is "what works at Google works for us," which holds only if the *constraints* match. Ask: do we have their scale, team size, failure tolerance, and data volume? Their solution is evidence that it works *under their conditions*, not a prediction for ours.

**Non-jerk framing:** "Their approach is a strong signal — let's check which of their constraints we share before adopting the warrant." **Follow-up:** ties to [first-principles thinking](../../05-first-principles-thinking/) — re-derive instead of borrowing.

## Q8. What does "extraordinary claims require extraordinary evidence" mean for a bug report?

Sagan's standard: the evidence you owe scales with how surprising the claim is. "Adding a missing index sped up my query" is mundane — one `EXPLAIN ANALYZE` suffices. "The standard library's sort has a bug" is extraordinary — millions use it, it's heavily tested — so you owe a minimal reproducible case on a clean checkout before anyone should believe you.

**Trap:** taking offense at heavy pushback on a rare claim. The bar is high *because* the claim is unusual, not because anyone doubts you personally.

## Q9. How do you ask for evidence in code review without coming across as hostile?

Attack the idea, not the person. Frame yourself as wanting to be convinced: "I want to agree — what did you measure that points to the cache? If we have a trace I'll sign off." The most useful phrase is **"What would change your mind?"** because it converts a standoff into a shared experiment and reveals whether the disagreement is about evidence or taste.

**Follow-up:** "What if they ask *you* the same?" → answer it honestly; if you can't name evidence that would flip your view, you're defending a preference.

## Q10. What is a warrant in Toulmin's model, and why does it matter most in disputes?

The warrant is the general rule that licenses moving from evidence (grounds) to claim. It matters because most engineering disputes feature *agreed grounds* and *conflicting warrants*: both engineers see "40% CPU in GC," but one's warrant says "reduce allocations" and the other's says "tune the GC." Until you surface the warrants, you argue claims forever.

**Follow-up:** "How do you resolve it?" → find the evidence that distinguishes the warrants (an allocation profile vs. a `GOGC` sweep) and pre-commit to the decision rule.

## Q11. What's the difference between reproducible and non-reproducible evidence, and how should it change your confidence?

Reproducible: you can trigger it on demand → you can bisect, verify a fix, and write a regression test → high confidence and the right to act. Non-reproducible: a lead, not a finding → you can hypothesize and instrument, but "fixing" something and declaring victory is cargo-cult debugging (Feynman's term) — you changed a thing and the symptom vanished, learning nothing about whether they're related.

**Right phrasing for a flaky fix:** "This *should* fix it; we couldn't reproduce, so we added logging to confirm in prod over a week."

## Q12. What is calibration, and how do you make a conclusion as confident as the evidence allows but no more?

Calibration is the match between stated confidence and actual hit rate — a calibrated "90% sure" is right 9 times in 10. Match your verb to your evidence tier: "this *proves*" (tier-A + reproduced), "strongly suggests" (one solid run), "I think" (reasoning, no measurement), "possibly" (anecdote). Pre-commit predictions before running experiments to kill hindsight bias, and down-weight claims you *want* to be true.

**Trap:** overconfidence — most engineers' "definitely" is right ~70% of the time. **Follow-up:** "Why down-weight your own PR's claims?" → you have a stake; demand of yourself the evidence you'd demand of others.

## Q13. What is steelmanning and why do it before refuting?

Steelmanning is restating the opposing argument in its *strongest* form, confirming you've got it, then engaging that version — the opposite of a straw man. It's an evidence-quality practice: it forces you to find the best evidence *for* the view you oppose, which is exactly the evidence most likely to change your mind if it exists. After steelmanning, a disagreement that survives is trustworthy.

**Follow-up:** "What if steelmanning convinces you?" → good — that's the system working; you avoided shipping a worse decision.

## Q14. Your A/B test shows the overall conversion rate improved, but you suspect something's off. What could a single aggregate number hide?

Simpson's paradox (every segment got worse but a mix shift lifted the aggregate), survivorship (slow/failed sessions dropped out of the sample), selection bias in cohort assignment, and regression to the mean (you intervened after a dip). Always slice by cohort and check the requests/users that *didn't* complete before trusting an aggregate.

**Follow-up:** "What evidence settles it?" → segment-level breakdowns with comparable populations; a controlled split with pre-registered metrics.

## Q15. Brandolini's law says refuting nonsense costs ~10× more than producing it. As a tech lead, how do you defend a team against confident-but-wrong claims?

You can't win the refutation arms race downstream, so move upstream: **raise the bar for *making* high-impact claims**, not just for challenging them. Require the warrant and a rebuttal ("what would make this wrong?") in design docs, normalize confidence qualifiers, and apply Hitchens's razor symmetrically — a claim asserted without evidence can be set aside, whether it comes from an intern or a VP. Make confident-but-unsupported assertions socially expensive to *make*.

**Follow-up:** "Why symmetric?" → if the standard bends for authority, it's not a standard, it's politics.
