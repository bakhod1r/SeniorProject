> Interview questions on risk and failure probability. These probe whether you can *compute* system reliability (series/parallel, MTBF/MTTR), reason about *correlated* failure, use the *union bound*, and make *judgment* calls about mitigation. Answers are short and precise; traps and follow-ups are called out. Do the arithmetic out loud — the trap is almost always an assumption (independence) or a units slip (availability vs. unavailability).

---

## Q1. Define risk in one formula. Why two factors?

`risk = probability × impact` (expected loss). Two factors because two risks with the *same* expected loss can demand opposite responses: frequent-and-cheap (fix in normal work) vs. rare-and-catastrophic (insure against, even above EV). Collapsing them to one number hides which dial to turn.

**Trap:** "just rank by expected loss." For *fat-tailed / ruin-class* risks you rationally pay above EV — you can't average your way out of an unrecoverable outcome.

---

## Q2. Three services at 99.9% sit in series in a request path. System availability?

```
0.999³ = 0.997   →  ~99.7%
```

Series availabilities **multiply**, so the system is *worse than its worst component*. Three nines of parts gave you under three nines of system.

**Follow-up — 30 such hops?** `0.999³⁰ ≈ 0.970` (~97%). Long dependency chains are fragile by construction; count your hops.

---

## Q3. Compute the availability of two replicas at 99% each. Why isn't it 99% + 99%?

You can't add availabilities — 99% + 99% = 198% is nonsense. For parallel redundancy you multiply the **unavailabilities**:

```
U = (1 − 0.99) × (1 − 0.99) = 0.01 × 0.01 = 0.0001
A = 1 − 0.0001 = 0.9999  →  99.99%
```

The system works if *at least one* replica works, so it fails only if *both* fail — and "both fail" multiplies the small numbers. Two nines → four nines.

**Trap:** this is valid *only if the two replicas fail independently.*

---

## Q4. So why don't two 99% replicas reliably give you 99.99% in production?

**Correlated (common-cause) failure.** The 99.99% assumes independence, but real replicas share a deploy, an AZ, a config service, a dependency, or the same bug. Split unavailability into independent `p_ind` and common-cause `p_cc`:

```
U ≈ p_ind² + p_cc
```

`p_cc` is a **floor** redundancy can't cross. A 0.1% common-cause term caps two 99% replicas at ~99.89%, not 99.99% — you lose most of the second replica's value.

**Follow-up — how do you restore independence?** Spread copies across **failure domains**: different AZs/regions, different deploy waves, different dependency stacks.

---

## Q5. Derive availability from MTBF and MTTR.

```
availability = MTBF / (MTBF + MTTR)
```

MTBF = mean time between failures (how *often*); MTTR = mean time to recover (how *long*). Example: fails every 720 h, recovers in 1 h → `720/721 = 99.86%`.

**Follow-up — which is cheaper to improve?** Usually **MTTR**. Raising MTBF fights entropy and hits the `p_cc` floor; lowering MTTR (rollback, alerting, automation) is engineering you control and halving it ~halves downtime.

---

## Q6. A service fails daily but recovers in 2 minutes; another fails monthly but takes 4 hours. Which is more available?

The frequent-but-fast one.

```
Daily / 2 min:    1440/(1440+2)   = 99.86%
Monthly / 4 h:    720h/(720h+4h)  = 99.45%
```

Users feel **MTTR**, not failure count. A service that breaks constantly but heals instantly beats one that rarely breaks but limps.

---

## Q7. A deploy touches 40 services, each 99.5% safe. Chance *some* service regresses?

Union bound (upper, no independence needed):

```
P(≥1) ≤ 40 × 0.005 = 0.20
Exact (independent): 1 − 0.995⁴⁰ ≈ 0.182
```

~1-in-5. This is why big-bang deploys are risky and why you decompose/stage releases.

**Trap:** don't say "each is 99.5%, so we're basically safe." Rare *per item* becomes common *across many items*.

---

## Q8. State the union bound and why it's useful.

`P(A₁ ∪ ... ∪ Aₙ) ≤ p₁ + ... + pₙ`. It bounds "at least one of N" **regardless of dependence**, so you never need the (usually unknown) correlations. For tiny `pᵢ` it's also a good approximation. Use it for "any of these rare things bites us" and for "rare-per-request × huge-N → near-certain at scale."

---

## Q9. What's the single biggest cause of outages, and what does that imply?

**Change** — deploys, config pushes, flags, migrations. Most outages are change-induced (Google SRE practice and postmortem corpora agree). Implications: frozen systems are more available (hence change freezes during peak events); safer deploys (canary, staged rollout, fast rollback) attack the *dominant* risk; and adding redundant servers does nothing against a bad deploy that ships to all of them.

---

## Q10. What is tail risk / a fat tail, and how does it change engineering?

Many failure quantities (outage duration, blast radius, incident cost) are **heavy-tailed**: extremes are far likelier than a normal-distribution intuition expects, and a single event can dwarf all the small ones — the **mean is dominated by the tail** (Taleb). So: plan for the P99.9 incident not the median; allocate effort by tail *expected-loss*, not failure frequency; and **cap the downside** (blast-radius limits, rollback, kill switches) rather than trying to predict the unpredictable.

**Follow-up — Black Swan?** A rare, high-impact, retrospectively-rationalized event not in your register. You can't enumerate them; you build systems that *survive surprise* and can recover without diagnosing root cause.

---

## Q11. Walk me through a risk matrix and its limits.

Grid of probability × impact; work red cells, ignore green, debate yellow. **Limits:** it hides the math (the cells are judgment, not arithmetic); buckets are coarse ("high impact" spans $10k to company-ending); and it invites theater (a filled matrix can feel like managing risk while nothing changes). Use it to communicate; use real numbers to decide.

---

## Q12. FMEA vs. fault tree — what does each give you?

**FMEA** (bottom-up): for each component, list failure modes, score `RPN = Severity × Occurrence × Detection`, attack highest RPN. High *Detection* score = hard to detect = dangerous. **Fault tree** (top-down): decompose the bad event via **AND** gates (all must fail — multiplies probabilities down, your redundancy) and **OR** gates (any causes it — union-bounds up, your SPOFs). FMEA finds correlated/hard-to-detect modes; fault trees make SPOFs and independence assumptions visible.

---

## Q13. You have one redundant pair already. Spend the next dollar on a third replica or on faster rollback?

Almost always **faster rollback (MTTR / blast radius)**. The third replica only buys down the *independent* term, which is already tiny, and can't cross the `p_cc` floor; meanwhile most outages are change-induced, where rollback is the lever. Reducing MTTR and blast radius gives more felt availability per dollar than chasing another nine of probability.

---

## Q14. When does a low-probability/high-impact risk justify expensive mitigation, and when is it theater?

**Justified** when the mitigation measurably shrinks `p`, blast radius, or MTTR; targets a top-of-register or *ruin-class* risk; and is **tested** (restore drills, game days, exercised failover). For fat-tailed ruin-class risks you may rationally pay **above** expected value (insurance). **Theater** when it changes none of `p`/impact/MTTR (an unwatched dashboard, an un-drilled runbook, an untested backup), mitigates a low-ranked risk while top ones go unfunded, or adds more complexity-risk than it removes. Test: "if this failure happens tomorrow, does this spend change the outcome — and have we proven it?"

---

## Q15. SLO is 99.9% over 28 days. What's the error budget, and what's it for?

`budget = 1 − SLO = 0.1%` of 28 days ≈ **40 minutes**. It's a currency: budget remaining → ship features and take risks; budget exhausted → freeze risky changes and invest in reliability. It dissolves the "ship vs. stability" fight by deciding it with data, and *consistently under-spending* the budget means you're over-targeting reliability users don't feel — loosen up.

---

## See also

- Levels: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · practice in [tasks.md](tasks.md)
- Siblings: [base rates and expected value](../02-base-rates-and-expected-value/), [reasoning under uncertainty](../01-reasoning-under-uncertainty/), [estimation under uncertainty](../04-estimation-under-uncertainty/)
- Related: [systems thinking](../../03-systems-thinking/), [evaluating tradeoffs objectively](../../04-critical-thinking/04-evaluating-tradeoffs-objectively/), the [section root](../), and the [Engineering Thinking overview](../../README.md).
