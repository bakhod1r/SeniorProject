> Practice on realistic scenarios. For each task: (1) **name** the dominant bias(es) precisely, (2) explain the **engineering manifestation**, (3) propose a **structural** debiasing tactic — not "be aware." Where a task has a numeric component, show the arithmetic. Global rule: a debias tactic that relies on willpower or "staying objective" earns zero — it must change the *process, structure, or evidence available*. Sketch answers follow each task so you can self-check.

---

## Task 1 — Spot the bias in the debugging session

An engineer gets paged for "API returns 500s intermittently." Their first message: "It's definitely the database connection pool, it always is." For the next 45 minutes they read only the DB pool metrics, tweak `max_connections`, and re-deploy. The 500s continue. The actual cause was a downstream auth service timing out.

**Do:** Name the bias(es). Describe the exact moment it took hold. Give two structural tactics that would have changed the outcome.

<details><summary>Sketch</summary>

**Availability bias** ("it always is" — the pool is the *memorable* past cause) seeding **confirmation bias** (reading only pool metrics, ignoring the auth signal). It took hold at the first message — a single hypothesis declared with confidence. Tactics: (1) require listing ≥2 hypotheses before touching anything, then pick the *discriminating signal* (a latency-breakdown trace would have pointed at auth in minutes); (2) state the cheapest disconfirming test first — "if it's the pool, pool-wait-time spikes; does it?" — and if not, abandon the theory.
</details>

---

## Task 2 — Reference-class forecasting (numeric)

You're estimating a "data migration to a new schema." Inside-view gut: 4 days. The last five migrations had actuals of **6, 11, 5, 8, 20** days (the 20 was a corrupt-data surprise).

**Do:** Compute the reference-class mean and median. Decide what to *quote*, and justify the form of the quote. Compute a class multiplier from these (assume each was originally estimated at 4 days for simplicity) and state what it implies.

<details><summary>Sketch</summary>

Mean = (6+11+5+8+20)/5 = 50/5 = **10 days**. Median (sorted 5,6,8,11,20) = **8 days**. The mean is pulled up by the 20-day tail; the median (8) is the better central estimate, but the tail is *real* (migrations surprise you), so **quote a range, e.g. 6–20, central ~8–10**, never "4 days." Class multiplier = median(actual)/estimate = 8/4 = **2.0** → the org systematically under-estimates migrations by ~2×; future migration gut-estimates should be roughly doubled. The inside-view 4 was off by 2–5×.
</details>

---

## Task 3 — Design a debiasing mechanism for sprint estimation

Your team's estimates are consistently ~50% too low. In planning, the tech lead always speaks first with a number, and everyone converges on it.

**Do:** Identify the two biases at work and design a concrete planning-meeting protocol that structurally neutralizes both.

<details><summary>Sketch</summary>

**Planning fallacy** (50% low, inside view) + **anchoring** (lead's number captures the room). Protocol: (a) each person writes an *independent silent estimate* before any number is spoken; (b) reveal simultaneously; (c) discuss the *spread* (divergence reveals hidden assumptions/risks); (d) apply a measured **reference-class multiplier** from the team's estimate-vs-actual history to the agreed inside-view number; (e) quote a range. The silent-independent step kills the anchor; the multiplier kills the optimism. Bonus: the lead estimates *last* or abstains.
</details>

---

## Task 4 — Bikeshedding triage

An RFC for a new authentication service has been open for two weeks. The comment thread: 53 comments on the naming of the config keys and the indentation style, 0 on the token-revocation strategy or the session-fixation risk.

**Do:** Name the law/bias. Explain *why* the trivial items attracted the comments. Propose a review structure that prevents this.

<details><summary>Sketch</summary>

**Parkinson's law of triviality (bikeshedding).** Naming/indentation attract comments because *everyone can form an opinion* on them with zero context, whereas token-revocation requires real expertise — so the easy items soak up the bandwidth. Structure: (1) a **review checklist** that *requires* sign-off on the high-stakes axes (revocation, session fixation, key rotation) before merge; (2) `nit:` convention so style comments are explicitly non-blocking; (3) route formatting to an automated formatter/linter so it's *not a human discussion at all*; (4) timebox style debate and assign a single owner.
</details>

---

## Task 5 — Rewrite a postmortem to remove hindsight bias

A draft postmortem reads: *"Root cause: the on-call engineer should have noticed the disk was filling up. It was obvious the log volume would grow after the new feature. Action item: engineers must pay closer attention to disk metrics."*

**Do:** Identify the bias. Rewrite the root-cause and action-item sections to be blameless and systemic. State the test your rewrite must pass.

<details><summary>Sketch</summary>

**Hindsight bias** ("obvious," "should have noticed") plus a person-blaming, useless action item. Rewrite — *contributing factors:* no alert was configured on disk-usage trend, so growth was invisible until failure; the new feature's log-volume increase wasn't surfaced in review; runbook had no disk-pressure entry. *Action items (systemic, verifiable):* add a disk-usage-trend alert at 80%; add "log-volume impact" to the feature review checklist; add disk-pressure remediation to the runbook. **Test:** every action item changes a system/tool/process, none changes a person's attitude; the timeline only uses what was knowable at each moment.
</details>

---

## Task 6 — The home-grown tool decision

A staff engineer proposes scrapping the team's custom 6-year-old job scheduler (maintained by 2 engineers) for a well-supported open-source one. Three senior engineers push back hard, citing "it's tuned exactly for our needs" and "we understand every line."

**Do:** Name the biases in the pushback. Design a *neutral* decision procedure that doesn't depend on anyone admitting attachment.

<details><summary>Sketch</summary>

**IKEA effect** (over-valuing what we built), **NIH** (distrust of external), **status-quo bias** (keeping feels safer), possible **sunk-cost**. Procedure: pose the **symmetric question** — "starting today with neither, which would we choose for the next 3 years?" — to remove the status-quo default; tabulate the **cost of keeping** (2 engineers' maintenance, bus factor, missing features, opportunity cost) beside the cost of switching, on one page; judge against explicit criteria, not authorship. Optionally a rotated **devil's advocate** assigned to argue *for* migration so dissent is a role.
</details>

---

## Task 7 — Pre-mortem design

You're about to launch a new event-driven order-processing pipeline. Leadership is confident. You have 30 minutes in the design review.

**Do:** Run a pre-mortem in writing: state the framing, then list at least five plausible failure modes and the pre-launch mitigation each implies. Explain *why* a pre-mortem surfaces these when normal planning doesn't.

<details><summary>Sketch</summary>

Framing: "It's six months later and this pipeline failed badly — why?" Failure modes → mitigations: broker drops events under load → dead-letter queue + alerting; no idempotency → duplicate orders on retry → idempotency keys; eventual consistency confuses support → comms/runbook + status surfacing; undebuggable → add distributed tracing pre-launch; downstream team never consulted → loop in billing now; poison message stalls the consumer → DLQ + max-retry. **Why it works:** normal planning is confirmation-biased toward "this'll work"; asking *why it failed* gives social permission to voice swallowed doubts and engages imagination on failure modes (Klein).
</details>

---

## Task 8 — Automation bias in the toolchain

A team adopts an AI code assistant. Within a month, two incidents trace to merged code that used a non-existent library method the AI confidently suggested, which only failed at runtime under a specific path. CI was green both times.

**Do:** Name the bias and the *error type*. Explain why CI being green made it worse. Propose a structural safeguard that doesn't ban the tool.

<details><summary>Sketch</summary>

**Automation bias**, *error of commission* (acted on a wrong automated suggestion), compounded by trusting the **green CI** (a second automation) as a verdict — an *omission* failure (CI didn't catch it, so it was assumed fine). Worse because the green check displaced human scrutiny. Safeguard: treat AI output as a *hypothesis* — mandate that AI-generated diffs are reviewed as if written by a junior; require a test that exercises the actual code path (coverage gate on changed lines); educate that "CI green" ≠ "correct," only "didn't trip the existing checks." Keep the tool; add the human checkpoint.
</details>

---

## Task 9 — Calibration audit (numeric)

Over a quarter, your team made 20 estimates each given as a "90% confidence range." The actual outcome fell *inside* the stated range 11 times.

**Do:** Compute the empirical hit rate. State what it reveals about the team's calibration and which bias it indicates. Prescribe a correction.

<details><summary>Sketch</summary>

Hit rate = 11/20 = **55%**, versus the claimed **90%**. The team is badly **over-confident** (ranges too narrow) — a direct expression of **optimism bias / the planning fallacy** in *uncertainty* estimation, not just central estimates. Correction: widen ranges (systematically inflate the upper bound using the historical actual/estimate distribution's p90), keep auditing each quarter, and tie the multiplier to measured calibration until ~90% of outcomes actually land inside the 90% range. Calibration is a *measurable, tunable* property — this is the governance loop.
</details>

---

## Task 10 — Curse of knowledge in onboarding

A new hire takes three weeks to make their first real contribution. Interviewed, they say the architecture doc "assumes you already know how the deploy pipeline and the service mesh fit together" and the setup runbook "skips steps that the team does automatically." The docs were written by the principal engineer.

**Do:** Name the bias. Explain why the *most knowledgeable* author produced the *least usable* docs. Propose three structural fixes and one metric to track improvement.

<details><summary>Sketch</summary>

**Curse of knowledge** — the principal cannot simulate not-knowing, so reflexive steps get omitted and assumed context goes unstated; expertise *causes* the illegibility. Fixes: (1) **novice-test** docs — watch a new hire follow them silently, every stumble = a missing step; (2) treat every onboarding question as a **doc defect** to be fixed, not just answered; (3) rotate doc authorship toward **recent joiners** (paired with an expert for accuracy), since they still remember what was confusing. **Metric:** *time-to-first-meaningful-contribution* — it directly indexes how badly the curse has corrupted docs/tooling and whether fixes are working.
</details>

---

## Task 11 — Multi-bias diagnosis

After a high-profile DDoS incident, leadership reorganizes the next two quarters of roadmap almost entirely around DDoS hardening. Meanwhile, a known data-integrity bug class that quietly corrupts ~0.5% of records per month — costing far more in aggregate — stays unfunded. In planning, the security lead's "this'll take 2 weeks" sets every sub-estimate.

**Do:** Name *all* the biases present and pair each with a tactic.

<details><summary>Sketch</summary>

(a) **Availability bias** (the vivid DDoS dominates prioritization) → prioritize by **expected cost across the incident base rate**, not salience; an incident-class dashboard shows the data-integrity bug is the larger expected loss. (b) **Recency bias** (latest incident reshapes the roadmap) → trend over many incidents. (c) **Anchoring** (lead's "2 weeks" captures sub-estimates) → independent silent estimates revealed simultaneously. (d) Implicit **optimism bias** in "2 weeks" → reference-class multiplier from past security work. The fix is *portfolio-level base-rate reasoning* plus de-anchored estimation.
</details>

---

## Task 12 — Build the org-level debiasing scorecard

You're a principal asked to make the engineering org "less biased" over the next year. Vague mandate, real expectation.

**Do:** Produce a one-page plan mapping each major decision process to its dominant bias, its debiased default, and the *mechanism* that enforces the default. Identify which single dataset unlocks the most debiasing.

<details><summary>Sketch</summary>

| Process | Dominant bias | Debiased default | Mechanism |
|---|---|---|---|
| Estimation | Planning fallacy | Outside view | Estimate-vs-actual data → class multipliers; ranges; quarterly calibration audit |
| Code review | Halo / bikeshedding | Uniform + independent | Checklist, required checks, `nit:` convention, formatter automation |
| Big decisions | Confirmation / status-quo | Auditable reasoning | ADRs with options + "what would change our mind"; rotated devil's advocate |
| Incidents | Hindsight | Blameless / knowable-then | Template enforcing systemic action items; separated from perf review; Just Culture |
| Remediation priority | Availability | Base-rate driven | Incident-class dashboard; expected-cost ranking |
| Onboarding/docs | Curse of knowledge | Novice-legible | Questions-as-defects; newcomer authorship; time-to-contribution metric |

**Highest-leverage dataset: estimate-vs-actual history** — it unlocks reference-class forecasting *and* calibration auditing, and it converts "the team is too optimistic" (a moral framing) into a tunable, measurable correction. Make bias **auditable**, then tune the defaults from evidence.
</details>

---

### Where this connects

- [Claims, evidence and reasoning](../01-claims-evidence-and-reasoning/) · [Logical fallacies in engineering](../02-logical-fallacies-in-engineering/) · [Evaluating tradeoffs objectively](../04-evaluating-tradeoffs-objectively/)
- [Probabilistic thinking](../../06-probabilistic-thinking/) (base rates, calibration) · [Metacognition and learning](../../10-metacognition-and-learning/)
- Back to [critical thinking](../) · [engineering thinking overview](../../README.md).
