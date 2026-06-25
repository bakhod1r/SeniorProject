> Exercises for Pólya's second stage — *Devising a Plan*. The goal is to practice finding a strategy **before** coding: spotting the related/known problem, solving a simpler version first, working backward, and sequencing by risk. **Global constraints:** (1) For every task, write the plan *first* — in plain English, numbered steps — and only then (where asked) write code. (2) Each risky plan must name a **kill-criterion**: the observation that would prove the approach wrong. (3) Keep plans at the right altitude — checkable, not pseudo-code. Pair these with [Understanding the Problem](../01-understanding-the-problem/) (do that first) and [Carrying Out the Plan](../03-carrying-out-the-plan/) (test the plan after).

## Task 1 — Name the known problem

For each task below, write one line: *"This is really an instance of ___."* Don't solve them — just classify.

1. "Warn the user if their new password is too similar to the old one."
2. "Given build steps with dependencies, find a valid build order."
3. "Pick the maximum number of non-overlapping meetings for one room."
4. "Find duplicate files across a 2 TB disk."
5. "Auto-complete: given a prefix, return all matching product names."

**Deliverable:** five classifications (e.g., edit distance; topological sort; interval scheduling; hashing; trie/prefix search). The point is recognizing the *class* — that's where the plan comes from. See [pattern recognition](../../01-computational-thinking/02-pattern-recognition/).

## Task 2 — Solve a simpler version first

Problem: "Given an array of stock prices, find the maximum profit from one buy and one later sell."

Write a *ladder* of plans:
1. Plan for an array of size 2.
2. Plan for size 3.
3. Plan for any size — your first, possibly O(n²), idea.
4. Now generalize the pattern you noticed into an O(n) plan (hint: track the minimum-so-far).

**Deliverable:** four plans showing the climb from trivial to general. Note *which rung* gave you the insight for the O(n) version — that's the heuristic working.

## Task 3 — Work backward from the goal

Goal: "A weekly email to each user summarizing their activity, sent every Monday 9am their local time."

Starting from the goal, chain preconditions backward until you reach data/services you already have. (Email needs content → content needs per-user activity for the week → activity comes from the events table → "their local time" needs each user's timezone → …)

**Deliverable:** a backward chain of 5–7 preconditions, ending at things that already exist. Mark any precondition you *don't* currently have — those become the riskiest steps.

## Task 4 — Generate three approaches, then choose

Problem: "Our search endpoint is slow (p99 = 2.5s); get it under 300ms."

1. Write **three genuinely different** approaches (not three flavors of one).
2. For each, fill a row: approach | reduces to (known problem) | key risk | reversibility (one-way / two-way door).
3. Choose one and justify in two sentences, citing risk and reversibility.

**Deliverable:** the comparison table + the choice. This is [divergent-then-convergent](../../07-creative-and-lateral-thinking/01-divergent-vs-convergent/) in practice. If your three approaches are too similar, you haven't diverged enough — try again.

## Task 5 — Sequence by risk

You're integrating a third-party shipping-rates API into checkout. The raw work items are: build the rate-display UI, model the shipping options in the DB, call the shipping API and parse its response, handle the API being down, add caching for rates.

1. Order these *riskiest-part-first*.
2. Justify the first item: why is it the one most likely to invalidate the whole plan?
3. State a kill-criterion for it.

**Deliverable:** an ordered list + justification + kill-criterion (e.g., "If the API doesn't support our shipping regions, the whole feature is blocked — verify with a throwaway script before any UI work; kill-criterion: any required region returns 'unsupported'").

## Task 6 — Spike vs. build

For each scenario, decide whether the right next move is a **spike** (throwaway, to learn) or a **real implementation**, and say what *one question* the spike answers.

1. "We might switch our queue from RabbitMQ to Kafka."
2. "Add a 'remember me' checkbox to the login form."
3. "Can our current DB handle 10× write volume, or do we need to shard?"
4. "Rename the `usr` table to `users`."

**Deliverable:** four decisions, each spike justified by its single question. Note which are two-way doors where over-planning is waste. See [spikes & prototypes](../../09-scientific-and-hypothesis-driven/04-spikes-and-prototypes/).

## Task 7 — Restate to find the plan

Each problem below is stated in a way that hides the plan. Restate it so the path becomes obvious.

1. "Make sure no two users can grab the last item in stock at the same time." → restate as a ___ problem.
2. "Show users products similar to ones they've viewed." → restate as a ___ problem.
3. "Don't let the report job run twice if someone double-clicks." → restate as a ___ problem.

**Deliverable:** three restatements (e.g., concurrency/locking; similarity/nearest-neighbor; idempotency/deduplication). Notice how the restated form *names the technique*. Restating is one of Pólya's core heuristics.

## Task 8 — Right-altitude plan

Take this over-detailed "plan" (coding-in-disguise) and rewrite it at the correct altitude:

```
1. def import_csv(path): open file with csv.DictReader
2. for row in reader: validate row['email'] with EMAIL_REGEX
3. if invalid: append to errors_list, continue
4. user = User(email=row['email'], name=row['name'])
5. db.session.add(user); if i % 500 == 0: db.session.commit()
...
```

**Deliverable:** a 4–6 step plan in plain English stating *decisions and sequence* (validate-then-insert, batch the commits, collect errors rather than abort) with no syntax. Then write one sentence on a *checkable* gap the lower-altitude version hid (e.g., "what happens to a duplicate email?").

## Task 9 — Plan-or-just-do-it triage

For each change, decide: **write a plan** or **just try it**? Justify in one phrase using reversibility + blast radius.

1. Fix a typo in an error message.
2. Change the primary-key type of a 30M-row table from `int` to `uuid`.
3. Bump a dev dependency's patch version.
4. Switch the default sort order of a public API endpoint.
5. Adjust the padding on a button.

**Deliverable:** five decisions. The two that need real planning should be the irreversible / high-blast-radius ones (2 and 4).

## Task 10 — Plan as a falsifiable hypothesis

Pick any non-trivial task you have on your real backlog. Write its plan as a hypothesis:

```
HYPOTHESIS: <approach> will achieve <measurable outcome>.
RISKIEST STEP FIRST: <the unknown that could kill it> — kill-criterion: <observation>.
STEPS: <ordered, risk-first>.
DEFINITION OF DONE: <how you'll know it worked>.
```

**Deliverable:** the filled template. Then in [Carrying Out the Plan](../03-carrying-out-the-plan/), execute it and record where the plan diverged from reality — that gap is the most valuable thing you'll learn.

## Task 11 — Decompose a multi-team plan along seams

Initiative: "Extract checkout out of the monolith into its own service, with three teams (Checkout, Payments, Platform)."

1. Identify the **interfaces (seams)** between the teams — the contracts each team depends on.
2. Describe a **walking skeleton**: the thinnest end-to-end path through all three teams that proves the seams compose.
3. Name the single biggest *coordination* (non-technical) risk and how the sequence retires it early.

**Deliverable:** the seams list + walking-skeleton description + the coordination risk. This is the [professional-level](./professional.md) plan-by-interface move; the seams *are* the plan.

## Task 12 — Post-mortem a plan that died on contact

Recall a past project where the plan fell apart mid-execution. Reconstruct:

1. What was the original plan (one paragraph)?
2. What assumption did reality violate?
3. Was that assumption *named* in the plan, or hidden?
4. Could a riskiest-part-first ordering or an explicit kill-criterion have surfaced the problem earlier?

**Deliverable:** the four answers. The lesson transfers to your next plan via [Looking Back](../04-looking-back-and-reflecting/): the failure mode you name here is the assumption you'll write down next time.
