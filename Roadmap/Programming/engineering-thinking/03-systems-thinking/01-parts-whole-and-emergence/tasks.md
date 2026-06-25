> Exercises for *parts, whole, and emergence*. **Global constraints:** for every task, your answer must (a) name whether the behavior is **component-local** or **emergent**, (b) when emergent, identify the *interaction* (not the component) that produces it, stated as *"X interacting with Y under condition Z produces behavior B,"* and (c) propose a fix that lives on an *arrow* (interaction) when the problem is emergent, or on a *box* (component) when it's genuinely local. No fix may be "scale the component" unless you justify why amplification won't follow. Deliverables marked **[D]** should be a short written artifact (a paragraph, a diagram, or a table).

---

## Task 1 — Classify the property

For each, label **component-local** or **emergent**, and give a one-line justification using the "can I fix it by editing one file?" heuristic:

1. A function returns the wrong value for negative input.
2. The checkout endpoint's p99 latency triples at 5,000 concurrent users.
3. A process leaks 2MB/hour.
4. Two transactions deadlock under concurrent load.
5. The system's overall availability is 99.5% despite three "independent" replicas.
6. A single config file has a typo.

**Deliverable [D]:** a 6-row table. *Check:* 2, 4, 5 are emergent; 1, 3, 6 are local.

---

## Task 2 — Find the interaction, not the component

A profiler on the `orders` service shows 99% of time spent awaiting the `inventory` service. The `inventory` team profiles their service and finds it healthy under normal load. The incident persists.

1. Why does each team's single-service profiler fail to explain the incident?
2. Hypothesize the emergent mechanism in the *"X interacting with Y under condition Z"* form.
3. Which *interaction-scoped* signals would confirm it (name three time-series)?

*Check:* the answer is a cross-service feedback loop (likely retries amplifying load); confirming signals include retry-rate, success-rate, and offered-load-vs-baseline across the boundary.

---

## Task 3 — Spot the local optimum

Three changes shipped in the same quarter, each praised in its own team's retro:
- Client team: added 3 automatic retries on any 5xx or timeout.
- API team: cut the downstream timeout from 10s to 2s to free threads faster.
- DB team: capped connections at 100 to protect the database.

1. State why each change is *locally* optimal.
2. Construct the sequence of events (trigger → amplification → outage) that makes the *whole* fail.
3. Propose the minimal set of *interaction-level* fixes.

**Deliverable [D]:** a numbered event timeline. *Check:* a brief DB slowdown trips the 2s timeouts → fires retries (3× load) → exhausts the 100-connection cap → fleet-wide timeouts; fixes include retry budgets, backoff+jitter, and removing naked retries.

---

## Task 4 — Draw the boundary three ways

Incident: "Checkout is slow." Re-analyze it under three boundaries — (A) checkout service only, (B) + DB + queue, (C) + third-party tax API + clients.

1. State the conclusion you'd reach under each boundary.
2. Which boundary correctly contains the feedback path, and how do you know?
3. State the rule for choosing a boundary in one sentence.

*Check:* (A) "code's fine, not us"; (C) reveals tax-API slowdown + client retries; the correct boundary encloses every element in the feedback path of the behavior.

---

## Task 5 — Diagnose component fault vs emergent failure

For each incident, decide **component fault** or **emergent failure**, and give the corresponding *first action*:

1. One node's disk fills; it crashes; traffic reroutes; everything else is fine afterward.
2. A 30-second latency spike ends, but the platform stays degraded for an hour and only recovers when on-call drops 40% of traffic.
3. A single bad deploy to one service returns 500s; rolling it back fully restores service.
4. Caches expire simultaneously at midnight; the origin is hammered; it recovers once requests are coalesced.

*Check:* 1 and 3 are component faults (replace/rollback the box); 2 is metastable (break the sustaining loop — shed load); 4 is thundering herd (interaction fix — coalescing/jitter).

---

## Task 6 — Identify the metastable signature

You're handed this incident shape: a deploy bumped latency by 50ms; the deploy was rolled back within 4 minutes; the platform stayed down for 90 minutes and recovered only after on-call disabled retries fleet-wide.

1. Why is this metastable rather than a simple component fault?
2. Identify the trigger and the sustaining loop.
3. What design controls (added *before* the incident) would have shortened it?

*Check:* trigger = the deploy's latency bump; sustaining loop = retries amplifying load after rollback; controls = retry budgets, admission control/load shedding, pre-authorized break-glass to drop retries.

---

## Task 7 — Audit a diagram for omitted emergence

Take any real architecture diagram you have (or sketch a 5-box service-mesh one). The diagram shows two "independent" replicas behind a load balancer, both calling one auth service and reading config from one config server.

1. List three emergent behaviors the diagram *cannot* show.
2. Identify at least two **correlated-failure couplings** that make the "independent" replicas fail together.
3. Annotate each arrow with the missing dynamics (timeout, retry policy, "what happens to the caller when the callee is slow").

**Deliverable [D]:** the annotated diagram (or a table of arrow → annotations). *Check:* shared auth and shared config are correlated single points of failure invisible on the box diagram; availability is emergent from failure correlation.

---

## Task 8 — POSIWID the system

Pick a system you operate (or use: a cluster marketed as "highly available" that suffers a full outage every quarter when its regional control plane blips).

1. State its **stated** purpose and its **revealed** (emergent) behavior.
2. Where do they diverge?
3. Rewrite the problem statement so it targets the *revealed* purpose, then propose one structural change.

*Check:* revealed purpose includes "convert control-plane blips into total outages"; the fix is decoupling from the control-plane dependency, not better marketing.

---

## Task 9 — Trace the Conway coupling

A recurring incident lives on the `payments → ledger` interface: messages are occasionally dropped because the two services disagree on retry/idempotency semantics. Payments and ledger are owned by two teams in different orgs that rarely communicate.

1. Explain the incident as a socio-technical emergent failure (map the org coupling to the technical coupling).
2. Why does no single team's component work fix it durably?
3. Propose both a technical fix *and* an org/ownership fix (inverse Conway).

*Check:* the brittle interface mirrors weak A↔B communication; durable fix needs a shared, owned contract (idempotency keys) *and* a communication/ownership change.

---

## Task 10 — Design for an emergent property

Requirement: the platform must **degrade gracefully** instead of cascading when any single dependency slows down.

1. List the interaction-level mechanisms you'd put in the *shared substrate* (not per-team).
2. For each, name the emergent property it produces and the failure mode it prevents.
3. Explain why "make each service handle its own retries" is the *wrong* answer.

**Deliverable [D]:** a 4–6 row table (mechanism → emergent property → failure prevented). *Check:* backoff+jitter+retry-budgets (bounded amplification), bulkheads/circuit-breakers (isolation), load shedding/admission control (recoverability); per-team retries guarantee an eventual storm.

---

## Task 11 — The throughput-vs-load curve

Your service is benchmarked at "12,000 req/s." A colleague says "so it can handle 12,000 req/s."

1. Why is a single throughput number insufficient to characterize an emergent property?
2. Sketch (describe) the shape of a curve exhibiting **congestion collapse** and mark where useful throughput peaks and where it bends backward.
3. What test would you run to discover whether this latent failure mode exists?

*Check:* congestion collapse = throughput rises then *falls* as offered load increases past capacity due to retransmission/amplification; the test sweeps offered load past saturation and watches *goodput*, not just peak throughput.

---

## Task 12 — Write the postmortem coupling statement

Take Task 3's outage (or any real one). Write the two mandatory systems-thinking artifacts:

1. A one-line **coupling statement**: *"X interacting with Y under condition Z produced B."*
2. A short **"why no single component is at fault"** paragraph.

**Deliverable [D]:** both artifacts, ≤120 words total. *Check:* if your postmortem blames a single box for an emergent failure, the incident will recur — the coupling statement must name an interaction, and the paragraph must show every component behaved per its spec.
