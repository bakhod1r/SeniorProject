> These tasks make you *design and run* deliberate practice, not just read about it. Global constraints: (1) every regimen you design must name a **well-defined target skill**, a **fast feedback source**, and a **refinement rule** — if any is missing, it isn't deliberate practice; (2) keep each rep short (15–30 min) and **log** every rep (target, what failed, what you fixed); (3) prefer drills you can run *this week* with tools you already have; (4) produce the concrete deliverable where one is asked. Reuse the comfort/learning/panic framing and the four Ericsson ingredients throughout.

## Task 1 — Audit a week of your real work for practice targets

Track one week of your actual work. List every moment you were **slow, sloppy, fearful, or guessing**. Turn the top 5 into a table: `symptom → underlying skill → a narrow drill that targets it → its feedback source`.

**Deliverable:** the 5-row table. Acceptance: each drill is narrow enough to do in 20 minutes and each has a feedback source faster than your next review cycle.

## Task 2 — Run the FizzBuzz five-ways progression

Solve FizzBuzz five times under escalating constraints: (1) obvious way, timed; (2) from a blank file, faster; (3) no `if`/`else`; (4) test-first; (5) no mutable variables. Time each rep and write one line on what each variation taught you.

**Deliverable:** five solutions + a 5-line learning log. Acceptance: the reps differ in *how*, not just cosmetically; tests pass for each.

## Task 3 — Reimplement great code and diff it

Pick one small, well-regarded piece of code (a stdlib function, an LRU cache, retry-with-backoff, a ring buffer). Read it until you understand it, **close it**, reimplement from intent, then diff against the original.

**Deliverable:** your implementation + a written list of every divergence and *why the experts chose theirs*. Acceptance: at least 3 divergences explained, not just listed.

## Task 4 — Turn your worst weakness into a kata

Take the single skill you most avoid (raw SQL, no-debugger debugging, writing tests, regex, concurrency). Design a **repeatable** kata: the exact task, the constraint, the feedback oracle, and a 2-week daily schedule of reps with rising difficulty.

**Deliverable:** the kata spec + 2-week schedule. Acceptance: difficulty rises across days; you can run day 1 immediately.

## Task 5 — Add a feedback loop to a feedback-poor activity

Choose an activity where you currently get *no* fast feedback (e.g. design decisions, estimates, code reviews you give). Design a loop that manufactures feedback: a **dated prediction + a later checkable ground truth**.

**Deliverable:** the loop description and a filled-in first prediction with a calendar date to check it. Acceptance: the prediction is specific and falsifiable, and the check date is set.

## Task 6 — Constraint-practice session

Run one real task (or kata) under a constraint from the list: no mouse, no debugger, no autocomplete/AI, no stdlib, or a hard 15-minute timer. Note where the constraint exposed a gap in your skill.

**Deliverable:** a short write-up of what the constraint forced you to learn. Acceptance: you name a *specific* gap the constraint surfaced (e.g. "I didn't actually know the API; I was pattern-matching autocomplete").

## Task 7 — Deconstruct an expert solution

Find code or a merged PR clearly better than what you'd have written. Answer in writing: What problem were they *really* solving (including the ones you missed)? What did they choose *not* to do, and why? What breaks if you remove each piece?

**Deliverable:** the three-part written analysis. Acceptance: you identify at least one problem they solved that you hadn't noticed.

## Task 8 — Calibrate your zones honestly

List 8 things you did at work last month. Tag each comfort / learning / panic. Count them. If 6+ are comfort, redesign one comfort task into a learning-zone version by adding a constraint or raising the bar.

**Deliverable:** the tagged list + the one redesigned task. Acceptance: the redesign genuinely moves it into the learning zone (you'd now struggle on ~⅓ of attempts).

## Task 9 — Practice a non-coding skill deliberately

Pick one of: design, technical writing, code review, debugging, estimation. Design a rep with a prediction-and-check loop (e.g. rewrite a design doc for 3 audiences and treat reader questions as your bugs; or predict a PR's issues then compare to a senior's review).

**Deliverable:** the rep design + the result of running it once. Acceptance: the feedback came from *outside your own head* (a reader, a reviewer, an actual outcome).

## Task 10 — Build a sustainable 4-week regimen

Design a 4-week deliberate-practice plan around a single theme. Specify the daily cap (≤25 min), the weekly progression, the feedback source, and a weekly review step where you re-read your log and **raise the bar** on whatever's no longer hard.

**Deliverable:** the 4-week plan. Acceptance: it's sustainable (short daily reps, not weekend binges), and difficulty escalates as you improve.

## Task 11 — Detect a personal plateau

Write the honest answer: name a skill where you have "years of experience" but suspect you stopped improving. What feedback would *prove* it either way? Design the minimal experiment to find out.

**Deliverable:** the named skill, the proof-metric, and the experiment. Acceptance: the metric is observable, not a feeling ("I haven't learned a new query pattern in 2 years" beats "I feel stuck").

## Task 12 — (Staff) Design a team practice loop

Pick one team ritual that's currently a plateau-maker (LGTM reviews, ritual postmortems, undocumented decisions). Redesign it into a deliberate-practice loop: what feedback does it now manufacture, how do you keep it *safe* to struggle, and how will you measure that the team's skill (not just output) is rising?

**Deliverable:** the redesigned ritual + one learning metric (e.g. incident recurrence, ADR-prediction accuracy, review depth). Acceptance: the metric tracks *learning*, not throughput, and the loop has a prediction-and-check structure.

---

## Related

- [Middle](./middle.md) · [Senior](./senior.md) · [Professional](./professional.md) · [Interview Q&A](./interview.md)
- [Learning how to learn](../01-learning-how-to-learn/) · [Debugging your own reasoning](../02-debugging-your-own-reasoning/) · [Knowing what you don't know](../04-knowing-what-you-dont-know/)
- [First-principles thinking](../../05-first-principles-thinking/) · [Section overview](../) · [Engineering Thinking root](../../README.md)
