> Practice tasks for **base rates and expected value**. Several require a worked numeric answer — show the arithmetic. Global constraints: state every probability and payoff explicitly, keep payoffs in **one currency** per task, label any **ruin / irreversible** outcome separately (never average it into EV), and when estimating, prefer a **reference class** over imagination. A correct EV number with an un-flagged ruin risk is a *wrong* answer.

---

## Task 1 — Compute a basic EV and decide

A nightly batch can run with or without a checksum verification pass. Without: 100% it completes fast, but 4% of nights it silently corrupts output (cost 250). With: always +5 cost (the extra pass), and corruption drops to 0.2% (cost 250).

Compute EV (as expected cost) for each option and choose. **Then** answer: does the "corruption" outcome change your reasoning beyond the EV?

*Deliverable:* two EV-cost numbers, a choice, and one sentence on whether corruption is recoverable (and if not, why that overrides EV).

<details><summary>Worked answer</summary>

```
EV_cost(no check) = 0.04 × 250 = 10.0
EV_cost(check)    = 5 + 0.002 × 250 = 5 + 0.5 = 5.5
```

Checksum wins (5.5 < 10.0). If corruption is **irreversible** (no upstream copy to re-derive from), it's a ruin-flavored outcome — you'd run the check even if the EV were closer, because you can't average over a permanent data loss.
</details>

---

## Task 2 — Spot the base-rate neglect

A teammate insists a 2am latency spike "must be a kernel scheduler regression — the graph looks exactly like one." Your incident history: of the last 25 incidents, 17 were config/deploy changes, 5 were a dependency, 2 were capacity, 1 was a kernel issue.

State the base-rate prior, what your first hypothesis should be, and name the bias the teammate is exhibiting.

<details><summary>Worked answer</summary>

Prior: P(config/deploy) ≈ 17/25 = 68%; P(kernel) ≈ 4%. First hypothesis: check the most recent deploy/config change. The teammate is judging by **representativeness** ("looks like a kernel bug") and neglecting the base rate. Investigate by frequency, not resemblance.
</details>

---

## Task 3 — Reference-class forecast

You must estimate a "migrate service to new message queue" task. Inside-view gut feel: 5 days. Past infra migrations (estimate → actual): 4→9, 6→11, 3→8, 8→14, 5→9.

Compute the median actual/estimate ratio and produce a reference-class estimate with p50 and a conservative commitment number.

<details><summary>Worked answer</summary>

Ratios: 2.25, 1.83, 2.67, 1.75, 1.80 → sorted 1.75, 1.80, 1.83, 2.25, 2.67 → **median 1.83**.

```
p50 estimate ≈ 5 × 1.83 ≈ 9 days
```

Use the upper ratios (≈2.5) for a p80 commitment: `5 × 2.5 ≈ 12–13 days`. Commit ~12–13d externally; plan capacity to ~9d. The 5-day gut figure is the planning fallacy.
</details>

---

## Task 4 — Posterior from a noisy alert (base rate + EV of action)

An anomaly detector fires "possible data breach." It catches real breaches 90% of the time and false-alarms on 3% of normal days. Real breaches occur ~1 day in 2,000.

Compute P(real breach | alarm). Then: a full incident response costs 8 units; missing a real breach costs 5,000 units. Should you respond on every alarm?

<details><summary>Worked answer</summary>

Over 2,000 days: 1 real (≈0.9 caught), 1,999 clean (≈60 false alarms at 3%).
```
P(real | alarm) ≈ 0.9 / (0.9 + 60) ≈ 1.5%
```
EV of responding to an alarm: even at 1.5% real, expected averted loss = `0.015 × 5,000 = 75` vs response cost 8. **Respond** — the asymmetry (cheap response, catastrophic miss) makes it +EV despite the low posterior. (And a breach may be a ruin-class event, reinforcing "respond.")
</details>

---

## Task 5 — Retry vs fail-fast EV, then break it

A call to a flaky downstream. Fail-fast: 100% immediate error (cost 10). Retry once: 75% the retry succeeds (cost 2 for latency), 25% it also fails (cost 13).

Compute EV-cost of each and choose. Then describe the scenario where this EV-based choice becomes dangerous.

<details><summary>Worked answer</summary>

```
EV_cost(fail-fast) = 10
EV_cost(retry)     = 0.75 × 2 + 0.25 × 13 = 1.5 + 3.25 = 4.75
```
Retry wins (4.75 < 10). **Dangerous when** failures are *correlated* — if the downstream is fully down, P(success) → 0, retries just multiply load and cause a retry storm/cascading failure (a fat-tailed, possibly ruin-class outcome). Gate retries behind a circuit breaker; the EV math assumed independent transient failures.
</details>

---

## Task 6 — Expected value of information (run the spike?)

You'll choose architecture A or B. Blind: A has EV +60 but a 35% chance it's unsuitable (−40); B is safe at +25. A 3-day spike (cost 18) would reveal whether A is suitable.

Compute EV with and without the spike, the EVI, and decide.

<details><summary>Worked answer</summary>

```
EV(blind, pick A) = 0.65 × 60 + 0.35 × (−40) = 39 − 14 = 25
With spike: if "A fine" (65%) take A (+60); if "A unsuitable" (35%) take B (+25)
EV(with spike)   = 0.65 × 60 + 0.35 × 25 = 39 + 8.75 = 47.75
EVI = 47.75 − 25 = 22.75
```
EVI (22.75) > spike cost (18) → **run the spike**. Note: blind EV(A) ties B at 25, so the spike is what makes A clearly worth pursuing — its value is avoiding A's −40 case.
</details>

---

## Task 7 — Spot the ruin risk

Rank these three +EV proposals and flag any that must be *rejected or re-engineered* regardless of EV:

1. Deploy strategy: +5 EV/deploy, 1.2% chance per deploy of unrecoverable prod-DB corruption.
2. Caching change: +30 EV, worst case is a 2-minute stale-read window (auto-heals).
3. Cost optimization: +12 EV, worst case is a 1-in-3 chance of a recoverable 10-minute degradation.

<details><summary>Worked answer</summary>

#1 is a **ruin item** — unrecoverable corruption. Reject as framed despite +EV: over 60 deploys, `0.988⁶⁰ ≈ 48%` chance of catastrophe. Re-engineer to reversible (verified backups, expand/contract) before it's allowed. #2 and #3 have bounded, recoverable downside → optimize on EV normally (#2 then #3). **Survive first, optimize second.**
</details>

---

## Task 8 — Build vs buy EV table

Build the EV table (cost currency, 2-year horizon) and decide.

- **Buy:** 80% vendor fine (cost 100k); 20% forced migration (cost 240k).
- **Build:** 50% smooth (cost 160k); 50% overruns at your reference ratio (cost 300k).

Then state one non-EV factor that could legitimately flip the decision.

<details><summary>Worked answer</summary>

```
EV_cost(buy)   = 0.80 × 100k + 0.20 × 240k = 80k + 48k = 128k
EV_cost(build) = 0.50 × 160k + 0.50 × 300k = 80k + 150k = 230k
```
EV says **buy** (128k < 230k). Legitimate flip: if the capability is a *strategic differentiator* (your moat), the value of owning it is undercounted in pure cost-EV; or if "buy" carries vendor lock-in *tail risk* (price hike / shutdown) you must weigh outside the EV.
</details>

---

## Task 9 — Prioritize a reliability backlog by ROI

Rank by ROI = (expected loss averted) / (fix cost):

| Item | P/quarter | Cost if it happens | Fix cost |
|---|---|---|---|
| Idempotent payment webhook | 0.25 | 400k | 12k |
| p99 latency cut | 0.90 | 25k | 35k |
| Flaky deploy step | 0.40 | 80k | 10k |
| Log lib migration | 0.10 | 15k | 30k |

<details><summary>Worked answer</summary>

```
Webhook: 0.25×400k / 12k = 100k / 12k = 8.33
Latency: 0.90×25k  / 35k = 22.5k / 35k = 0.64
Deploy:  0.40×80k  / 10k = 32k / 10k  = 3.20
Logs:    0.10×15k  / 30k = 1.5k / 30k = 0.05
```
Order: **webhook → deploy → latency → logs.** The log migration is near-zero ROI now — defer it despite being tempting hygiene.
</details>

---

## Task 10 — St. Petersburg / unbounded-EV trap

A vendor pitches a feature where "the upside is basically unlimited." Their headline EV is enormous, driven almost entirely by a <1% scenario with a giant payoff.

Explain, referencing the St. Petersburg paradox, why a huge headline EV doesn't justify the bet, and what you'd compute instead.

<details><summary>Worked answer</summary>

St. Petersburg (Bernoulli, 1738): a game with *infinite* EV that no rational person pays much for, because we maximize **utility** (concave, diminishing) not raw EV, and the EV is dominated by negligible-probability tail events. Same here: an EV propped up by a <1% giant payoff is fragile and unactionable. Compute instead the EV **excluding the fat tail** (does it still pay?), the **downside/variance**, and the **utility** to the org — and demand a capped-downside, reversible pilot before committing.
</details>

---

## Task 11 — SRE: error budget as EV

Your SLO is 99.95% monthly availability ≈ 21.6 min/month budget. You've spent 14 min this month. A risky migration has a 20% chance of a 30-min outage and 80% chance of 0.

Compute expected budget spend and decide whether to ship now or wait for next month's budget.

<details><summary>Worked answer</summary>

```
Expected spend = 0.20 × 30 + 0.80 × 0 = 6 min
Remaining budget = 21.6 − 14 = 7.6 min
```
Expected spend (6) < remaining (7.6), so on *average* it fits. **But** the *worst case* (30 min) blows the budget by 22 min — if a single full SLO miss has outsized consequences (customer SLA penalties = a tail/ruin term), wait or canary to shrink the 30-min blast radius. EV says marginal-go; tail-awareness says de-risk first.
</details>

---

## Task 12 — Design a base-rate-driven runbook step

Write the first three steps of an incident runbook so that the team's measured base rates (≈70% config/deploy, ≈15% dependency, ≈10% capacity) are *enforced by process*, not left to whoever is calmest. Explain which bias each step counters.

<details><summary>Worked answer</summary>

1. **"What changed in the last N hours?"** — list recent deploys/config/flag flips and consider rollback. Counters base-rate neglect by forcing the 70% prior first.
2. **"Check dependency health dashboards."** — the next-most-likely class (15%). Counters tunnel-vision on the first theory.
3. **"Check capacity/saturation signals."** — the 10% class. Only after 1–3 do you entertain exotic hypotheses (the residual few %).

Steps are *ordered by base rate*, so attention is allocated by frequency, not by the most vivid story — institutionalizing the correction for representativeness bias.
</details>

---

### Where to go next

- Update priors with evidence: [reasoning under uncertainty](../01-reasoning-under-uncertainty/).
- Tail and irreversible risk in depth: [risk and failure probabilities](../03-risk-and-failure-probabilities/).
- Turning reference classes into ranges: [estimation under uncertainty](../04-estimation-under-uncertainty/).
- The biases behind these traps: [cognitive biases in code decisions](../../04-critical-thinking/03-cognitive-biases-in-code-decisions/) · [evaluating tradeoffs objectively](../../04-critical-thinking/04-evaluating-tradeoffs-objectively/).
- Section root: [probabilistic thinking](../) · [engineering thinking](../../README.md).
