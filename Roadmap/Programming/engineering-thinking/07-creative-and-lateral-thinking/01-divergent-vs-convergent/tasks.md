> Practice exercises for divergent/convergent thinking. **Global constraints for every task:** (1) keep the phases *separate in time* — when generating, write down every option and judge nothing; only switch to evaluation when the task says to. (2) Measure divergence by **flexibility** (distinct *categories*), not raw count — restyling one idea doesn't count. (3) Whenever you converge, write the **criteria and rough weights *before* listing the options**. Use a real problem from your current work where one is suggested. Deliverables are short artifacts (a list, a table, a one-page doc), not essays.

---

## Task 1 — Force fluency past the obvious

Pick a small real problem you'd normally solve in one move (e.g. "this endpoint is slow," "this config is duplicated across three services"). Set a timer for 7 minutes and list **at least 10** ways to address it. Judge nothing; the goal is reaching 10.

**Deliverable:** the raw list of 10+. **Reflect:** which idea was #1, and which final one would you actually have missed by stopping early? Note where the *first workable* idea landed in the list.

## Task 2 — Audit your own flexibility

Take the list from Task 1 and group the items into *categories* (e.g. for a slow endpoint: caching / precompute / denormalize / change-access-pattern / drop-requirement / move-off-critical-path).

**Deliverable:** the list, clustered. **Pass condition:** at least **4 distinct categories**. If most items collapse into one or two, you produced fluency without flexibility — go back and force one option from a category you haven't touched.

## Task 3 — Separate the phases explicitly

Run a small design decision in two clearly labeled passes on paper:
- **Pass A (DIVERGE):** options only, no evaluation. Stop. Draw a line.
- **Pass B (CONVERGE):** criteria first (weighted), then score the Pass-A options, then pick.

**Deliverable:** a two-section page with a visible divider between the passes. **Reflect:** did any judgment leak into Pass A? Catch yourself the next time it does.

## Task 4 — Criteria-before-options discipline

For a decision you have to make this week, write the decision criteria and rough weights **before** generating or looking at any options. Seal it (don't edit it). Then generate options and score them.

**Deliverable:** the locked criteria block + the scored options. **Trap to watch:** if you feel an urge to re-weight the criteria after seeing which option they favor — *don't*. Note the urge; that's the rationalization reflex.

## Task 5 — Diverge on the *problem*, not the solution

Take a ticket phrased as a solution ("add a Redis cache to X," "introduce a queue for Y"). Apply "what problem does this solve?" laddering three times to climb to the real problem, then list **3+ solution categories** the restated problem allows.

**Deliverable:** the ladder (3 levels) + the alternative solution categories. **Reflect:** did caching/queueing turn out to be *one* option among several, rather than the answer?

## Task 6 — SCAMPER a stuck design

Take a design you currently consider "the obvious way." Run all seven SCAMPER prompts (Substitute, Combine, Adapt, Modify/Magnify, Put-to-other-use, Eliminate, Reverse/Rearrange) and generate at least one alternative per prompt.

**Deliverable:** a 7-row table (prompt → alternative). **Pass condition:** at least one alternative you'd genuinely consider that you hadn't thought of before.

## Task 7 — Worst-possible-idea

Pick a current problem and deliberately list 5 *terrible* solutions. Then, for each, write the **inverse** — what a good idea hiding in the bad one might be.

**Deliverable:** 5 bad ideas + 5 inversions. (This is also a warm-up for [inversion thinking](../02-inversion-thinking/).) **Reflect:** did any inversion surface a real option?

## Task 8 — Generate the hypothesis set before debugging

Next time you hit a non-obvious bug, *before* touching the code, list **6 hypotheses** for the cause. Then rank them by a cheap *discriminating* test — which single test splits the hypothesis set roughly in half — and run that first.

**Deliverable:** the 6 hypotheses + the test order + which test you ran first. **Reflect:** would your instinctive first guess have been the fastest way to the answer? Usually not.

## Task 9 — Diverge in a code review

On your next review, before writing any comment, list **all the ways the change could break** — concurrency, empty/nil inputs, partial failure, the unhappy path, future-maintainer confusion. *Then* converge: mark each as blocking or non-blocking.

**Deliverable:** the failure-mode list, each tagged block / nit. **Reflect:** did the diverge-first pass surface anything you'd have missed reviewing line-by-line?

## Task 10 — Converge with explicit criteria and a deadline

Take an open decision you've been sitting on. Classify it: **two-way door** (reversible) or **one-way door** (costly to reverse). Set a convergence budget accordingly — fast and light for two-way, deeper for one-way — put a real *date* on the decision, and converge.

**Deliverable:** door classification + criteria + chosen option + decision date. **Reflect:** were you over-diverging on a reversible decision (slow for no reason) or under-diverging on an irreversible one?

## Task 11 — Run an anti-anchoring group divergence

For a team design discussion, run a **brainwriting** round: everyone writes options silently for 5 minutes *before* anyone speaks. Collect, dedupe into categories, then dot-vote to converge.

**Deliverable:** the combined option set (categorized) + vote results. **Compare:** count how many distinct categories surfaced versus what a normal "let's discuss" would have produced. Note who contributed ideas they might not have voiced aloud first.

## Task 12 — Capstone: a phase-separated mini-RFC

For a real decision, write a one-page doc with these sections *in this order*: Problem (stated independently of any solution) → Decision criteria (weighted) → **Alternatives considered (≥3 distinct categories, each with why-not)** → Proposal (scored against the criteria) → Reversibility (one-way / two-way) + decision deadline.

**Deliverable:** the one-page RFC. **Pass condition:** the "Alternatives considered" section has at least 3 *genuinely different* approaches — if a reviewer could say "these are all the same idea restyled," it fails. This is the durable form of everything above and feeds straight into [evaluating trade-offs objectively](../../04-critical-thinking/04-evaluating-tradeoffs-objectively/) and the [problem-solving](../../02-problem-solving/) workflow.
