> **What?** At this level, evaluating tradeoffs objectively means running a small, repeatable decision process: explicit weighted criteria, an identified *dominant axis*, total-cost-of-ownership thinking (not just upfront cost), and an Architecture Decision Record that captures the reasoning so the team can audit it.
>
> **How?** You separate the axes that decide the call from the noise, quantify what you honestly can (and flag what you can't), compare every option against a do-nothing baseline, and ship an ADR whose "consequences" section names what you're *giving up* — not just what you're getting.

---

[junior.md](./junior.md) established the discipline: criteria first, baseline always, rigor proportional to reversibility, write down the *because*. This level makes the matrix sharper and the cost analysis honest.

## 1. Find the dominant axis; ignore the noise

Most tradeoff matrices have one or two criteria that actually decide the outcome and several that barely move it. Spreading equal attention across all of them is a way to *feel* thorough while diluting the thing that matters.

The move: after building the matrix, ask **"which single axis, if it flips, flips the decision?"** That's your **dominant axis**. Everything else is a tiebreaker.

Example — choosing a data store for an append-heavy audit log:

| Criterion | Why |
| --- | --- |
| **Write throughput** | We write 50k events/s; this is existential |
| Query flexibility | We only ever query by time range — narrow need |
| Cost | Matters, but secondary at this volume |
| Ecosystem | Nice to have |

Write throughput is the dominant axis. If an option can't sustain the write rate, *nothing else about it matters* — it's disqualified before scoring begins. This is a **knockout criterion**: model it not as a weighted row but as a gate.

```text
Step 1 — Gates (pass/fail):   sustained write ≥ 50k/s?  data durable on node loss?
                              → eliminate anything that fails
Step 2 — Weighted scoring:    score only the survivors on the soft criteria
```

Separating gates from weighted criteria fixes a real matrix bug: a fatally-flawed option can otherwise rack up enough points on minor criteria to look competitive. A database that loses writes shouldn't win on "great docs."

## 2. Total cost of ownership beats upfront cost

The classic objectivity failure is comparing the **upfront** cost of options while ignoring the cost of *living with* them. **Total Cost of Ownership (TCO)** is upfront + ongoing, over a realistic time horizon.

| | Self-hosted on VMs | Managed service |
| --- | --- | --- |
| Upfront (setup) | Low ($, a week of work) | Near zero |
| Monthly bill | $400 | $1,800 |
| On-call / ops load | ~6 hrs/month engineer time | ~0 |
| Patching, upgrades, backups | You | Them |
| Cost of a 3am outage | You + your sleep | Their SLA |

The managed service has a *higher* monthly bill but often a *lower* TCO once you price engineer-hours, on-call burden, and outage risk. If a senior engineer's loaded cost is ~$100/hr, that 6 hrs/month is $600 — the "expensive" managed option may be cheaper than the "cheap" one.

> Rule of thumb: pick a time horizon (e.g. 3 years) *before* you tally, and price operational labor explicitly. "Free" open-source software is rarely free once you staff it.

## 3. Second-order costs: the ones you forget

Beyond the bill, every choice imposes **second-order costs** that don't show up until later:

- **Operability** — Can you debug it at 3am? Are there metrics, logs, a runbook?
- **On-call burden** — Does this add a new thing that can page someone?
- **Hiring & onboarding** — Can you hire people who know it? How long until a new teammate is productive?
- **Cognitive load** — Each new technology is a tax on everyone who has to hold the system in their head.
- **Blast radius** — When it fails, what else fails with it?

These belong as explicit rows in your matrix. The exotic technology that's marginally faster but that only you understand has a huge second-order cost: it's a bus-factor of one. That's not pessimism; it's accounting.

## 4. A worked weighted decision matrix (done honestly)

Decision: how should a 6-person team add background job processing? Options include the do-nothing baseline.

**Gates first:** must handle ≥ 1k jobs/min (all pass), must support delayed jobs (cron-table fails → eliminated only if that's a hard requirement; here it's soft, so we keep it and score it).

Scores 1–5 (5 = best). Weights chosen *before* scoring, justified in words.

| Criterion (weight, why) | DB cron table (baseline) | Redis + worker lib | Managed queue (SQS-like) |
| --- | --- | --- | --- |
| Operability (×3 — small team, this is our dominant axis) | 5 | 3 | 5 |
| Throughput headroom (×2) | 2 | 4 | 5 |
| Delayed/retry semantics (×2) | 2 | 4 | 5 |
| Team familiarity (×2) | 5 | 4 | 2 |
| Cost / TCO (×2) | 5 | 4 | 3 |
| Migration effort (×1, negative — lower is better, scored as "ease") | 5 | 3 | 3 |
| **Weighted total** | **5·3+2·2+2·2+5·2+5·2+5·1 = 48** | **3·3+4·2+4·2+4·2+4·2+3·1 = 44** | **5·3+5·2+5·2+2·2+3·2+3·1 = 54** |

**Result: managed queue wins (54)**, with the baseline a respectable second (48). The dominant axis (operability) is a tie between baseline and managed — so the decision is actually made by throughput and retry semantics, where the managed queue pulls ahead. The matrix tells you *not just what won, but why*: read across the rows where the gap opened.

Now the honesty check, **before** you trust this:

- Did any weight get set to engineer this outcome? (If you raised "throughput" only after seeing the baseline almost won, that's fudging — see [02-logical-fallacies](../02-logical-fallacies-in-engineering/).)
- Is the do-nothing baseline scored *fairly*, or did you sandbag it to justify the project?
- Are the numbers measured or guessed? Say which.

## 5. Quantifying the unquantifiable — honestly

Some criteria genuinely resist numbers: "developer experience," "future flexibility," "fit with our culture." Two honest moves:

1. **Proxy with something measurable.** "Future flexibility" → "number of currently-foreseeable feature requests this option blocks." "DX" → "time for a new hire to make their first safe change." Proxies are imperfect but auditable.
2. **Flag the guess explicitly.** Mark soft scores: `4 (judgment, not measured)`. This is the [claims-and-evidence](../01-claims-evidence-and-reasoning/) discipline — distinguish measurement from estimate from vibe. A matrix where every number is a confident-looking integer, but half were vibes, is *false precision* and worse than an honest "we don't know."

> If a criterion can't be measured *and* can't be proxied *and* dominates the decision, that's a signal to run a small experiment (a spike) rather than to keep arguing — see the [scientific/hypothesis-driven](../../09-scientific-and-hypothesis-driven/) section.

## 6. Sensitivity analysis: is the answer robust?

A result that flips when you nudge one weight by ±1 is **fragile** — it isn't really a decision, it's a coin-flip dressed as analysis. Test it: perturb the dominant axis's weight and the two closest scores.

In the matrix above, even if you drop "throughput" to ×1, the managed queue stays ahead. That robustness is what lets you *defend* the decision later: "the answer holds across reasonable weightings." If instead the winner flipped on a small nudge, the honest conclusion is "these two options are effectively tied — pick on a tiebreaker (reversibility, team preference) and move on." Don't manufacture a winner from noise.

## 7. The ADR: the artifact that forces honesty

An **Architecture Decision Record** (popularized by Michael Nygard, 2011) is a short, immutable note capturing one decision. Its power is structural: the required sections make hand-waving visible.

```markdown
# ADR-014: Background jobs via managed queue

## Status
Accepted — 2026-06-25

## Context
6-person team. ~1.2k jobs/min today, spiky to 8k. Need delayed + retried
jobs. Current cron-table approach has no native retry; failures are silent.

## Decision
Adopt the managed queue (SQS-like). Keep the cron table for the two existing
legacy jobs until they're migrated.

## Alternatives considered
- Do nothing (DB cron table): scored 48/60. Loses on retry semantics.
- Redis + worker lib: 44/60. Adds an ops surface we'd have to babysit.
- Managed queue: 54/60. Robust to ±1 weight perturbation (sensitivity-checked).

## Consequences
+ Native retries, DLQ, delayed delivery; no new server to operate.
- New vendor dependency and ~$X/mo. Local dev needs an emulator.
- Team must learn the SDK (est. 2 days). At-least-once delivery → handlers
  must be idempotent. (This is a new correctness constraint we now own.)
```

The **Alternatives considered** and **Consequences** sections are where objectivity lives. "Consequences" must list what you're *giving up*, not just the wins — a decision with no downsides listed wasn't honestly evaluated. ADRs are covered in depth at [code-craft/documentation](../../../code-craft/documentation/05-architecture-decision-records-adrs/).

## 8. Reversibility sets your budget

Reuse the two-way / one-way door idea from [junior.md](./junior.md) as a *time budget*:

| Decision type | Reversibility | Rigor budget |
| --- | --- | --- |
| Job library, log format, internal naming | Two-way door | Minutes. Pick, ship, revisit if it hurts. |
| Queue technology (with a thin abstraction) | Mostly two-way | An afternoon + a lightweight ADR. |
| Primary datastore, public API shape, event schema | One-way door | Days. Full matrix, sensitivity check, peer review. |

Spending one-way-door rigor on a two-way-door decision is **analysis paralysis**; spending two-way-door speed on a one-way-door decision is **recklessness**. Knowing which door you're at is half the skill.

## 9. Practice

1. Take a current "should we adopt X" question. Build the matrix with gates separated from weighted criteria, including a fairly-scored do-nothing baseline.
2. Compute TCO over 3 years for both options, pricing engineer-hours explicitly. Did the cheap option stay cheap?
3. Run a sensitivity check: does your winner survive a ±1 nudge to the dominant axis? If not, declare a tie honestly.
4. Write the ADR. Force yourself to fill "Consequences" with at least two real downsides.

---

**Key takeaway:** Find the dominant axis and gate on knockouts; compare TCO and second-order costs, not upfront price; mark guesses as guesses; sensitivity-check the result; and let the ADR's "alternatives" and "consequences" sections keep you honest.

**Next:** [senior.md](./senior.md) — cost of delay, one-way-door calls under uncertainty, and weighing the cost of being wrong.
