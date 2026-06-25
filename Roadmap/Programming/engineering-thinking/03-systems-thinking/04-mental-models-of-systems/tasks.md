> Exercises to build, validate, and repair your mental models of real systems. **Global constraints:** (1) Use a *real* system you have access to — your team's service, an open-source project, or one you build — never a hypothetical. (2) Every model claim must be **falsifiable**: state the prediction, then run the cheapest experiment that could prove it wrong (see [hypothesis & falsifiability](../../09-scientific-and-hypothesis-driven/01-hypothesis-and-falsifiability/)). (3) Models must include **failure branches**, not just the happy path. (4) Tasks marked **[deliverable]** require a concrete artifact (a diagram, a number, a table) — not prose. Work up the difficulty order; later tasks assume earlier ones.

---

## Task 1 — Trace a request end to end **[deliverable: trace]**

Pick one real endpoint in a system you have. Follow a single request from the moment it arrives to the moment a response leaves. Write the *complete* path as an ordered list: router → middleware → handler → data access → external calls → serialization → response. For every step you can't name precisely, open the code and find out — do not guess from function names.

**Deliverable:** the ordered trace, plus a one-line note on each step's purpose. **Success criterion:** you can answer "what happens if the requested resource doesn't exist?" by walking the trace.

## Task 2 — Draw the system diagram, then find the unlabeled arrow **[deliverable: diagram]**

Turn Task 1's trace into a boxes-and-arrows diagram (Mermaid, whiteboard photo, or paper). Include every component the request touches: load balancer, app, cache, DB, queue, external APIs.

Now the real exercise: **find the arrow you cannot fully label.** That arrow is the edge of your model. Go read the code or run an experiment until you can label it. Repeat until every arrow is labeled with what flows across it and what guarantee it carries (sync/async, retried/not, idempotent/not).

## Task 3 — Add the failure branches **[deliverable: failure table]**

For each component in your Task 2 diagram, fill a table: what happens when this component is **(a) slow**, **(b) down**, **(c) returns garbage/wrong data**? Be specific about *propagation* — does a slow DB block a thread? Does that saturate a pool? Does an upstream then time out and retry?

| Component | Slow | Down | Bad data |
|---|---|---|---|
| (fill from your system) | | | |

**Success criterion:** at least one cell describes a *cascade* (a failure that propagates beyond the failing component).

## Task 4 — Apply Little's Law to size a pool **[deliverable: number]**

Measure (or pull from metrics) your service's average request rate `λ` and average latency `W` for one endpoint. Compute `L = λ × W` — the average number of in-flight requests.

**Deliverables:**
1. The computed `L`.
2. A recommendation: is your current thread/connection pool size above or below `L`? By how much?
3. The *throughput ceiling* `λ_max = pool_size / W` your current pool imposes.

**Trap to avoid:** use steady-state averages, not numbers captured during a spike.

## Task 5 — Predict a saturation ceiling, then load-test to it **[deliverable: number + result]**

Using Task 4's `λ_max = pool_size / W`, **predict** the request rate at which your service starts queueing (latency climbs, then errors). Write the prediction down *before* testing.

Then load-test (k6, wrk, Locust, or a script) ramping past the predicted ceiling. Record the rate at which latency knees upward.

**Deliverable:** predicted ceiling vs observed ceiling, and an explanation of any gap. A gap *is* a model bug — find what your model missed (extra queue depth, async I/O, a slower hidden dependency).

## Task 6 — Identify the stocks and flows **[deliverable: stock/flow list]**

For your system, list every **stock** (something that accumulates: request queue, connection pool, message-queue lag, disk, buffer, retry backlog) and the **flows** that fill and drain each (rates in and out). For one stock, write the equation `Δstock = inflow − outflow` and identify the condition under which it grows unbounded.

**Success criterion:** you can point at the metric/dashboard that shows each stock's current depth.

## Task 7 — Run an experiment that falsifies a belief you hold **[deliverable: prediction + result]**

Name one thing you *believe* about your system but have never verified. Examples: "this call is cached," "the circuit breaker actually opens," "this code path runs once per request," "retries are idempotent."

State it as a falsifiable prediction. Design the cheapest experiment that could prove it wrong (a log/counter, a span, a chaos injection, a breakpoint). Run it.

**Deliverable:** the prediction, the experiment, and the result — *especially* if you were wrong. A falsified belief is the most valuable outcome here.

## Task 8 — Find the model drift **[deliverable: drift report]**

Take an existing artifact that *should* describe your system: the architecture wiki page, a runbook, an onboarding doc, or a config comment. Compare it against reality (read the current code, check the deployed topology, diff the wiki diagram against a service map from traces if you have one).

**Deliverable:** a list of every place the artifact has drifted from reality, plus a fix for the worst one. Update the *artifact*, not just your head.

## Task 9 — Latency-number sanity check **[deliverable: ordering]**

Without looking it up first, order these operations from fastest to slowest, then check against Jeff Dean's latency numbers and correct yourself: L1 cache reference, main memory reference, SSD random read, round trip within a datacenter, read 1 MB sequentially from SSD, cross-continent network round trip, disk seek.

**Deliverable:** your initial ordering, the corrected ordering, and one engineering decision in your codebase that this hierarchy explains (e.g., why a cache, why batching, why avoiding a network call in a loop). Cross-check the cross-continent floor against [first-principles latency](../../05-first-principles-thinking/01-reasoning-from-fundamentals/) — the speed of light sets a hard minimum no engineering removes.

## Task 10 — Diagnose a slow system with USE and RED **[deliverable: diagnosis path]**

Next time a service is slow (or simulate it by adding latency/load), diagnose it *only* via USE and RED instead of guessing:

- **RED** on the service: is it Rate, Errors, or Duration that's off? Which endpoint?
- **USE** on the suspect resource: Utilization, Saturation, Errors — which resource is saturated?

**Deliverable:** the ordered path from "service is slow" to "root-cause resource," showing which USE/RED signal pointed you at each step. **Success criterion:** zero steps were guesses — each was driven by a metric.

## Task 11 — Surface a divergent model **[deliverable: reconciled diagram]**

Ask a teammate to draw, independently, the diagram of a subsystem you both work on. Don't look at each other's. Then compare.

**Deliverable:** a list of every place the two models diverged (a box one of you omitted, a guarantee you disagreed on, a flow direction mismatch), and a single reconciled diagram you both agree describes reality. **Reflection:** which divergences could have caused a real incident at the seam?

## Task 12 — Build an onboarding model-transfer kit **[deliverable: kit]**

Imagine a new engineer joins your team tomorrow. Build the artifact set that would transfer your mental model fastest:

1. One context diagram (the system and its neighbors).
2. One end-to-end request trace (from Task 1).
3. One failure table for the top 3 dependencies (from Task 3).
4. The shared vocabulary glossary ("the hot path," "the ingest pipeline," etc.).

**Deliverable:** the kit. **Success criterion:** a peer unfamiliar with the subsystem can, after reading it, correctly predict what happens when your top dependency goes down — i.e., the model transferred. See [parts, whole & emergence](../01-parts-whole-and-emergence/) for why the wired-together picture matters more than any single component, and the [systems-thinking root](../) for where this sits.

---

> Once you can build an accurate model, validate it by experiment, keep it honest against drift, and transfer it to others, you have the foundation for the rest of systems thinking: weighing [tradeoffs](../05-thinking-in-tradeoffs/) inside an accurate model, finding [leverage points & bottlenecks](../06-leverage-points-and-bottlenecks/) in the flow, and reasoning about [feedback loops](../02-feedback-loops/) and [second-order effects](../03-second-order-effects/) you'd otherwise miss. Start from the [roadmap root](../../README.md).
