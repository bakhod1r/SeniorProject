# Second-Order Effects — Tasks

> Trace-the-ripples and find-the-perverse-incentive drills. **Global constraints:** for every task, (a) name the first-order intended effect, then trace **at least three hops** of second/higher-order effects; (b) for each ripple, name the *new failure mode* and the *new thing to maintain* it creates; (c) state who the cost **externalizes** to (on-call / another team / future-you); (d) classify the change as a one-way or two-way door and name the reversibility hedge. Where a deliverable is requested, produce the actual artifact (table, diagram, design note), not a description of one. Use the chain template from [middle.md](middle.md).

---

## Task 1 — Trace the cache

A teammate adds a 60-second in-memory cache to a `GET /user/{id}/profile` endpoint to cut DB load.

- Build the 3-hop ripple chain (intended → stale reads → herd-on-cache-failure → …).
- Identify two distinct *new failure modes* and two *new things to maintain*.
- Now change the cached data to `GET /user/{id}/permissions`. What new second-order effect appears, and what's the design fix?

**Deliverable:** a `change → 1st → 2nd → 3rd` table for both the profile and permissions cases, plus a one-line fix for the permissions case.

## Task 2 — The retry storm, quantified

A service has 200 instances. Each makes a call to a downstream on every request; on failure it retries up to 3× with no backoff. The downstream starts returning errors under load.

- Compute the load multiplier delivered to the downstream during the failure vs normal operation.
- Explain why this *sustains* (not just survives) the outage — name the loop.
- Propose three second-order-aware mitigations and explain what ripple each one *removes*.

**Deliverable:** the multiplier, the named failure pattern, and a 3-row mitigation table (`mitigation → ripple it removes`).

## Task 3 — Find the perverse incentive

For each metric below, state the intended first-order effect, then the perverse second-order behavior a rational, busy engineer would produce, and a counter-metric that makes the gaming visible:

1. Reward teams for "zero Sev-1 incidents this quarter."
2. Mandate 90% line coverage as a merge gate.
3. Reward individuals for number of PRs merged.
4. Reward on-call engineers for fastest incident resolution.

**Deliverable:** a 4-row table (`metric → intent → perverse behavior → counter-metric`). Tie each to Goodhart's law or the cobra effect explicitly.

## Task 4 — The timeout that fails harder

A service raised an outbound HTTP timeout from 1s to 30s because users were seeing timeout errors. Errors dropped. Two weeks later, under a traffic spike, the whole service went fully down instead of degrading.

- Explain the mechanism: how did *fewer errors now* become *total failure later*? Name the resource that ran out.
- Draw the divergence: short-timeout failure path vs long-timeout failure path.
- State the principle in one sentence about *how* you want systems to fail.

**Deliverable:** a Mermaid diagram of both failure paths and the one-sentence principle.

## Task 5 — Jevons hunt

For three of the following efficiency wins, predict the induced-demand second-order effect and name the limit you'd install *at ship time* to contain it:

- An internal endpoint made 10× cheaper per call.
- A free, fast self-serve analytics/data-warehouse platform.
- Auto-scaling that makes adding capacity frictionless.
- CI builds made 5× faster.

**Deliverable:** a 3-row table (`efficiency win → induced demand → faucet limit`), each citing the Jevons paradox.

## Task 6 — Chesterton's fence in code

You find this in a hot loop and want to delete it for cleanliness:

```go
// retry capped at 2 — do not raise
if attempts < 2 { /* retry */ }
time.Sleep(jitter()) // why is this here?
```

- List the second-order effects that the *cap* and the *jittered sleep* might each be preventing.
- Write the investigation you'd do before removing either (git blame? incident search? load test?).
- State the decision rule for when you're allowed to remove load-bearing weirdness.

**Deliverable:** a short investigation checklist and the removal decision rule, framed via Chesterton's fence.

## Task 7 — Externality audit

Take a real (or realistic) change: *"To hit our deadline, our service returns the full result set with no pagination."*

- Trace the ripples to *every other party* affected: clients, mobile users, the network, the on-call, future-you.
- For each, name the ledger the cost lands on and how it eventually returns to *you* (e.g., as an incident, a complaint, a rewrite).
- Re-scope the change so the cost isn't externalized without consent.

**Deliverable:** an externality table (`affected party → cost → how it returns to you`) and the re-scoped change.

## Task 8 — Pre-mortem a real change

Pick a non-trivial change you're actually planning (or a recent one). Run the senior pre-mortem from [senior.md](senior.md):

1. First-order intent (one line).
2. New failure modes the change creates.
3. Run each through the amplification catalogue (herd / storm / cascade / metastable / perverse incentive).
4. Externalities — whose ledger?
5. Irreversible parts — the one-way doors.
6. The hedge — flags, staging, monitoring for the *specific* predicted ripple.

**Deliverable:** the completed 6-point pre-mortem as a design-note you could paste into a PR.

## Task 9 — The shared-service trap (staff)

Your team is asked to extract a `RateLimiter` into a shared, centrally-run service so every team stops reimplementing it.

- First-order: dedup'd work, consistency. Trace the second/third-order effects of *centralizing* it (coupling, SPOF, change-bottleneck, on-call ownership).
- Where does this rank as a one-way vs two-way door, and why?
- Propose an alternative that captures most of the first-order benefit with a smaller second-order cost (hint: shared *library* vs shared *service*).

**Deliverable:** a ripple analysis and a recommendation with the trade named explicitly. Cross-reference [../06-leverage-points-and-bottlenecks/](../06-leverage-points-and-bottlenecks/).

## Task 10 — Platform-default blast radius (staff)

You own a shared HTTP client library used by 80 services. You want to change the default retry policy from "3 retries, no backoff" to "2 retries, exponential backoff + jitter, with a budget."

- The change is *better*. Trace the second-order effects of rolling it out anyway (services relying on old timing, aggregate traffic shifts to shared downstreams, silent breakage).
- Design the rollout so the ripples are bounded and reversible — treat it as a production change.
- State the rule for choosing platform defaults that this exercise demonstrates.

**Deliverable:** a rollout plan (staging, flags, observability, rollback) and the one-line default-selection rule (safe-when-ignored).

## Task 11 — Incentive design from scratch (staff)

You must introduce *one* org-wide engineering metric to improve delivery health. Design it to resist Goodhart's law.

- State the outcome you actually want (not the proxy).
- Choose a metric and its paired counter-metric(s).
- Pre-mortem it: write down the three cleverest ways a team would game it, and show how the counter-metric exposes each.

**Deliverable:** a one-page metric proposal including the gaming pre-mortem table.

## Task 12 — Reversibility classification

For each change, classify it as a one-way or two-way door, justify it, and state the cheapest hedge that would move a one-way door *toward* reversibility:

1. Add a database index.
2. Drop a column from a production table.
3. Ship a behavior change behind a feature flag.
4. Publish a new public API endpoint other companies will integrate with.
5. Introduce a Kafka topic that 12 internal teams start consuming.

**Deliverable:** a 5-row table (`change → door type → justification → reversibility hedge`). Connect the principle to where you should spend prediction effort.

---

## Reference thread

- Templates and the amplification catalogue: [middle.md](middle.md) · [senior.md](senior.md).
- Org-scale ripples and incentive design: [professional.md](professional.md).
- Loops behind the storms: [../02-feedback-loops/](../02-feedback-loops/). Highest-leverage interventions: [../06-leverage-points-and-bottlenecks/](../06-leverage-points-and-bottlenecks/).
- Trade-off framing: [../05-thinking-in-tradeoffs/](../05-thinking-in-tradeoffs/) · [../../04-critical-thinking/04-evaluating-tradeoffs-objectively/](../../04-critical-thinking/04-evaluating-tradeoffs-objectively/). Risk weighting: [../../06-probabilistic-thinking/03-risk-and-failure-probabilities/](../../06-probabilistic-thinking/03-risk-and-failure-probabilities/).
