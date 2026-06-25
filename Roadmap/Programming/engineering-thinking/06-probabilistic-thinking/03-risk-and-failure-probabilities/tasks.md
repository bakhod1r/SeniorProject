> Practice computing and reasoning about failure probability. **Global constraints:** show your arithmetic; keep availability and *un*availability straight (`U = 1 − A`); state every independence assumption you rely on, and flag where it's likely false; quote the nines table when it helps a human feel the result. Several tasks are pure numeric — do them by hand before checking. Worked solutions follow each task; cover them and try first.

---

## Task 1 — System availability of a series chain

A request must pass through: CDN (99.99%), load balancer (99.99%), app server (99.9%), database (99.95%), payment provider (99.9%). All required. Compute system availability and translate it to downtime per year.

<details><summary>Solution</summary>

```
0.9999 × 0.9999 × 0.999 × 0.9995 × 0.999 ≈ 0.99741
```

~99.74%. Unavailability ≈ 0.26% × 525,600 min/yr ≈ **~23 hours/year**. The two 99.9% services dominate; the next nine comes from fixing *those*, not the already-excellent CDN/LB.
</details>

---

## Task 2 — Two replicas (and why not 99% + 99%)

(a) Two independent replicas at 99% each, system works if either works — availability? (b) Three replicas? (c) Explain why you can't add the availabilities.

<details><summary>Solution</summary>

(a) `U = 0.01² = 0.0001 → A = 99.99%`.
(b) `U = 0.01³ = 1e-6 → A = 99.9999%`.
(c) Availability is a probability ≤ 1; "99% + 99% = 198%" is meaningless. The system fails only if *all* replicas fail, so you multiply the **unavailabilities** (the small numbers), which collapse fast. Each independent copy roughly doubles the nines.
</details>

---

## Task 3 — Mixed topology, find the bottleneck

LB (single, 99.9%) → one-of-two app servers (each 99%) → one-of-two DB replicas (each 99.5%). Compute system availability and name the dominating component.

<details><summary>Solution</summary>

```
LB:  A = 0.999
App: U = 0.01²  = 0.0001    → A = 0.9999
DB:  U = 0.005² = 0.000025  → A = 0.999975
System = 0.999 × 0.9999 × 0.999975 ≈ 0.99887  → ~99.89%
```

The **single load balancer (99.9%)** dominates — the redundant blocks are near-perfect, so the lone SPOF caps the system. Adding LB redundancy is the highest-value next move.
</details>

---

## Task 4 — The correlation floor

Two replicas, each 99% available. 90% of each replica's downtime is independent, 10% is common-cause (shared deploy + AZ). Compute realistic system availability and compare to the naive independent result.

<details><summary>Solution</summary>

```
p_ind = 0.009, p_cc = 0.001
Naive:  U = 0.01² = 0.0001              → 99.99%
Real:   U ≈ p_ind² + p_cc
          = 0.009² + 0.001
          = 0.000081 + 0.001 = 0.001081 → 99.89%
```

A 0.1% common-cause term dragged 99.99% down to **99.89%** — most of the second replica's value evaporated. A third replica wouldn't help: `p_cc` is a floor. Fix: put replicas in different AZs and deploy waves to shrink `p_cc`.
</details>

---

## Task 5 — Union bound on a deploy

A release ships changes to 60 services, each with a 0.4% chance of a regression. Bound the probability that *at least one* regresses, then give the exact independent figure. What does it argue for?

<details><summary>Solution</summary>

```
Union bound: P(≥1) ≤ 60 × 0.004 = 0.24
Exact (indep.): 1 − 0.996⁶⁰ ≈ 0.214
```

~1-in-4 to 1-in-5 even though each service is 99.6% safe. Argues for **staged/decomposed releases** (fewer services per deploy, canary, bake time) so a regression hits a wave, not the fleet.
</details>

---

## Task 6 — Rare-per-request becomes common at scale

An endpoint has a 1-in-1,000,000 chance of a fatal edge-case bug per request. It serves 8,000,000 requests/day. Expected hits per day? Probability of *at least one* hit per day?

<details><summary>Solution</summary>

```
Expected hits = 8e6 × 1e-6 = 8 per day.
P(≥1) = 1 − (1 − 1e-6)^8e6 ≈ 1 − e^-8 ≈ 0.99966  → essentially certain.
```

"One in a million" is hit ~8 times daily here. At scale, every rare edge case *will* fire — handle it, don't assume it won't happen.
</details>

---

## Task 7 — MTBF/MTTR and choosing a lever

Service X: MTBF 240 h, MTTR 3 h. (a) Availability? (b) You can either double MTBF or halve MTTR for the same cost — which gives more availability? Compute both.

<details><summary>Solution</summary>

```
(a) A = 240/(240+3) = 0.98765  → 98.77%
(b) Double MTBF: 480/(480+3) = 0.99379  → 99.38%
    Halve MTTR:  240/(240+1.5) = 0.99380 → 99.38%
```

Roughly equal *here* (because `A ≈ 1 − MTTR/MTBF`, so doubling MTBF and halving MTTR both halve `MTTR/MTBF`). But in practice **halving MTTR is far cheaper** (rollback, alerting, automation) than doubling MTBF (fighting entropy and the `p_cc` floor) — so pick MTTR.
</details>

---

## Task 8 — Build a risk matrix and critique it

Place these on a 3×3 probability×impact matrix, then state one limitation of the placement: (a) flaky CI test, fails ~daily, costs 10 min of dev time; (b) region outage, ~once/3yr, costs $4M; (c) expired TLS cert, ~once/yr if unmonitored, takes site down 30 min.

<details><summary>Solution</summary>

| | Low impact | Med impact | High impact |
|---|---|---|---|
| High prob | (a) flaky CI 🟢 | | |
| Med prob | | (c) TLS cert 🟠 | |
| Low prob | | | (b) region outage 🔴? |

**Limitation:** the matrix buckets (b) and (c) by coarse labels, but (b)'s $4M is fat-tailed and ruin-adjacent — "low prob / high impact = medium-ish" *understates* it. The matrix hides that `0.33/yr × $4M ≈ $1.3M/yr` expected loss dwarfs (c)'s `1/yr × small`. Decide with the numbers, not the cell color.
</details>

---

## Task 9 — Find the correlated failure

A team reports: "We run 3 app replicas and 3 DB replicas, all 99.9%, so we're effectively bulletproof." Their setup: all 6 are in `us-east-1a`, deployed simultaneously by one CI job, reading config from a single config service. List the correlated failure modes and estimate the *real* ceiling.

<details><summary>Solution</summary>

Common-cause modes (each ignores all the redundancy):
- **Same AZ** — `us-east-1a` outage kills all 6.
- **Same deploy** — one bad CI rollout ships to all 6 at once.
- **Same config service** — a bad config push poisons all 6.

The independent-replica math (`U = 0.001³`) is fantasy; availability is governed by `p_cc` of {AZ outage, bad deploy, bad config} — likely **~99.9% or worse**, not the "nine nines" they imagine. Fix: spread AZs, stage deploys, validate + stage config. Redundancy without independence is theater.
</details>

---

## Task 10 — Series chain target

You need the overall request path to hit **99.95%**. It has 4 required components in series, currently 99.99%, 99.99%, 99.95%, 99.9%. (a) Current system availability? (b) Does it meet target? (c) Cheapest single change to reach it?

<details><summary>Solution</summary>

```
(a) 0.9999 × 0.9999 × 0.9995 × 0.999 ≈ 0.99830  → 99.83%
(b) No — 99.83% < 99.95%.
(c) The 99.9% component dominates the shortfall. Replace/redundify just it to ~99.99%:
    0.9999 × 0.9999 × 0.9995 × 0.9999 ≈ 0.99920  → 99.92% (still short)
    Also lift the 99.95% to 99.99%:
    0.9999 × 0.9999 × 0.9999 × 0.9999 ≈ 0.99960  → 99.96% ✓
```

Fix the **two weakest** links; the two already at 99.99% are irrelevant. Always spend on the worst series component.
</details>

---

## Task 11 — Fault tree and SPOF identification

"Checkout fails" if: the DB cluster is down **OR** the payment provider is down **OR** (app replica 1 **AND** app replica 2 are both down). DB-down = 0.001, payment-down = 0.001, each app replica down = 0.02 (independent). Compute P(checkout fails) and identify the SPOFs.

<details><summary>Solution</summary>

```
App-both-down (AND) = 0.02² = 0.0004
OR of {DB, payment, app-pair}, small probs → sum approx:
P ≈ 0.001 + 0.001 + 0.0004 = 0.0024  → checkout ~99.76% available
```

**SPOFs = the OR branches that fail alone:** the DB cluster and the payment provider each take checkout down by themselves and *dominate* the redundant app pair. Next moves: redundify the DB, add a secondary payment provider — not more app replicas.
</details>

---

## Task 12 — Justify or reject a mitigation

Proposal: spend **$400k/yr** on a hot-standby second region. Region outages occur ~0.25/yr; an outage costs ~$1M in lost revenue + reputational harm, and you estimate failover would cut that loss by 80%. (a) Is it justified on expected value? (b) When might you fund it anyway? (c) What turns it into theater?

<details><summary>Solution</summary>

```
(a) Δ(expected_loss) = 0.25/yr × ($1M × 0.80) = 0.25 × $800k = $200k/yr.
    $400k cost > $200k benefit → NOT justified on pure EV.
```

(b) Fund anyway if the downside is **fat-tailed / ruin-class** — e.g. the "$1M" understates true loss (regulatory exposure, churn, a contractual SLA penalty, or a tail where an outage runs days not hours). For ruin-class risk you rationally pay a **tail premium** above EV.
(c) It becomes **theater** if the standby region is never failover-tested, drifts out of config parity, or can't actually take traffic — an untested DR region changes the outcome by ~0. Justification requires *drilled* failover (game days), or the $400k buys a false sense of safety.
</details>

---

## See also

- Levels: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md)
- Siblings: [base rates and expected value](../02-base-rates-and-expected-value/), [reasoning under uncertainty](../01-reasoning-under-uncertainty/), [estimation under uncertainty](../04-estimation-under-uncertainty/)
- Related: [systems thinking](../../03-systems-thinking/), [evaluating tradeoffs objectively](../../04-critical-thinking/04-evaluating-tradeoffs-objectively/), the [section root](../), and the [Engineering Thinking overview](../../README.md).
