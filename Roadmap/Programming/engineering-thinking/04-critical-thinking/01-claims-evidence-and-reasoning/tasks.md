> Analysis and decision exercises for separating claims from evidence and reasoning. **Global constraints:** for every task, explicitly label the (a) *claim*, (b) *evidence offered and its tier* (impression / anecdote / microbenchmark / load test / production trace / proof), and (c) *warrant* — the rule connecting them. Then state what evidence would actually settle it and how confident the conclusion is allowed to be. Where a number is given, do the arithmetic. There is no single right answer to most of these; there are well-reasoned and poorly-reasoned ones.

---

## Task 1 — Decompose and find the missing piece

For each statement, split it into claim / evidence / warrant, and name which of the three is missing or weakest:

1. "The new ORM is slow — my page took 3 seconds to load yesterday."
2. "We should add more replicas; the database is clearly the bottleneck."
3. "This code is unmaintainable, so we should rewrite it."
4. "Switching to HTTP/2 will cut our latency — every benchmark online shows it's faster."

**Deliverable:** a 4-row table. For each, write the one sentence you'd reply with to get the missing piece without being a jerk.

## Task 2 — Rank the evidence

You're told a checkout endpoint is slow. Five people bring "evidence." Rank them weakest→strongest and justify each ranking in one line:

- A: "Our APM dashboard shows p99 = 2.1 s over the last 24 h, target is 400 ms."
- B: "I clicked through checkout and it felt laggy."
- C: "A microbenchmark of the tax-calculation function shows 8 ms/call."
- D: "A 30-minute load test at production traffic shape held p99 at 1.9 s."
- E: "A production CPU profile shows 55% of checkout time in tax calculation."

**Deliverable:** the ranking, plus: which single piece tells you *where* the time goes, and which tells you *how much* — and why you need both.

## Task 3 — Amdahl arithmetic on a perf claim

A PR claims: "I optimized JSON serialization to be 3× faster — this is a big win." A production profile shows serialization is **6%** of request time.

1. Compute the overall speedup using `1 / ((1 - p) + p/s)` with `p = 0.06, s = 3`.
2. Express it as a percent improvement in total request time.
3. State the warrant the PR author is implicitly relying on, and whether it holds.
4. At what value of `p` would this optimization yield at least a 10% overall improvement? (Solve for `p`.)
5. Write the honest one-line conclusion the PR description should carry.

## Task 4 — Correlation vs. causation in an incident

Incident timeline:
- 09:00 — daily analytics batch job starts
- 09:01 — deploy of service `orders` goes out
- 09:02 — `orders` p99 jumps from 120 ms to 900 ms
- 09:04 — marketing push notification sent to 2M users
- 09:18 — p99 returns to 140 ms

The on-call concludes "the deploy caused it" and rolls back at 09:15.

**Deliverable:**
1. List every candidate cause and the confounders.
2. For the deploy hypothesis, evaluate it against temporality, strength, consistency, plausibility, and experiment.
3. Does "p99 recovered at 09:18 after the 09:15 rollback" prove the deploy was the cause? Explain.
4. Design the *one* controlled experiment that would actually settle which cause it was.

## Task 5 — Surface the warrant in a stalemate

Two engineers agree on the grounds: a flame graph shows **40% of CPU in garbage collection** on a hot service.

- Engineer A wants to pool buffers and reuse slices.
- Engineer B wants to raise the GC target (`GOGC`).
- Engineer C wants to move a batch workload out of the process entirely.

**Deliverable:** write out each engineer's *warrant* (the rule that makes 40%-in-GC imply their fix). Then name the single piece of differentiating evidence for each warrant, and write the pre-committed decision rule the team should agree to *before* gathering it.

## Task 6 — Calibrate the verb

Each claim below is paired with its evidence. State whether the verb is over-confident, under-confident, or well-calibrated, and rewrite it to match the evidence tier:

1. "This **proves** the cache helps" — evidence: one microbenchmark on synthetic keys.
2. "This **might** reduce latency" — evidence: a clean A/B test, 50k users/arm, 18% p99 reduction, p < 0.01.
3. "Adding the index **will** fix the slow query" — evidence: an `EXPLAIN ANALYZE` showing the seq scan that the index would eliminate.
4. "The memory leak **is** in the connection pool" — evidence: one heap snapshot where pool objects are the largest retained set, not reproduced.

## Task 7 — Steelman before you refute

A proposal: "Split the monolith into microservices to let teams deploy independently."

You think it's premature. **Before** arguing against it:
1. Write the *strongest* version of the proposal — its best evidence and its real upside.
2. Identify which warrant the proposal depends on (what must be true for the split to deliver independent deploys).
3. Now write your strongest rebuttal — but it must attack the *steelmanned* version, naming the specific evidence that would distinguish "deploy coupling" from "data coupling."

## Task 8 — Extraordinary claim audit

For each claim, rate how *extraordinary* it is (mundane / surprising / extraordinary) and state the minimum evidence you'd require before acting:

1. "Adding `LIMIT` to that query made it return faster."
2. "The Linux kernel's TCP stack has a bug that's dropping our packets."
3. "Removing one debug log line cut our p99 by 45%."
4. "Our compiler is mis-optimizing this loop and producing wrong results."
5. "Increasing the connection pool from 10 to 50 raised throughput."

**Deliverable:** for the two you rated most extraordinary, write the reproducible artifact you'd demand (what it contains, what it controls for).

## Task 9 — Provenance interrogation

A teammate shares a flame graph "proving" that lock contention is the bottleneck and the fix is a lock-free queue. List the **six provenance questions** you'd ask before accepting it (workload, hardware, warm/cold, concurrency level, capture time, sampling method). For each, give a concrete way the answer could *invalidate* the conclusion.

## Task 10 — "What would change your mind?"

You're in a design review at an impasse: you favor SQL, a colleague favors a document store, for a new feature.

1. Write down, *honestly*, the evidence that would make you abandon SQL for this feature.
2. Predict what your colleague's answer to the same question would be.
3. If either answer is "nothing," what does that tell you about the nature of the disagreement, and how should the team handle it differently?
4. Turn the two answers into a concrete experiment or spike that would settle it.

## Task 11 — Decision record under thin evidence

You must decide whether to migrate a session store from Postgres to Redis, but the evidence is incomplete (you have a load test showing 18 ms p99 session reads, but no profile telling you whether that's the store or your serialization code).

**Deliverable:** fill in the decision-record fields — `DECISION`, `EVIDENCE` (with tiers and provenance caveats), `WARRANT`, `CONFIDENCE` (a calibrated %), `REBUTTAL` (kill-criteria), `REVERSAL` (escape hatch). Then describe the staged, reversible first step that gathers the missing evidence before any irreversible migration.

## Task 12 — Set the standard of proof

For each decision, assign a standard of proof (preponderance / clear-and-convincing / beyond-reasonable-doubt) based on blast radius and reversibility, and list the evidence that meets that bar:

1. Bump a feature flag's rollout from 5% to 10%.
2. Adopt a new logging library across all services.
3. Permanently delete a column of historical user data.
4. Change the public API's pagination contract.
5. Switch a single service's GC tuning parameter.

**Deliverable:** a 5-row table (decision → standard → required evidence → reversal cost). Explain why a uniform standard across all five would be a mistake in both directions.
