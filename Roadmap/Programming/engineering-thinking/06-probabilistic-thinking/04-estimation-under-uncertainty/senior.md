> **What?** At the senior level, estimation under uncertainty is *decision-grade forecasting*: producing the smallest, cheapest estimate that is precise enough to make the decision at hand, expressing it as a calibrated probability distribution, and defending that distribution against the organizational gravity that wants to collapse it to its optimistic end.
>
> **How?** You match estimate precision to the *decision's* needs (two-way doors get a gut call; one-way doors get a real distribution). You calibrate yourself with measured feedback (Hubbard's calibrated-estimation work), run Monte Carlo over decomposed tasks instead of summing means, lead reference-class forecasting for the team, and turn raw uncertainty into risk-cost so it can be traded off against everything else on the table.

---

## 1. Precision should match the decision, not the question

The most common senior mistake is over-estimating. Spending a week building a careful capacity model for a choice you can reverse in an afternoon is *waste dressed as rigor*. The right amount of estimation is a function of the **decision**, not the curiosity of the question.

| Decision type | Reversibility | Estimate precision needed |
|---|---|---|
| Pick a JSON library | Two-way door (swap later) | Gut call. 5 minutes. |
| Choose hot-path data store | One-way-ish (migration is painful) | Real Fermi + load model |
| Commit a launch date to a partner | One-way (contractual) | Full distribution, p90 committed |
| Provision a cluster size | Cheap to resize | Order-of-magnitude only |

The governing question is **"what would I do differently if the estimate were 2× higher or 2× lower?"** If the answer is "nothing," stop estimating — you've already gathered enough. This is **value-of-information** thinking: only buy precision the decision will actually use. (Hubbard's *How to Measure Anything* frames the entire measurement question this way: measure only what reduces decision-relevant uncertainty, and only until further measurement isn't worth it.)

---

## 2. Calibration: most engineers' "90% confident" is ~60%

A range is only honest if it's **calibrated** — your 90% intervals should contain the truth 90% of the time. Douglas Hubbard's research (and Tetlock's forecasting work) shows untrained estimators are wildly *overconfident*: their stated 90% intervals capture the answer maybe 40–60% of the time. Good news: calibration is a *trainable skill*, and the training is cheap.

### The equivalent-bet test (to widen honest intervals)

For any 90% interval you state, ask yourself: *"Would I rather (a) win $1,000 if the true value lands inside my range, or (b) win $1,000 on a spin of a wheel that pays out 90% of the time?"*

- If you prefer the **wheel**, your interval is too narrow — widen it.
- If you prefer your **range**, it's too wide — tighten it.
- When you're indifferent, you're calibrated.

### Track it organizationally

Keep an **estimate ledger** across the team:

| Period | # estimates | p90 ranges hit | Target |
|---|---|---|---|
| Q1 | 40 | 26 (65%) | 90% — overconfident |
| Q2 | 38 | 31 (82%) | improving |
| Q3 | 41 | 37 (90%) | calibrated |

When the hit rate sits well below the nominal confidence, the team is overconfident and every roadmap is at risk. The fix is structural: widen intervals, then re-measure. Calibration is the difference between a range that protects you and a range that's theater.

---

## 3. Monte Carlo beats summing means

PERT's `E = (O+4M+P)/6` per task and summing is a fine first pass, but it has two flaws at senior scale: it assumes a specific beta distribution, and naive summing ignores that the *project* p90 is not the sum of *task* p90s. Summing pessimistic cases over-pads; summing means under-pads. The clean answer is simulation.

```python
import random

# (optimistic, most_likely, pessimistic) days per task
tasks = [(2,4,9), (3,5,12), (1,3,6), (2,4,8)]

def sample(o, m, p):
    # triangular dist: cheap, captures the right-skew, no library needed
    return random.triangular(o, p, m)   # (low, high, mode)

trials = [sum(sample(*t) for t in tasks) for _ in range(100_000)]
trials.sort()

p50 = trials[len(trials)//2]
p90 = trials[int(len(trials)*0.90)]
print(f"p50 = {p50:.1f} days   p90 = {p90:.1f} days")
# e.g. p50 ≈ 17 days   p90 ≈ 22 days
```

Now you can *commit p90 and plan p50* with numbers you can show. Two senior refinements:

- **Model correlation.** If one shared risk (flaky CI, a vendor outage) hits multiple tasks, draw a single shared factor and apply it across tasks. Independent sampling *understates* tail risk — and the tail is what kills launches.
- **Model the discrete disasters separately.** "10% chance the vendor API doesn't support batch and we rebuild ingestion (+15 days)" is not a wider triangle; it's a **bimodal** outcome. Add it as an explicit `if random.random() < 0.10: total += 15`. These low-probability, high-impact branches are exactly what point estimates erase.

This connects directly to [risk and failure probabilities](../03-risk-and-failure-probabilities/): the pessimistic tail of an estimate *is* a risk, and should be priced like one.

---

## 4. A fully worked capacity estimate (decision-grade)

> **Scenario.** Product wants to add full-text search over user documents. Before committing to a managed Elasticsearch tier vs. building on Postgres, you need: index size, query QPS, and a rough monthly cost — accurate to an order of magnitude, in an hour, not a sprint.

**Step 1 — Corpus size (index storage).**
```
Users:                       5,000,000
Active users with docs:      20%        → 1,000,000
Avg docs per active user:    50
Total docs:                  1,000,000 × 50 = 5×10^7 docs
Avg doc text:                10 KB
Raw text:                    5×10^7 × 10 KB = 5×10^11 B = 500 GB
Inverted-index overhead:     ~1.5× raw   → ~750 GB index
```
**Index ≈ 0.75 TB.** That fits comfortably in a mid-size managed cluster — *not* an exotic problem. First decision input secured.

**Step 2 — Query load.**
```
Searches/active user/day:    5
Searches/day:                1,000,000 × 5 = 5×10^6/day
Average QPS:                 5×10^6 / 8.64×10^4 ≈ 58 QPS
Peak (×5 for business hours): ≈ 300 QPS
```
**~60 QPS average, ~300 QPS peak.** A single well-tuned node handles this for simple queries; you size for redundancy, not throughput. Second input secured.

**Step 3 — Rough monthly cost (the actual decision driver).**
```
Hot index 0.75 TB + replica = 1.5 TB across, say, 3 nodes
Managed search node (~30 GB RAM, decent CPU): ~$300/mo each
3 nodes:                     ~$900/mo
+ ingest/snapshot overhead:  ~$1,100/mo all-in
```
**~$1k/month, order of magnitude 10^3 $/mo.** Now the decision is framed precisely: managed search costs ~$13k/year; the build-on-Postgres alternative trades that for engineering time and weaker relevance. That is a *clean two-option trade*, surfaced in an hour — and the estimate's job is done the moment it makes the choice obvious. The decompose-from-fundamentals move here is [first-principles reasoning](../../05-first-principles-thinking/01-reasoning-from-fundamentals/).

Always state the **load-bearing assumptions** (20% active, 50 docs each, 10 KB avg) so anyone can challenge the *inputs* rather than the conclusion. An estimate whose assumptions are visible is debuggable; one that isn't, is dogma.

---

## 5. Reference-class forecasting as a team practice

The senior version of fighting the planning fallacy is institutional: make the outside view the *default* for any non-trivial estimate.

1. **Build the reference classes.** Tag completed epics by size (S/M/L/XL) and store their *actuals*. This is your forecasting gold.
2. **For a new epic, start from the class distribution**, not from imagination. "Last 8 L-epics ran median 6 weeks, p90 11 weeks" is the anchor.
3. **Adjust for genuine specifics**, with the burden of proof on any claim that *this one* is faster than its class.
4. **Re-anchor as the cone narrows** — re-forecast at each phase boundary, not just at kickoff.

Flyvbjerg's megaproject research found reference-class forecasting is the single most reliable corrective to systematic optimism. The inside view *feels* more accurate because it's detailed; the outside view *is* more accurate because it's data. When they disagree, lead with the data and let specifics adjust it.

---

## 6. Defending a range without it collapsing

You will give "5–9 weeks" and a stakeholder will repeat "so, 5 weeks." Holding the range is a senior skill in itself.

| Pressure | Senior response |
|---|---|
| "Just give me one number." | "The one number you can plan against is the p90: **9 weeks.** The 5 is the lucky case — don't build the plan on it." |
| "Can you commit to the optimistic end?" | "I can commit to p90. Committing to p50 means we miss half the time by design." |
| "The range is too wide." | "The width is real — it's where we are on the cone. Fund a 1-week spike and I'll halve it." |
| "Competitor X ships in 4 weeks." | "Then we're choosing scope, not estimate. Here's what fits in 4 weeks at p90." |

The meta-move: **never surrender the distribution, trade scope instead.** Estimates are about *when you'll be done with this scope*; if the date is fixed, the variable that moves is scope or confidence, never the laws of probability. Anchoring the conversation on **p90 as the commit and p50 as the hope** stops the silent collapse to the optimistic end before it starts.

---

## 7. Next steps

- The full org-governance view (portfolio calibration, killing "just one number" at scale): [professional](professional.md).
- Interview drills incl. worked Fermi QPS/storage: [interview](interview.md). Hands-on: [tasks](tasks.md).
- Related: [reasoning under uncertainty](../01-reasoning-under-uncertainty/) · [base rates & expected value](../02-base-rates-and-expected-value/) · [risk & failure probabilities](../03-risk-and-failure-probabilities/).
- Section: [probabilistic thinking](../) · Up: [engineering thinking roadmap](../../README.md).

### Takeaways

1. **Match precision to the decision** — stop estimating once a 2× swing wouldn't change your choice (value of information).
2. **Calibrate explicitly** — untrained 90% intervals capture ~50%; widen with the equivalent-bet test and track hit rate.
3. **Monte Carlo, not summed means** — and model correlation and discrete disasters explicitly; the tail is what hurts.
4. A decision-grade estimate states its **load-bearing assumptions** so the inputs, not the conclusion, are what get argued.
5. **Defend the distribution** by trading scope — commit p90, hope p50, never let the range collapse to its floor.
