> Interview questions on **base rates and expected value** — the everyday probabilistic tools. Answers are short and precise, with the trap each question is probing and a likely follow-up. Expect to *do arithmetic* on EV, reason about base rates, and explain why max-EV is not always the right rule.

---

## Q1. What is a base rate, and why does it matter for debugging?

A base rate is the prior probability of an event in general, before you look at the specific case. In debugging it's your starting hypothesis: most outages follow a recent config/deploy change, and most bugs live in the code that just changed. So you check the last diff and recent deploys *first*, rather than inventing an exotic theory.

**Trap:** confusing "base rate" with "the probability after seeing evidence." It's the *prior*. **Follow-up:** *How do you get a real base rate for your team?* Tally past postmortems by root-cause category.

---

## Q2. Explain base-rate neglect with an example.

People judge probability by *resemblance* (representativeness) instead of *frequency*. Classic case: a "99% accurate" test for a condition that occurs in 1 of 1,000 cases. Run 1,000: ~1 true positive, ~50 false positives (5% of 999). A positive result is real only ~1/51 ≈ 2% of the time. The vivid "99%" makes people ignore the tiny base rate.

**Trap:** answering "99%." **Follow-up:** *What does this imply for noisy alerts on rare failures?* Most fire-on-rare-event alarms are false positives — tune thresholds or you get alert fatigue.

---

## Q3. What's the difference between the inside view and the outside view?

Inside view: estimate by imagining this task's steps — prone to the planning fallacy (systematically optimistic). Outside view (reference-class forecasting, Kahneman/Flyvbjerg): estimate by how long *similar past tasks actually took*. The outside view is more accurate because the reference class already contains the surprises you can't picture.

**Follow-up:** *How do you define a good reference class?* Specific enough to be relevant, broad enough to have 5+ members, and use the median/p80 — not the best case.

---

## Q4. Write the expected value formula and compute one.

`EV = Σ (probability × payoff)`. Retry a flaky call: 80% it succeeds (+10), 20% it still fails (−1).

```
EV = 0.80 × 10 + 0.20 × (−1) = 8.0 − 0.2 = +7.8
```

Positive EV → retry is worth it on average.

**Trap:** forgetting EV is an *average over many trials*, not the result of one try. **Follow-up:** *When does this retry logic backfire?* When failures are correlated (dependency is down) — retries add load and cause storms; gate behind a circuit breaker.

---

## Q5. You have three bugs and time for one. How do you choose with EV?

Rank by **expected cost if left unfixed** = P(occurs) × cost(occurs), then ideally divide by fix cost for ROI. Example:

| Bug | P/week | Cost | Exp. cost |
|---|---|---|---|
| A rare crash | 0.02 | 500 | 10 |
| B cosmetic | 0.90 | 8 | 7.2 |
| C double-run job | 0.30 | 120 | **36** |

Fix C — highest expected cost — even though A is scarier per event and B is more visible.

**Trap:** fixing the loudest or the scariest. **Follow-up:** *Why divide by fix cost?* To prioritize by ROI, not just raw expected loss.

---

## Q6. Why isn't the maximum-EV option always the right choice?

Three reasons: **(1) Ruin / non-ergodicity** — a +EV bet with a small chance of irreversible catastrophe converges to ruin over repetition; you must reject it regardless of EV. **(2) Fat tails** — when losses can be unbounded, the mean is unstable and underestimates the tail. **(3) Risk aversion** — variance has cost; a guaranteed +40 can beat a coin-flip averaging +50 because predictability matters.

**Follow-up:** *Give the engineering version of ruin.* A +EV deploy process with 1% chance of irreversible data loss: `0.99⁷⁰ ≈ 50%` survival over 70 deploys — unacceptable. Make the catastrophe impossible, don't average it.

---

## Q7. Explain non-ergodicity / the ruin problem in one paragraph.

The ensemble average (EV across many parallel players) can be positive while the time average (one player across time) is negative, because losses compound and ruin is absorbing — once wiped out, you stop playing. Ole Peters and Nassim Taleb formalized this. Engineering upshot: a company is *one* player on *one* timeline, so a small per-period chance of catastrophe accumulates to near-certain ruin. Eliminate it; don't price it into the EV.

**Follow-up:** *So is EV useless?* No — it's correct *within the survivable region*. Apply EV only after a no-ruin filter passes.

---

## Q8. What is the St. Petersburg paradox and what does it teach?

A game pays `2^n` if the first heads comes on toss n; P = `1/2^n`. EV = Σ (1/2^n × 2^n) = 1 + 1 + 1 + … = ∞. Yet no one pays much to play. Bernoulli (1738) resolved it: people maximize *utility* (which is concave — diminishing returns), not raw money EV. Lesson: maximizing expected *value* isn't the same as maximizing expected *utility*; risk aversion is rational.

**Follow-up:** *Engineering analogue?* Don't chase an unbounded theoretical upside (e.g., a rewrite "that could 10x everything") while ignoring that its utility/feasibility distribution is far less rosy than its headline EV.

---

## Q9. What is expected value of information, and when should you run a spike?

`EVI = EV(decision with the info) − EV(best decision without it)`. Run the test only if `EVI > cost of the test`. Crucially, if the result *can't change your decision*, EVI = 0 — never run it. A spike's value comes entirely from the bad outcomes it lets you avoid.

**Follow-up:** *Quick example.* If picking A blindly = +18 EV, and a spike lets you avoid A's −30 bad case to reach +38, EVI = +20 → run the spike if it costs < 20.

---

## Q10. How does SRE use expected value?

Two ways. **Error budgets:** an SLO (e.g., 99.9%) sets a downtime budget (~43 min/month) you "spend" on risky changes — an explicit EV trade of reliability for velocity. **Risk scoring:** `risk = P(incident) × blast_radius`. Canarying keeps P roughly the same but shrinks blast radius, lowering EV-risk — that's why progressive delivery is the default.

**Follow-up:** *Where does the SLO number come from?* The EV-optimal point: more nines than users value is negative-EV; fewer causes churn.

---

## Q11. Most novel ideas fail. How do you square that base rate with innovating?

Treat ideas as a **portfolio of bets**: each individually likely to fail, but with *capped downside* (bounded cost, reversible, time-boxed) and *uncorrelated* causes of failure. Positive portfolio EV comes from one outsized winner dominating many small losses (Taleb's optionality). The base rate tells you to keep each bet cheap and to run several, not to stop innovating.

**Trap:** concluding "innovation is −EV." The base rate argues for *cheap, diversified* bets, not for none. **Follow-up:** *Why must bets be uncorrelated?* Otherwise they all fail together and the portfolio becomes one fat-tailed wager.

---

## Q12. A test is 95% accurate for a bug that appears in 1% of builds. The test fires. P(real bug)?

Use natural frequencies over 1,000 builds: 10 real bugs (≈9.5 caught), 990 clean (≈49.5 false positives at 5%). `P(real | fire) ≈ 9.5 / (9.5 + 49.5) ≈ 16%`.

**Trap:** saying 95%. **Follow-up:** *How to raise that posterior?* Lower the false-positive rate (more specific test) or apply it where the base rate is higher (only on changed files).

---

## Q13. Reference-class forecasting says a migration is ~8 days; your gut says 4. Which do you commit to and why?

Commit closer to the reference-class number, and quote a range (p50 ≈ 8, p80 ≈ 11). The outside view beats the inside view because the planning fallacy is systematic, and "this one is simpler" is exactly the optimism the method corrects. Promise the p80; plan capacity to the p50.

**Follow-up:** *When is the gut right?* Only with concrete evidence this task is genuinely outside the class — and the burden of proof is on the optimistic claim.

---

## Q14. Build vs buy — frame it as EV.

Put both in one currency over a fixed horizon, enumerate outcomes with probabilities, include opportunity cost, and use your *reference-class overrun ratio* for the build's bad case. Compare EVs. Then apply the ruin/variance check: if "build" carries a small chance of an unrecoverable failure (key-person dependency, can't ship) or buy carries vendor lock-in tail risk, weigh that *outside* the EV number.

**Follow-up:** *What flips a buy to a build?* Strategic differentiation (the capability is your moat) — a value term EV tables often understate.

---

## Q15. Give a one-line decision rule that combines everything.

**Survive first, optimize second:** reject any option with a non-trivial chance of irreversible/existential loss (engineer it to be reversible if you can); among the survivable options, pick the highest EV, adjusting for variance and the value of information.

**Follow-up:** *Where do base rates enter?* They set the probabilities in every EV term and the prior you start every investigation and estimate from.
