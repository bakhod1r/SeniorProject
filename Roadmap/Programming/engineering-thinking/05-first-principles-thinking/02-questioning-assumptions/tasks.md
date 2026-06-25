# Questioning Assumptions — Tasks

> Hands-on exercises for surfacing and testing hidden assumptions. **Global constraints:** for every task, (1) list assumptions *explicitly* — one per line; (2) tag each as **load-bearing** (wrong → redesign) or **incidental** (wrong → tweak); (3) for each load-bearing one, name the *cheapest* validation (a query, a spike, a measurement, one question to a stakeholder); (4) state the cost asymmetry — what it costs to check now vs. when it breaks in prod. Prefer concrete numbers over adjectives. No tooling required; a notebook and honesty are enough.

---

## Task 1 — Dissect the four-line function

```python
def greet(user):
    first, last = user["name"].split(" ")
    return f"Hello, {first}!"
```

List **every** assumption these four lines make (aim for at least eight). Then:
- Tag each load-bearing vs. incidental.
- For three of them, write the exact input that makes the code crash or misbehave.
- Rewrite the function so it makes the *fewest* assumptions while still greeting a person reasonably.

*Goal: feel how dense even trivial code is with implicit claims about reality.*

---

## Task 2 — The estimate, unpacked

A teammate says: *"Migrating user avatars from local disk to S3? Two days."*

Produce the **"two days assumes:"** list (at least five items). For each:
- Tag load-bearing vs. incidental.
- Write the one-line check (a SQL query, a sampled count, a doc lookup, a question) that would confirm or kill it.
- Then assume the checks reveal: 14M avatars, 3% dangling paths, mobile clients caching old URLs. Rewrite the estimate as a conditional: *"X days if …, otherwise …"*

*Goal: convert a wrong number into a real plan by surfacing assumptions before committing.*

---

## Task 3 — Reconstruct the buried assumption (incident)

**Incident report:** *"At 02:14 UTC, a batch of API requests timed out instantly with negative durations logged. The retry loop spun at 100% CPU. Recovered after a restart. No deploy occurred."*

Using **Five Whys**, walk from the symptom down to the unexamined assumption that caused it. State:
- The buried assumption in one sentence.
- Why it was *implicit* (where did it hide?).
- What made it false at 02:14.
- The fix, and the invariant/alert that would have caught it.

*Hint: "no deploy occurred" is the clue. Something other than code changed.*

---

## Task 4 — Apply inversion to "we can't"

A senior says: *"We can't make the analytics dashboard real-time — the query takes 6 minutes."*

- List the hidden **"must"** assumptions inside that "can't" (at least four).
- For each "must," ask whether it's a real constraint (physics, law, cost) or an inherited assumption.
- Pick the two most likely to be false and describe the cheap experiment that would test each.
- Propose one design that survives if those two "musts" turn out false.

*Goal: practice converting a stated impossibility into a design problem.*

---

## Task 5 — The power-law trap

You're designing an "activity feed." The design loads a user's events with:
```sql
SELECT * FROM events WHERE user_id = ? ORDER BY created_at DESC;
```
The design doc says: *"A user has a few hundred events, so this is fine."*

- Identify the load-bearing assumption.
- Write the **single query** against production that would validate or destroy it.
- Given a power-law distribution (median user: 200 events; p99.9 user: 8 million), explain precisely how this design fails and for whom.
- State the rule of thumb this teaches about "the typical user."

---

## Task 6 — Falsehoods audit on a "simple" type

Your schema has:
```sql
CREATE TABLE contacts (
  full_name   VARCHAR(40),
  phone       VARCHAR(15),
  postal_code VARCHAR(10),
  created_at  INT  -- unix seconds
);
```
For **each** column, list two false assumptions baked into it (drawing on the "falsehoods about names / phone numbers / addresses / time" catalogs). Then:
- Identify which single column choice is a **dated time-bomb** and name the exact date it detonates.
- Propose the corrected type for that column and explain why.

*Goal: connect the "falsehoods believe" genre to a real DDL.*

---

## Task 7 — Monotonic vs. wall clock

Here are two timers:

```python
# A
start = time.time();      do_work(); print(time.time() - start)
# B
start = time.monotonic(); do_work(); print(time.monotonic() - start)
```

- State the assumption A makes that B does not.
- Give three real-world events that make A's assumption false (be specific — name the mechanisms).
- Describe a concrete production failure caused by a *negative* elapsed time.
- Which timer belongs in a rate-limiter, a timeout, and a "request took N ms" log line — and why?

---

## Task 8 — Run a pre-mortem

Project: *"Replace the synchronous payment call with an async queue to improve checkout latency."* Ship date in 8 weeks.

Run a written **pre-mortem**: it's 8 weeks later and this failed *badly*. Produce:
- At least six distinct failure causes ("we failed because …").
- For each, the underlying assumption the team was making.
- Cluster them, then pick the top two load-bearing assumptions to validate *before* writing code, and name the validation for each.

*Goal: practice the single most effective group surfacing technique solo.*

---

## Task 9 — Hyrum's Law: who depends on your accident?

Your service returns a JSON list of tags. Internally it happens to come back **alphabetically sorted** — you never documented or promised this. You want to switch to insertion order for performance.

- State the implicit interface (the unpromised behavior) downstream users may assume.
- List three concrete ways a consumer could be silently relying on the sort.
- Describe how you'd find out *empirically* who depends on it (not by guessing).
- Propose two strategies: one to safely change it, and one to *prevent* the assumption from forming in the first place.

---

## Task 10 — Validate vs. make-reversible

For each assumption below, decide whether the right move is **validate now** (and name the probe) or **make cheap to be wrong about** (and name the mechanism — interface seam, config flag, canary, alert). Justify using one-way vs. two-way door reasoning.

| # | Assumption |
|---|-----------|
| a | "Peak write rate stays under 5,000/s for the next 2 years." |
| b | "Our IDs fit in int64." |
| c | "Fan-out-on-write beats fan-out-on-read for our feed." |
| d | "Vendor X's payment API maintains 99.9% availability." |
| e | "This new compression library is fast enough on our payloads." |

*Goal: internalize that not every assumption is validated — some are made survivable instead.*

---

## Task 11 — Requirements as invariants

Take this requirement: *"Show the user their account balance and let them transfer funds."*

- Rewrite it as a list of explicit invariants/assumptions (at least six), covering consistency, concurrency, identity ("the user" = one person?), and units (currency, minor units).
- Tag each load-bearing vs. incidental.
- Identify the one assumption whose violation could cause **money to be created or lost**, and describe the cheapest way to surface whether the current design honors it.

---

## Task 12 — Validate against the tail, not the mean

You're told: *"Average user has 200 notifications, so loading them all on page open is fine."* You have a `user_notifications` table.

- Write the query that would *confirm* the assumption the lazy way (and explain why it proves nothing about risk).
- Write the query that tries to *falsify* it — p50, p99, p999, and max.
- Given a result of `p50=200, p99=18k, p999=900k, max=11M`, state precisely which users break the design and what symptom they cause.
- Propose the design change, and state the threshold at which you'd alert.

*Goal: a validation that can only return "looks fine" has validated nothing.*

---

## Task 13 — Inherited architecture audit

Your team is about to copy a "fan-out-on-write timeline" architecture from a famous social-network engineering blog post.

- List the *contextual* assumptions that architecture silently relies on (scale, read/write ratio, team size, operational maturity, tolerance for staleness) — at least five.
- For each, state whether it plausibly holds for *your* org (be honest; you may not know — say so).
- Identify the one inherited assumption most likely to be false for you, and the cheapest experiment to test it before committing.

*Goal: copying the diagram imports the bet without the context.*

---

## Task 14 — Build the assumption table (capstone)

Pick a real design you're working on (or the activity-feed from Task 5). Produce a complete **Assumptions table** in the staff-level format:

| # | Assumption | Load-bearing? | Confidence (H/M/L) | Validation or monitor | Owner |
|---|-----------|---------------|--------------------|-----------------------|-------|

Requirements:
- At least eight rows.
- At least two rows whose "validation" is an **alert/monitor**, not a one-time check — and explain *why* those can't be validated once-and-for-all (i.e., they're functions of time or scale).
- One row that is a **cross-team dependency** (a Hyrum's-Law risk), with a note on turning it into an explicit contract.
- A closing paragraph: which single assumption, if false, would hurt most — and is it currently checked, monitored, or neither?

*This is the artifact you'd actually attach to a design doc. Make it real.*
