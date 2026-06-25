> Practice for evaluating tradeoffs objectively. **Global constraints for every task:** (1) write your decision criteria and weights *before* you look at or score options; (2) always include a "do nothing / keep current" baseline as a real column; (3) mark each score as **measured** or **estimated**; (4) state the time horizon for any cost figure; (5) name the dominant axis and any pass/fail knockout gates; (6) finish anything consequential with a 5-section ADR (Status / Context / Decision / Alternatives / Consequences) whose Consequences section lists at least two real downsides. Do these on paper or in a doc — the artifact is the point. Several tasks have a numeric component; show the arithmetic.

---

## Task 1 — Build and defend your first weighted matrix

Pick a small real decision you can make this week (a logging library, a test framework, a folder structure). Build a 3-option × 4-criterion weighted matrix including the do-nothing baseline. Compute weighted totals. Then write three sentences defending the winner *to a skeptic who preferred a different option*. **Pass condition:** your defense cites the criteria and weights, not your taste.

## Task 2 — Find the fudged weight

Here is a matrix an engineer built to justify adopting a new framework (scores 1–5, 5 = best):

| Criterion (weight) | Keep current | New framework |
| --- | --- | --- |
| Team familiarity (×1) | 5 | 1 |
| Performance (×4) | 3 | 4 |
| Ecosystem (×3) | 4 | 5 |
| Migration cost / ease (×1) | 5 | 2 |

(a) Compute both totals. (b) The engineer originally had Performance at ×2 and Familiarity at ×3; recompute under *those* weights. (c) Which weighting flips the winner? (d) Write the one-sentence honesty question that exposes whether the ×4/×1 weights were chosen on the merits or to engineer the outcome.

*Numeric component required.*

## Task 3 — Classify ten decisions: one-way or two-way door

For each, label one-way (irreversible) or two-way (reversible), and give the cost of reversing it: (1) choice of CSS framework, (2) public REST API resource naming, (3) primary database engine, (4) feature-flag default value, (5) the wire format of events other teams consume, (6) internal variable names, (7) cloud provider, (8) which queue library (behind an interface), (9) the company's core data model, (10) commit message style. Then pick the two you labeled "one-way" that you think could be *converted* to two-way, and describe the conversion tactic.

## Task 4 — Add the missing baseline

Find a real proposal in your team's history (a migration, a rewrite, a new tool) that was evaluated *without* a fairly-scored "keep the current system" column. Reconstruct the matrix *with* an honest baseline. Did the proposal still win? Write one paragraph on whether the original decision would survive this scrutiny.

## Task 5 — TCO vs upfront cost

You're choosing between self-hosting a search engine and a managed search service.

```text
Self-hosted:  setup ~1 week of eng time; $300/mo infra; ~5 ops-hrs/month
Managed:      setup ~1 day; $1,400/mo; ~0 ops-hrs/month
Loaded eng cost: $110/hr.   Horizon: 3 years.
```

(a) Compute 3-year TCO for both, converting ops-hours to dollars. (b) At what monthly managed price would the two break even? (c) Name two second-order costs not in these numbers that could change the call. **Pass condition:** your recommendation references TCO, not the monthly bill.

*Numeric component required.*

## Task 6 — Sensitivity analysis

Take any matrix from Task 1 or Task 5. Identify the dominant axis. Perturb its weight by ±1 and re-compute. Does the winner change? Write the honest conclusion: either "robust — the answer holds across reasonable weightings" or "fragile — these options are effectively tied; I'll decide on a tiebreaker (reversibility / team preference) and stop analyzing." **Pass condition:** you do *not* manufacture a winner from a fragile result.

## Task 7 — Cost of delay, priced

A migration is blocked on a "which message broker?" decision. The feature it unblocks is worth ~$26k/month of new revenue. The team wants two more weeks of analysis; you believe the matrix stopped meaningfully changing after week 1. (a) Compute the cost of those two weeks of delay. (b) State the decision rule that compares this delay cost to the expected improvement in decision quality. (c) Write the one sentence you'd say in the meeting to reframe "be careful" as a priced tradeoff.

*Numeric component required.*

## Task 8 — Separate knockout gates from weighted criteria

Take a datastore or queue selection. List your criteria, then split them into **gates** (pass/fail — e.g. "must sustain 50k writes/s", "must run on-prem") and **weighted soft criteria**. Apply the gates first to eliminate options, then score only the survivors. Write one sentence explaining what bug this two-phase structure prevents (hint: a fatally-flawed option racking up points on minor criteria).

## Task 9 — Quantify the unquantifiable, honestly

Choose a decision where "developer experience" or "future flexibility" is a real criterion. (a) Replace it with a *measurable proxy* and define how you'd measure it. (b) Score your options on the proxy and mark each score measured or estimated. (c) Write one sentence on what you'd do if this soft criterion turned out to be the dominant axis. **Pass condition:** no vibe is laundered into a confident integer.

## Task 10 — Write a real ADR with honest consequences

Take a decision you've actually made (or Task 1's winner) and write a full ADR: Status / Context / Decision / Alternatives considered (with the fairly-scored baseline) / Consequences. The Consequences section must list at least **two real downsides** and any new constraint the decision imposes (e.g. "handlers must now be idempotent"). Then add a one-line, *pre-committed* revisit trigger ("re-open this ADR if X exceeds Y"). See the format at [code-craft/documentation](../../../code-craft/documentation/05-architecture-decision-records-adrs/).

## Task 11 — Decision vs outcome retro

Find a past technical decision that turned out badly. Answer two questions separately and in writing: (a) Given the information available *at the time*, was the decision *process* sound (fair baseline, honest weights, stated assumptions)? (b) Was the *outcome* good? Notice whether your answers diverge. Write one sentence on what this divergence teaches about how to judge — and reward — decisions. *(This is the [hindsight-bias](../03-cognitive-biases-in-code-decisions/) defense in practice.)*

## Task 12 — Convert a one-way door and price the option

Pick a genuinely irreversible decision your team faces (vendor, data model, framework). Design a concrete tactic to convert it into a two-way door (interface/port, versioning, strangler-fig, schema evolution). Then evaluate the conversion *itself* as a tradeoff: what does the optionality cost (indirection, generality, build time), and is the cost-of-wrong high enough and uncertain enough to justify paying it? **Pass condition:** you conclude *with* a justification for paying or *not* paying for the optionality — optionality is not automatically worth it.

---

**When you've done these:** revisit a decision you're currently agonizing over. Diagnose the door, time-box the analysis, price the cost of delay, and write the ADR. If the matrix picks the boring option, that's usually the process working. Cross-link back to the section: claims/evidence in [01](../01-claims-evidence-and-reasoning/), fallacies in [02](../02-logical-fallacies-in-engineering/), biases in [03](../03-cognitive-biases-in-code-decisions/), and the broader [section overview](../). Related: systems-thinking tradeoffs in [../../03-systems-thinking/](../../03-systems-thinking/) and reasoning under uncertainty in [../../06-probabilistic-thinking/](../../06-probabilistic-thinking/).
