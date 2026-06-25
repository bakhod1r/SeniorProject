> Hands-on exercises for estimation under uncertainty. **Global constraints:** (1) every time/effort estimate must be a **range with a confidence level**, never a single number; (2) every capacity/Fermi estimate must show its **decomposition and assumptions** and report an **order of magnitude**; (3) round aggressively and reason in powers of ten; (4) after numeric tasks, state the *one decision* the estimate informs. Several tasks have worked checks — try them before reading the answer. Show your work in a notebook or scratch file.

---

## Task 1 — Convert point estimates to honest ranges

Take these three "commitments" and rewrite each as a range + confidence + the top risk that drives the high end.

| Point estimate | Your range + confidence + risk |
|---|---|
| "The migration is 3 days." | ? |
| "Search feature, 2 weeks." | ? |
| "Bug fix, this afternoon." | ? |

**Done when:** each has an O–P range, an explicit confidence (e.g. 80%), and a named risk. *Check yourself:* if your high end is less than ~1.5× your low end on anything non-trivial, you're probably still being optimistic — widen it.

---

## Task 2 — PERT a real task

Pick a task you'll actually do this week. Write O, M, P (days or hours). Compute:

```
E = (O + 4M + P) / 6      σ = (P − O) / 6
```

Report `E ± σ` and your rough **p90 ≈ E + 1.28σ**. Then commit the p90 to a teammate and *log the actual* when done.

**Worked check** — O=1, M=2, P=6:
`E = (1 + 8 + 6)/6 = 2.5`, `σ = (6−1)/6 = 0.83`, `p90 ≈ 2.5 + 1.06 ≈ 3.6 days`. Note E (2.5) > M (2) — the bad tail pushed it up. That's correct.

---

## Task 3 — Worked Fermi: QPS from daily volume

A service handles **30 million requests/day**. Estimate average and peak QPS, and state the architecture implication.

**Do it, then check:**
```
Average = 30,000,000 / 86,400 ≈ 30M / 86.4k ≈ 347 QPS  (~10^2–10^3)
Peak ≈ 5× ≈ 1,700 QPS
Decision: low thousands of QPS → one tuned service + replicas, not a sharded fleet.
```

---

## Task 4 — Worked Fermi: storage sizing

You're logging every request from Task 3 (30M/day), each log **~800 bytes**, retained **90 days**. Estimate stored size.

**Do it, then check:**
```
Per day:  30,000,000 × 800 B = 2.4×10^10 B = 24 GB/day
90 days:  24 GB × 90 ≈ 2,160 GB ≈ 2.2 TB  (~2×10^12 B)
With ~6× log compression on cold tier: ~0.4 TB compressed.
Decision: ~2 TB raw / 90 days → fits one volume; tiering optional, not urgent.
```
State which assumption (rate, size, retention, compression) your answer is most sensitive to.

---

## Task 5 — Worked Fermi: bandwidth cost

Your app serves an average **1.5 MB** of assets per page view, **4 million** page views/day. Estimate monthly CDN egress and cost at **$0.04/GB**. Then estimate the saving if you cut page weight to 600 KB.

**Do it, then check:**
```
Per day:   4,000,000 × 1.5 MB = 6,000,000 MB = 6 TB/day
Per month: 6 TB × 30 = 180 TB = 180,000 GB
Cost:      180,000 × $0.04 ≈ $7,200/month  (~10^3–10^4 $/mo)
At 600 KB: 180 TB × (0.6/1.5) = 72 TB → ~$2,880/mo → saves ~$4,300/mo.
Decision: a page-weight project pays for itself in weeks → prioritize it.
```

---

## Task 6 — Decompose a feature and Monte Carlo it

Break a feature into 4–6 sub-tasks. Give each (O, M, P). Then run a 100k-trial simulation summing triangular draws, and report portfolio p50 and p90.

```python
import random
tasks = [(2,4,9),(3,5,12),(1,3,6),(2,4,8)]   # replace with yours
def s(o,m,p): return random.triangular(o,p,m)
T = sorted(sum(s(*t) for t in tasks) for _ in range(100_000))
print("p50", round(T[len(T)//2],1), " p90", round(T[int(.9*len(T))],1))
```

**Done when:** you can state "p50 ≈ X, p90 ≈ Y, I'd commit Y." Compare Y to naively *summing* each task's P — note how much summing-pessimistic over-pads.

---

## Task 7 — Add a discrete disaster

Extend Task 6: one sub-task has a **15% chance** the vendor API forces a rebuild (+12 days). Model it as a branch, not a wider triangle:

```python
def s_risky(o,m,p,prob,extra):
    base = random.triangular(o,p,m)
    return base + (extra if random.random() < prob else 0)
```

Re-run. Report how much the **p90 moves** (the disaster lives in the tail, so p90 shifts far more than p50). Explain why a point estimate would have completely hidden this risk.

---

## Task 8 — Apply the outside view

For an upcoming epic, do *both* estimates:

1. **Inside view:** imagine the steps, sum them.
2. **Outside view:** pull the actuals of your last 5–8 similar epics from the tracker; take their median and p90.

Put both in a table. If the inside view is well below the reference-class median, write one sentence: either a *specific, defensible* reason this one is faster, or "no defensible reason — I adopt the outside-view number."

**Done when:** your committed number is anchored on the reference class, adjusted only for documented specifics.

---

## Task 9 — Build (and start) a calibration ledger

Create a table and seed it from memory or recent tickets:

| Task | Est range | Confidence | Actual | Inside p90 range? |
|---|---|---|---|---|
| ... | 2–5 d | 80% | 4 d | yes |

Fill ≥ 8 rows. Compute your **hit rate** (fraction of actuals inside the stated range) and your **median bias** (actual ÷ your most-likely). If hit rate ≪ your stated confidence, you're overconfident — note by how much you must widen future ranges.

---

## Task 10 — The equivalent-bet calibration drill

Without looking them up, give **90% confidence intervals** for: (a) the year the first email was sent; (b) the wingspan of a 747 in metres; (c) the number of bytes in your last production config file; (d) the population of Canada. For each, run the equivalent-bet test (prefer your range, or a 90%-payout wheel?) and *widen any interval where you'd pick the wheel.* Then check the real answers and count how many of your 4 intervals contained the truth.

**Done when:** you can state your hit rate. < 3.6/4 over time ⇒ you're overconfident; this drill, repeated, fixes it (Hubbard's method).

---

## Task 11 — Match precision to the decision

For each decision, write whether it needs (a) a gut call, (b) an order-of-magnitude Fermi, or (c) a full distribution — and one sentence of why:

1. Which logging library to adopt.
2. The instance size for a new hot-path cache (resizing is cheap).
3. The launch date promised to a partner in a signed contract.
4. Whether 50M daily events fit in a single Postgres instance.

**Done when:** you've applied the "would a 2× swing change my action?" test to each. (Reference answers: 1→a, 2→b, 3→c, 4→b leaning c.)

---

## Task 12 — Defend a range under pressure (role-play)

You estimated **"6–11 weeks, p90 = 11."** Write your one-line response to each push-back, holding the distribution and trading scope where needed:

1. "So, 6 weeks then?"
2. "Just give me one number for the board."
3. "The competitor ships in 5 weeks."
4. "Last quarter you were 2 weeks late — why trust this?"

**Done when:** none of your four answers collapses the range to its floor, at least one trades **scope** instead of the date, and one cites the **calibration ledger** from Task 9.

---

### See also
- Concepts: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · quick prep: [interview](interview.md)
- [reasoning under uncertainty](../01-reasoning-under-uncertainty/) · [base rates & expected value](../02-base-rates-and-expected-value/) · [risk & failure probabilities](../03-risk-and-failure-probabilities/)
- The optimism you're fighting: [cognitive biases in code decisions](../../04-critical-thinking/03-cognitive-biases-in-code-decisions/) · decompose-from-fundamentals: [first-principles reasoning](../../05-first-principles-thinking/01-reasoning-from-fundamentals/)
- Section: [probabilistic thinking](../) · Up: [engineering thinking roadmap](../../README.md)
