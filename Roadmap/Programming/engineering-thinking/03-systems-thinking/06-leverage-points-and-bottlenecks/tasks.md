> Practice for finding the constraint and ranking leverage. Several tasks have worked numeric components (Amdahl's law, throughput, five focusing steps). **Global constraints:** (1) never optimize before you've identified the constraint by measurement; (2) for every fix, state where the bottleneck *moves* next; (3) when you compute a speedup, also compute the Amdahl ceiling (`1/(1-p)`) and say whether the work is worth it; (4) prefer the higher Meadows tier when two fixes both "work." Show your arithmetic.

---

## Task 1 — Throughput of a serial pipeline

A pipeline has four serial stages at **800, 600, 150, 2000 req/s**.

1. What is the pipeline's throughput? Which stage is the constraint?
2. You spend a week making the 2000/s stage handle 4000/s. New throughput?
3. Instead, you make the constraint handle 600/s. New throughput, and what's the new constraint?

*Target:* (1) 150/s, the 3rd stage. (2) Still 150/s — zero gain, non-constraint. (3) 600/s (4× improvement); new constraint is the 600/s stage (now tied with stage 2). State the lesson: only the constraint moves the number.

## Task 2 — Amdahl: is this optimization worth starting?

A request takes **200ms**: auth 20ms, business logic 30ms, DB query 140ms, serialization 10ms.

1. Compute `p` for each part (fraction of total).
2. You can make serialization **10× faster**. Overall speedup? Time saved?
3. You can make the DB query **4× faster**. Overall speedup? Time saved?
4. What's the *ceiling* (`s→∞`) for optimizing serialization? For the DB?
5. Which do you fund, and why?

*Target:* DB `p=0.70`, serialization `p=0.05`. (2) `1/(0.95+0.05/10)=1/0.955≈1.047×`, saves ~9ms. (3) `1/(0.30+0.70/4)=1/0.475≈2.1×`, saves ~95ms. (4) serialization ceiling `1/0.95≈1.05×`; DB ceiling `1/0.30≈3.33×`. Fund the DB — bigger `p`, bigger ceiling, real reward.

## Task 3 — Apply the five focusing steps

A nightly ETL processes 2M rows. Stages: **Extract 80k/min, Transform 20k/min, Load 50k/min.** Transform is single-threaded and sits idle ~25% of the time waiting on a poorly-fed input queue. Extract runs flat-out and the staging buffer keeps OOMing.

Walk through all five steps explicitly:
1. **Identify** the constraint and the current job runtime (2M rows).
2. **Exploit** — what free capacity can you recover? New effective rate and runtime?
3. **Subordinate** — what do you do about Extract, and why does it help even though throughput is unchanged by it?
4. **Elevate** — propose a real capacity increase for Transform.
5. **Repeat** — after elevating, what's the new constraint?

*Target:* (1) Transform 20k/min → 100 min. (2) Fix the queue feed → ~25k/min → 80 min, no new resources. (3) Throttle Extract to match Transform — stops the OOM, calmer system, same throughput; running it flat-out only builds inventory. (4) Parallelize Transform 4× → 100k/min. (5) Load (50k/min) becomes the constraint → job now ~40 min.

## Task 4 — Rank the leverage points

For a service with rising latency under load, rank these interventions by Meadows leverage, weakest to strongest, and name the tier:

- (a) Bump the HTTP timeout from 5s to 30s
- (b) Add a circuit breaker with backoff
- (c) Change the team's goal from "feature velocity" to "feature velocity within an error budget"
- (d) Increase the connection-pool size from 10 to 50
- (e) Shorten the deploy→alert feedback delay from 1 hour to 2 minutes

*Target:* weakest → (a),(d) parameters; (b),(e) feedback-loop structure/delay; strongest (c) goal. Note: (a) and (d) may not fix anything (they treat symptoms); (b)/(e) change loops; (c) redirects the whole system's optimization. Also flag: (a) bumping the timeout often *hides* the constraint rather than fixing it.

## Task 5 — Push the leverage point the wrong way

For each scenario, identify the leverage point the team found, the wrong direction they pushed, and the correct direction:

1. Latency up → team **increases** retry count to 5.
2. CI is flaky → team **increases** the auto-retry-the-test count to 3.
3. Too many prod incidents → team **adds** a manual approval gate before every deploy.

*Target:* (1) leverage = retries; wrong (more load on a struggling service → worse); right = shed load / back off. (2) leverage = test handling; wrong (masks the flake → it surfaces in prod); right = fix or quarantine the flaky test (it's the constraint on every merge). (3) leverage = batch size / loop length; wrong (gate lengthens the loop → bigger batches → more risk → more incidents); right = smaller, more frequent deploys. All three: right point, wrong direction — Meadows' core warning.

## Task 6 — The constraint is not where the pain is

A dashboard takes **3.5s** to load. Users blame the frontend. You trace one request:

```
Frontend render:        250 ms
Network round trips:     300 ms
API handler CPU:         50 ms
Auth service call:       150 ms
DB query:              2750 ms   (DB CPU during this: 4%)
```

1. Where is the pain felt? Where is the time?
2. The DB CPU is 4% during a 2750ms wait. Is the DB the constraint? What is?
3. Rank the three candidate fixes by Amdahl reward: (a) optimize frontend render, (b) cache the auth call, (c) fix whatever makes the DB *wait*.
4. What do you do first?

*Target:* (1) pain = frontend; time = DB wait (79%). (2) DB isn't the constraint — 4% CPU with huge wait means work is *queuing* to reach it (connection pool / lock); the constraint is the pool/lock, not the DB engine. (3) frontend `p=0.07`→ceiling 1.08×; auth `p=0.04`→1.05×; DB-wait `p=0.79`→ceiling ~4.8×. (4) fix the DB-wait constraint (right-size the pool / remove the lock) — everything else is rounding error.

## Task 7 — Stacked Amdahl and when to stop

A job takes **100s**: part A=60s, B=25s, C=15s.

1. Optimize A by 4× (60→15s). New total and cumulative speedup?
2. Recompute each part's `p` of the *new* total. What's the new constraint?
3. Optimize the new constraint by 2×. New total?
4. After step 3, what's the largest remaining `p`, and would you keep going? Justify with the ceiling.

*Target:* (1) total 55s, 1.82×. (2) of 55s: B `25/55=0.45` ← constraint, A 0.27, C 0.27. (3) B 25→12.5s → total 42.5s. (4) largest is now A at `15/42.5≈0.35`, ceiling `1/0.65≈1.54×` for a part already optimized once — likely stop; the constraint is becoming "good enough." Name the stop-signal: shrinking marginal reward.

## Task 8 — Find the org-level constraint

A 50-engineer org ships ~3 features/quarter, wants 6. Value-stream wait times:

```
Idea → spec:              1 day
Spec → architecture review: 9 days
Review → build:           7 days
Build → code review:      5 days
Review → deploy:          1 day
```

1. What's the constraint? (longest *wait*, not work)
2. Leadership proposes hiring 15 engineers into build teams. Predict the effect on throughput.
3. Give one *exploit* move and one *elevate* move for the constraint. Which Meadows tier does your elevate move touch?
4. After fixing it, what's the next constraint?

*Target:* (1) architecture review (9 days). (2) hiring slows the org — more designs pile up unreviewed in front of the constraint; throughput unchanged or worse. (3) exploit: pre-triage trivial changes out, batch context, meet more than weekly; elevate: delegate review authority for low-risk changes to in-team seniors — touches the **rule** tier (who may approve), high leverage. (4) code review (5 days) becomes next.

## Task 9 — Goal as the highest leverage point

An org *says* it values reliability but ships incidents constantly. Promotions reward shipped features; nothing rewards reliability work; the on-call backlog is ignored.

1. Why won't process tweaks (more runbooks, more alerts) fix this?
2. Name the actual leverage point and the change.
3. What Goodhart risk does your change introduce, and how do you blunt it?

*Target:* (1) the system optimizes what's *rewarded*, not what's *said*; reliability is a non-goal, so it's starved regardless of process. (2) the leverage point is the **goal/incentive** — e.g. an error budget that gates feature work on reliability, plus reliability work counting in promo criteria. (3) Goodhart: teams may game the budget (suppress/relabel incidents); blunt it by measuring user-facing SLOs (hard to fake) and not tying it to individual punishment.

## Task 10 — The one-flaky-test cost model

One integration test fails ~1-in-4 CI runs; CI must be green to merge. Team: **10 engineers, ~2 merges/engineer/day, re-run takes 15 min**, and a flake forces ~1 re-run.

1. Expected re-runs/day across the team?
2. Engineer-hours/day lost to re-runs?
3. Compare that to the cost of one engineer spending 2 days fixing the test. Payback period?
4. Why is this higher-leverage than it looks, in constraint terms?

*Target:* (1) 10×2×0.25 = **5 re-runs/day**. (2) 5 × 15 min = **75 min ≈ 1.25 hrs/day**. (3) fix cost ~16 engineer-hours; payback ≈ 16/1.25 ≈ **~13 working days**, then pure savings forever (plus context-switch and morale costs not counted). (4) the test gates *every* merge — it's the constraint on team shipping throughput, so its true cost is system-wide, not local.

## Task 11 — Serial fraction floor

A data export is 30% an inherently serial step (a legally-required single-threaded signing operation) and 70% parallelizable work.

1. With infinite parallelism on the 70%, what's the max speedup?
2. If you currently run the 70% on 8 cores (assume near-linear), what speedup do you get? (use `s=8` on the parallel part)
3. What's the engineering takeaway about the serial step?

*Target:* (1) `1/(1-0.70)=1/0.30≈3.33×` ceiling. (2) `1/(0.30+0.70/8)=1/0.3875≈2.58×`. (3) the 30% serial signing is the permanent floor — no parallelism beats 3.33×; the only way past it is to attack the serial step itself (can it be batched, pre-computed, or made concurrent within the legal constraint?). Identify the irreducible serial fraction *before* investing in more cores.

## Task 12 — Write your own constraint audit

Pick a real system or process you work on (a service, a pipeline, your team's delivery flow).

1. Define its **goal** and its **throughput metric** (you can't find a constraint without a defined flow).
2. Measure or estimate where work *waits* — find the single constraint.
3. Apply the five focusing steps: one exploit move (free) and one elevate move (costly).
4. Predict where the constraint moves after your fix.
5. State the highest-leverage *non-code* change available (a rule, a goal, a loop) and why it beats any parameter you could tune.

*Target:* a concrete, measured constraint with an explicit exploit-before-elevate plan, a predicted constraint shift, and at least one intervention above the parameter tier — demonstrating the full loop from this topic end to end.
