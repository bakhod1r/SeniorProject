> Practice turning vague hunches into falsifiable hypotheses and designing experiments that *exclude* candidates. **Global constraints for every task:** (1) every hypothesis must be falsifiable — state the exact result that would prove it WRONG (the kill criterion); (2) make predictions **numeric** wherever a number is possible; (3) where multiple causes are in play, design the **single experiment that discriminates the most candidates per run** (strong inference); (4) write the prediction *before* you'd look at any data. Use this template throughout:
>
> ```
> HYPOTHESIS:  <X>
> EXPERIMENT:  <smallest test>
> PREDICTION:  if X, I expect <numeric Y>
> KILL:        if I don't see Y, X is wrong
> ```

---

## Task 1 — Reframe five hunches as hypotheses

For each vague statement, write a falsifiable hypothesis with a numeric prediction and a kill criterion.

1. "The cache is the problem."
2. "It's a memory leak."
3. "The new ORM is slow."
4. "It's probably the network."
5. "The GC is killing us."

**Done when:** each one names a concrete action, a numeric predicted result, and a result that would refute it. Self-check: could each hypothesis actually come out *false*? If not, rewrite it.

---

## Task 2 — Spot the unfalsifiable claim

Here are four incident closing statements. Mark each as falsifiable or not. For each unfalsifiable one, rewrite it so it rules something out.

- (a) "Resolved — was a transient blip, no action needed."
- (b) "Root cause: deploy r-204 introduced an N+1 query on the orders endpoint."
- (c) "Works fine now, must have been a fluke."
- (d) "Probably some upstream issue, monitoring."

**Done when:** you've justified each verdict in one sentence and produced a falsifiable rewrite (with a prediction) for every unfalsifiable one.

---

## Task 3 — Check the null hypothesis first

Scenario: error rate on `/signup` is 4%, and a deploy went out two hours ago. Your teammate is already writing a fix for the new code.

1. State the **null hypothesis** for this situation (there's more than one reasonable null).
2. Describe the single cheapest check that would test the null *before* anyone touches code.
3. Give the result that would **kill** the null (implicate the deploy) and the result that would **confirm** it (exonerate the deploy).

**Done when:** your null check is something runnable in under five minutes and clearly precedes any code change.

---

## Task 4 — Design the discriminating experiment

A `/api/orders` endpoint returns 500 on ~3% of requests. Three live hypotheses:

- H1: a DB migration locks a table under load.
- H2: a downstream payment service intermittently times out.
- H3: a null-pointer on a specific input shape in new code.

Instead of testing H1, H2, H3 separately, design **one** experiment whose outcome can eliminate two of the three at once.

1. Describe the experiment.
2. Build a table mapping each possible observation to which hypotheses it kills and which survive.

**Done when:** at least one row of your table kills two hypotheses in a single observation.

---

## Task 5 — Confirmation-bias audit

You're convinced a slow database query is causing a latency spike. List **three** observations that, if you went looking for them, would *disconfirm* your theory (not confirm it). Then state which one you'd check first and why.

**Done when:** all three are genuinely disconfirming (each, if found, would force you to drop the query theory), and your "check first" choice is the cheapest or most decisive.

---

## Task 6 — One variable vs. multivariate

You suspect high latency is caused by **both** a missing index **and** an undersized connection pool. A colleague proposes deploying the index *and* bumping the pool in one release "to be safe."

1. Explain what you'll fail to learn if you do both at once.
2. Design the two-step single-variable plan, with the measurement and kill criterion for each step.
3. Name one situation where deploying both at once would actually be the right call.

**Done when:** each step has its own numeric prediction, and you've identified the legitimate exception (hint: recovery vs. diagnosis).

---

## Task 7 — Bisection as hypothesis testing

A perf regression entered somewhere in the last **256 commits**; you have a reproducible (scaled-down) test that answers "is the regression present? yes/no" in ~2 minutes.

1. Frame the bisection step as a falsifiable hypothesis ("the regression is in the *older* half — if so, the midpoint commit reproduces it").
2. Compute the worst-case number of test runs to localize the offending commit, and the total wall-clock time.
3. Explain why this is strong inference applied to version history.

**Done when:** you give the exact run count (⌈log₂ 256⌉) and the time, and connect each run to "exclude one half."

---

## Task 8 — Numeric prediction from a mechanism

A nightly job's runtime jumped from 40 min to 3 hours, while input data grew only ~8%. You bisect to a commit that added a `.filter()` *inside* a per-row loop (a nested scan).

1. State the complexity class this mechanism implies (before vs. after).
2. Give a **quantitative** prediction: if input rows double, what should runtime do if this mechanism is the cause?
3. State the kill criterion (what runtime-vs-data behavior would prove this mechanism is *not* the cause).
4. Predict the runtime *after* fixing it to a single hash-set lookup (O(n) total), starting from the 40-min baseline.

**Done when:** your "double the rows" prediction follows from the complexity class (≈ 4×), and you've stated a falsifying observation.

---

## Task 9 — Make a design claim falsifiable

An RFC contains the sentence: *"This sharding approach will scale comfortably and keep most queries fast."*

Rewrite it as **two** falsifiable claims, each with: a number, the test you'd run, the kill criterion, and *when* in the project you'd check it (ideally a cheap spike before the big build). One claim should be about throughput/latency; the other about cross-shard query share.

**Done when:** both claims could fail a measurement, and at least one is checkable *before* committing to the full implementation.

---

## Task 10 — Kill a zombie

A two-year "rewrite the monolith into microservices" program is justified by one founding sentence: *"The monolith cannot scale to our projected 2026 traffic (≈ 3× current)."*

1. Restate that premise as a falsifiable, numeric hypothesis.
2. Design the cheapest experiment that tests the **premise itself** (not microservices philosophy).
3. Build a 3-row outcome table (premise holds / falsified / partially holds) with the honest action for each.
4. In one sentence, explain why attacking the *premise's prediction* is more effective and less political than arguing about architecture.

**Done when:** your experiment costs days not quarters, and the "falsified" row leads to a concrete action (new justification or wind-down).

---

## Task 11 — The single-trial trap (with numbers)

A test fails intermittently. You suspect it's flaky 30% of the time. You apply a fix and want to claim it's resolved.

1. State the null hypothesis.
2. If the fix did *nothing* (still 30% flaky), what's the probability the test passes **once**? Passes **10 times** in a row? (Show the arithmetic.)
3. How many consecutive passes would drive the "still broken but lucky" probability below 1%?

**Done when:** you compute 0.7, 0.7¹⁰ ≈ 0.028, and solve 0.7ⁿ < 0.01 (n ≥ 13), and conclude how many runs justify rejecting the null.

---

## Task 12 — Full strong-inference loop (capstone)

Pick a real (or realistic) bug or perf issue you've seen. Run the complete loop and write it up:

1. **Symptom**, stated as an observable with a number.
2. The **null hypothesis** and how you'd check it first.
3. A **set** of at least three alternative hypotheses, each with a kill criterion.
4. The **order** you'd test them in, justified by *expected information per unit cost* (not just likelihood).
5. The **discriminating experiment** for the first round.
6. After your top hypothesis "confirms," the **residual check**: does it explain the full magnitude of the symptom?

**Done when:** every hypothesis is falsifiable, your test order is justified by cost *and* prior, and you've explicitly checked for a second cause.

---

### References

- Karl Popper, *The Logic of Scientific Discovery* (1934). · John R. Platt, "Strong Inference," *Science* (1964). · Richard Feynman, "Cargo Cult Science" (1974).
- Related practice: [experiments and A/B testing](../02-experiments-and-ab-testing/), [measure before optimize](../03-measure-before-optimize/), [spikes and prototypes](../04-spikes-and-prototypes/), [debugging as problem-solving](../../02-problem-solving/05-debugging-as-problem-solving/), [critical thinking](../../04-critical-thinking/).
