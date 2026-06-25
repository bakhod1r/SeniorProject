# Reasoning from Fundamentals — Practice Tasks

> These are *thinking* exercises, not code golf. Each one hands you a decision, a number, or a claim justified by analogy — your job is to re-derive it from fundamentals, compute a floor, classify the assumptions, and state where the analogy was load-bearing. Constraints for all tasks: **show your arithmetic**, **date and state every constant you assume**, and for every "must" you encounter, label it law / hard-req / soft-req / convention. Use realistic numbers (Jeff Dean's latency table, ~200,000 km/s in fiber) and don't fabricate precision you don't have.

---

## Task 1 — Re-derive a "best practice"

A tech lead writes: *"We will put a Redis cache in front of every read endpoint, because caching is a best practice for read-heavy APIs."*

1. Identify the analogy being used and the assumption it hides.
2. For a specific endpoint of your choosing, compute the floor (bytes, rows, round-trips) of serving it *without* a cache.
3. State the condition under which the cache is genuinely justified, as an inequality (e.g. "cache pays off when floor latency × QPS-of-recompute > …").
4. Conclude: for which endpoints is the "best practice" right, and for which is it cargo-culting?

**Deliverable:** a paragraph plus one inequality. The win is naming the *condition*, not picking a side.

---

## Task 2 — The latency floor that geography sets

Your product owner wants p99 < 30 ms for users in Sydney, served from a single region in `us-east-1` (Virginia).

1. Sydney → Virginia is ~16,000 km. Compute the theoretical minimum RTT in fiber. Show the ⅔-*c* step.
2. Add realistic protocol overhead (TCP + TLS 1.3 + request) for a cold connection.
3. State whether the requirement is achievable, and classify "<30 ms for Sydney" into one of the four bins.
4. If it's not achievable from one region, write the two-sentence message you'd send the PO — naming the *physical* reason and the only class of fix.

**Deliverable:** the RTT calculation and the message. Bonus: what does this imply about where edge PoPs must live?

---

## Task 3 — Diagnose "the database is slow"

An endpoint `/profile` takes 600 ms. The owning team's ticket says "DB is slow, needs more replicas." You know: it returns one user, their last 10 posts, and each post's comment count.

1. Compute the fundamental floor: how many rows, how many bytes, how many round-trips does this *have* to be?
2. List the two most likely causes of a 600 ms reality given that floor.
3. For each cause, give the fix and explain why "more replicas" addresses neither.
4. State the one measurement you'd take first to distinguish the causes.

**Deliverable:** floor number, two hypotheses, two fixes, one decisive measurement.

---

## Task 4 — Cost decomposition (the battery move)

Leadership says a proposed "user audit log" feature is "too expensive to keep for 7 years."

1. Pick plausible parameters: number of users, audit events per user per day, bytes per event. State them.
2. Compute the 7-year fundamental storage floor. Convert to an approximate monthly cloud cost (state your $/GB-month).
3. If the real estimate is 20× your floor, list three implementation choices that would explain the 20× (e.g. format, indexing, replication factor, hot-vs-cold tiering).
4. Write the one-sentence reframe you'd give leadership that turns "too expensive" into a fundable engineering question.

**Deliverable:** the floor cost, the 20×-explanation list, and the reframe sentence.

---

## Task 5 — Classify the assumptions

Here is a design statement. *"Every microservice owns its own Postgres database, communicates over gRPC, stores sessions in Redis, and must be globally strongly consistent."*

1. Break it into its individual assumptions.
2. Put each into exactly one bin: law / hard-requirement / soft-requirement / convention. Justify each in one clause.
3. Identify the one assumption most likely to be a *soft requirement masquerading as a law*, and state the floor it implies if it really were a law.
4. Which single assumption, if relaxed, most increases the system's achievable throughput? Show why with a number.

**Deliverable:** a four-bin table and the throughput argument.

---

## Task 6 — Throughput floor, not latency floor

You must serve 80,000 req/s; each request serializes a 4 KB JSON response and makes one 250 µs DB round trip on the request path.

1. Compute the network output floor (MB/s) and check it against a 25 Gbps NIC.
2. Compute the CPU floor for serialization, assuming ~300 MB/s/core. How many cores just for encoding?
3. If the DB round trip is *synchronous* on the request thread, how many in-flight threads do you need at minimum? Which resource is the real wall here?
4. State which dimension you'd scale, and why scaling the wrong one (a common analogy reflex) wouldn't help.

**Deliverable:** three floor numbers and a one-line identification of the binding resource.

---

## Task 7 — Invert it (Munger contrast)

Take the `/profile` endpoint from Task 3, now performing at its floor (~5 ms).

1. Apply *inversion*: list everything that could *force* this endpoint back to 600 ms in production over the next year (deploys, growth, schema drift, etc.).
2. For each, note whether it pushes against the *latency* floor, the *bytes* floor, or the *round-trip* floor.
3. Pick the two most likely and propose a guardrail (alert, test, budget) tied to the floor that would catch each before users do.

**Deliverable:** the failure list mapped to floors, plus two floor-anchored guardrails. Note how inversion and first-principles combined.

---

## Task 8 — Build-vs-buy from fundamentals

A vendor offers a feature-flag service at $0.50 per 1,000 flag evaluations. Your app does ~3B evaluations/month.

1. Compute the monthly vendor bill.
2. Compute the *fundamental* cost of a flag evaluation in-house: it's essentially a hash-map lookup over a config blob fetched periodically. Estimate compute + the bandwidth to distribute config to N servers.
3. Identify what the vendor's price *actually* buys beyond the commodity floor (the part that's genuinely irreducible value, à la the senior-level battery decomposition).
4. Make the call and defend it: is the gap margin you should reclaim, or value you should keep paying for?

**Deliverable:** both costs, the "what you're really buying" analysis, and a defended decision.

---

## Task 9 — Catch the first-principles theater

A colleague's design doc claims: *"Our floor model shows the pipeline can do 1M events/sec, so the current 40k/sec means we have 25× headroom."* The model's constants are unsourced.

1. List the questions you'd ask to test whether this is a real floor model or theater.
2. Identify which single missing piece (present in every honest floor model) would most undermine the claim if absent.
3. Rewrite the claim into a defensible form, inventing reasonable *dated, sourced* constants and adding the prediction-vs-observation step.

**Deliverable:** your audit questions and the rewritten, honest claim.

---

## Task 10 — Renegotiate a requirement with a floor

Product insists: *"The global leaderboard must update in real time and be perfectly consistent for all 5M players worldwide."*

1. Compute the consensus floor for globally-linearizable writes to the leaderboard's hot keys (assume ~140 ms inter-region RTT). What's the max writes/sec/key?
2. Show the gap between that floor and a plausible peak write rate during an event.
3. Construct the **priced menu** you'd bring to product: at least three consistency options, each with its throughput, latency, and a one-line user-visible consequence.
4. State which option you'd recommend and the single question you'd ask product to confirm it's acceptable.

**Deliverable:** the floor, the gap, and a three-row priced menu — the artifact that turns physics into a product decision.

---

## Task 11 — Estimate the irreducible payload (information floor)

A mobile client syncs a to-do list: 2,000 items, each with a title (~40 chars), a done flag, a due date, and a priority (1 of 4).

1. Estimate the *information content* per item in bytes (think entropy: how many bytes does each field *fundamentally* need — the priority is 2 bits, not a 10-char string).
2. Compute the tight floor for the full sync payload, then the naive cost if each item were a verbose JSON object with full field names.
3. Compute the wire time for each at 5 Mbps on mobile.
4. State the trade-off: when is the verbose-JSON cost worth paying anyway? (Hint: the floor isn't the only thing that matters.)

**Deliverable:** both payload sizes, both wire times, and the honest trade-off — because the smallest payload is not automatically the right one.

---

## Task 12 — Decide the mode itself

For each decision below, state in one line whether you'd reason by **analogy** or from **fundamentals**, and why (cite reversibility, stakes, novelty, or available data):

1. Choosing which JSON library to use in a new service.
2. Choosing the sharding key for a 50 TB table that will be very hard to reshard later.
3. Deciding whether to adopt the company's standard retry-with-backoff library.
4. Deciding the consistency model for a new payments ledger.
5. Picking a log line format for a debug script.
6. Deciding whether a 300-microservice architecture from a conference talk fits your 40-user internal tool.

**Deliverable:** six one-line verdicts. The meta-skill being tested is *mode selection* — the most important first-principles decision is knowing when to spend the method at all.
