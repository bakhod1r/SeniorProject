> These exercises drill the *method*, not language trivia. Global constraints for every task: **(1)** state a falsifiable hypothesis before proposing any fix; **(2)** name the *cheapest discriminating test* — the one experiment whose outcome differs depending on whether your hypothesis is true; **(3)** change one thing at a time; **(4)** a fix counts as done only when you can describe how you'd *toggle the bug on and off*. Write your reasoning out; the thinking is the deliverable. Pseudocode is fine; the discipline is the point.

---

## Task 1 — Form the hypothesis from a stack trace

You see this in production logs:

```
TypeError: Cannot read properties of undefined (reading 'total')
    at computeInvoice (billing.js:34)
    at processOrder   (orders.js:88)
    at handleCheckout (api.js:12)
```

**Deliverable:** (a) From the *error type and top frame alone*, write one falsifiable hypothesis about what is `undefined` and why. (b) Name the cheapest test to confirm it. (c) Which frame do you open first, and why not start at `api.js:12`?

*Checks: reading the error before guessing; top-frame-first.*

---

## Task 2 — Find the cheapest discriminating test

A cart total displays as `NaN`. You have three competing hypotheses:

- H1: a price arrives as a string, so arithmetic concatenates/coerces wrong.
- H2: one item's `price` field is missing (`undefined`).
- H3: the tax rate lookup returns `undefined` for this user's region.

**Deliverable:** Design the **single** test (one log line or one breakpoint) that discriminates between *all three* at once — i.e. whose output tells you which one it is. Explain what each possible output would imply. (Hint: log the whole items array plus the rate, once, before the sum.)

*Checks: maximizing information per test; equiprobable-outcome thinking.*

---

## Task 3 — Bisect the regression with git bisect

A perf test shows checkout p99 went from 80ms to 1.2s somewhere between tag `v4.1.0` (good) and `HEAD` (bad), across ~600 commits.

**Deliverable:** (a) Write the `git bisect` command sequence to find the introducing commit by hand. (b) Write the one-line `git bisect run` invocation that automates it, and describe what the `repro_test.sh` script must do (exit code semantics). (c) Roughly how many commits will you actually test, and why is that O(log n) and not O(n)?

*Checks: binary search over time; scriptable pass/fail prerequisite.*

---

## Task 4 — Bisect the input

A JSON parser crashes on a 50,000-line config file but works on small files. You have no stack trace pointing at a line.

**Deliverable:** Describe the bisection procedure to isolate the offending line in ~16 steps instead of reading 50,000 lines. State explicitly, at each split, how you decide which half to keep. What invariant must hold for input-bisection to be valid (i.e. when does it *not* work)?

*Checks: bisect the input; awareness that bisection assumes a single localizable cause.*

---

## Task 5 — Symptom vs. cause (five whys)

A teammate's PR "fixes" intermittent 500s with:

```js
try {
  return computeShipping(order);
} catch (e) {
  return { cost: 0 };   // ship free rather than error
}
```

**Deliverable:** (a) Explain why this is a symptom fix and what new, worse bug it introduces. (b) Run the five whys on a plausible root cause (start: "computeShipping throws for some orders"). (c) Propose fixes at three different layers and say which you'd ship and why.

*Checks: symptom-vs-cause; five whys; choosing fix depth by durability.*

---

## Task 6 — Make the flaky bug reproducible

A test fails about 1 run in 200, only on CI, never locally. The failure is an assertion that a list is sorted after a concurrent merge.

**Deliverable:** List the concrete tactics you'd use to turn this 1-in-200 into a reliable repro, in priority order, with the hypothesis each one tests. For each tactic, state what result would *confirm* a race condition. (Consider: loop-to-amplify, inject delay to widen the window, race/thread sanitizer, environment diff CI-vs-local.)

*Checks: reproduction as the hard step; pinning the hidden variable; amplification.*

---

## Task 7 — Debug-this narrative: the heisenbug

A colleague reports: "There's a crash in the image pipeline, but every time I add a `console.log` to investigate, it stops crashing. With the logs removed it crashes again about a third of the time."

**Deliverable:** (a) Name the bug class and explain *why the log makes it disappear*. (b) What does the disappearance tell you about the likely cause? (c) Propose two low-perturbation observation techniques that won't hide the bug, and the hypothesis you'd test first.

*Checks: heisenbug recognition; the disappearance is a clue; low-perturbation observation.*

---

## Task 8 — Assertion bisection on corruption

A reporting job occasionally produces a negative account balance. Balances are computed by folding a time-sorted ledger; the invariant is that the running total is monotonic over the sorted ledger. The bug doesn't reproduce on demand.

**Deliverable:** (a) Where do you place assertions to bracket *where* the corruption enters — before the fold, inside it, or at ledger assembly — and in what order do you add them? (b) If `assert ledger.is_sorted_by(time)` fires before the fold, what have you learned and where do you bisect next? (c) Why is "re-sort the ledger before folding" the wrong fix?

*Checks: assertion tripwires; bracketing cause vs symptom; corruption surfacing far from source.*

---

## Task 9 — "Select isn't broken": cross-boundary debugging

Your service returns stale data. You suspect the upstream cache library has a bug.

**Deliverable:** (a) List the "check the plug" steps you'd run *before* blaming the library. (b) Describe the minimal reproduction you'd build to prove the bug is in the library and not your code, and why a minimal external repro is more persuasive than a description. (c) What's the prior probability the bug is yours, and what does that imply about where you look first?

*Checks: suspect-yourself-first; minimal external repro as proof; check assumptions/versions.*

---

## Task 10 — Lead the incident (change-one-thing across humans)

A sev-1: checkout is failing for ~3% of users. Eight engineers are on the call. Within five minutes, two have changed config in parallel, someone restarted a service, and the error rate is now *different* but no one knows which action caused what.

**Deliverable:** As incident commander, write the operating rules you impose to restore the scientific method to the *group*. Address: separating mitigation from diagnosis, serializing changes, the audit trail, and the shared hypothesis board. Then state how you'd recover the now-muddied cause-and-effect signal.

*Checks: change-one-thing at team scale; incident command; mitigation/diagnosis split; audit trail.*

---

## Task 11 — Bisect the distributed system

A user-facing latency spike affects only some requests. You have metrics, distributed traces, and structured logs with fields `region`, `tenant`, `build_id`, `client_version`.

**Deliverable:** Describe how you'd bisect across *each* available axis (time/deploy, cohort, topology) to localize the cause, and in what order you'd try them and why. For each axis, state the binary question you're answering and what a "yes" eliminates. Which signal is the "stack trace" of a distributed request, and what does it bisect?

*Checks: observability-driven bisection; choosing the cheapest cut first; traces as distributed stack trace.*

---

## Task 12 — Prove it's fixed, and kill the class

You've identified that a shared-slice append from multiple goroutines causes intermittent data corruption, and you have a candidate fix (each worker returns its own slice; deterministic merge).

**Deliverable:** (a) Describe the exact *toggle* procedure that proves your fix addresses *this* bug. (b) Write the regression test that must fail without the fix — what does it assert and how do you make the race reliable enough that the test is meaningful? (c) The same shared-slice pattern appears in three other jobs. What's your class-elimination action so this category can't recur (think lint rule / type / shared library), and why is that worth more than the three individual fixes?

*Checks: toggle-on/off as proof; regression test that fails without the fix; eliminate the class, not the instance.*

---

← Back to [Problem-Solving](../) · [Decomposition (bisect)](../../01-computational-thinking/01-decomposition/) · [Measure before optimize](../../09-scientific-and-hypothesis-driven/03-measure-before-optimize/) · [Engineering Thinking root](../../README.md)
