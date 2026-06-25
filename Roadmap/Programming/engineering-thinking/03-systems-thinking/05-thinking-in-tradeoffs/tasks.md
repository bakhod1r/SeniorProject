> Exercises in *seeing* tradeoffs, not weighing them (for the weighing process see [evaluating tradeoffs objectively](../../04-critical-thinking/04-evaluating-tradeoffs-objectively/)). For every task: **name both sides** of the tradeoff, **identify the dominant axis**, and where asked, **state the assumed context that, if changed, flips the choice**. Use concrete numbers when given. A vague "it depends" with no named axis scores zero; "it depends on X, and here's how X decides it" scores full. Some tasks have a numeric component — show the arithmetic.

---

## Task 1 — Name the tradeoff

For each change, write the gain and the *price* (one sentence each). Don't say "no downside."

1. Adding a Redis cache in front of Postgres.
2. Adding a composite index `(user_id, created_at)` to an events table.
3. Switching from JSON to Protocol Buffers on the wire.
4. Adding exponential-backoff retries to every outbound HTTP call.
5. Replacing a hardcoded constant with a runtime config flag.

**Goal:** five gain/price pairs. If you can't name a price, you haven't understood the change.

---

## Task 2 — Find the dominant axis

A team is choosing a datastore for a service that ingests **80,000 sensor readings/sec**, stores them for 30 days, and is queried **~5 times/hour** by one dashboard that only ever filters by `device_id` and time range.

1. List four candidate axes (e.g., write throughput, query flexibility, consistency, ops familiarity).
2. Which **one** dominates? Justify in one sentence.
3. Does query flexibility matter here? Why is arguing about it bikeshedding?
4. Which storage family does the dominant axis point to (read- or write-optimized)?

---

## Task 3 — Show where the best practice flips

The best practice "normalize to 3NF" is right in many systems. Construct the opposite case:

1. Describe a concrete workload where normalization is **wrong**.
2. Name the *assumed context* behind "always normalize."
3. State the exact property of your workload that *flips* the tradeoff.
4. What do you accept as the price of denormalizing, and why is it tolerable here?

---

## Task 4 — Latency vs throughput, with numbers

A write pipeline batches rows into one DB transaction. Measured:

| Batch size | Throughput (rows/sec) | Added p99 latency per row |
|---|---|---|
| 1 | 6,000 | ~2 ms |
| 50 | 55,000 | ~18 ms |
| 500 | 210,000 | ~160 ms |
| 5,000 | 320,000 | ~1,400 ms |

The product requires **p99 per-row latency ≤ 100 ms** and you want the **highest throughput** within that budget.

1. Which batch size do you pick, and why is it *not* the highest-throughput one?
2. Roughly interpolate: at what batch size do you hit the 100 ms ceiling? Show your reasoning.
3. The PM asks for both 320k rows/sec *and* <100 ms. Explain why that's off the current frontier and name one way to *push* the frontier to get it.

---

## Task 5 — The slack test (find the free lunch)

A teammate claims their refactor made an endpoint "**8× faster with zero downside**."

1. State the slack-test question you'd ask.
2. Give two concrete things that, if true, make a pure win *legitimate* (genuine slack below the frontier).
3. Give two hidden costs that "8× faster, no downside" might actually be hiding.
4. If after investigation it really is a pure win, what does that tell you about where the system *was* on the Pareto frontier?

---

## Task 6 — CAP / PACELC classification

Classify each system and justify in one line each.

1. A bank ledger that must **never** show two different balances, even if it means rejecting requests during a network split.
2. A shopping cart that must **always** accept "add to cart," tolerating brief disagreement between replicas.
3. A globally-distributed config store using atomic clocks to keep partitions short.

For each: give the CAP side (CP/AP) **and** the PACELC class (PA/EL, PC/EC, etc.). Then state which branch — the **P** or the **E** — actually governs that system most of the time.

---

## Task 7 — Place the unavoidable cost

For each forced tradeoff, you can't delete the cost — decide *where to put it* so the system absorbs it best.

1. Consistency vs latency in a social feed (reads hot, writes rare). Where do you pay?
2. Space vs time for a key-value store with a long-tail access pattern (20% of keys = 80% of traffic). Where do you spend memory?
3. Security vs usability for a banking app. Where do you place the friction?

State the *mechanism* (e.g., "fan-out on write," "cache the hot 20%," "step-up auth") and which side of the tradeoff you deliberately worsened.

---

## Task 8 — The scale-flip threshold

Your service runs on a single Postgres primary. Pick the **sharding** tradeoff (single DB vs sharded).

1. Why is "single DB" currently the right side (name two concrete benefits)?
2. Name a **metric and a numeric threshold** that signals the flip is approaching (e.g., "sustained write IOPS > X% of ceiling").
3. What should you start when the threshold is crossed — the migration, or the *design*? Why does the distinction matter?
4. Describe the worse outcome if you ignore the threshold until 100% utilization.

---

## Task 9 — Coupling vs duplication judgment

Two services both compute "is this user eligible for free shipping."

1. Case A: it's literally the *same* business rule, changed together, owned by one team. Couple or duplicate? Why?
2. Case B: the two services use the same *current* threshold by coincidence, owned by different teams that deploy independently and expect to diverge. Couple or duplicate? Why?
3. Name the cost you accept in each choice, and quote the proverb that captures Case B.

---

## Task 10 — Generality vs performance, quantified

A generic reflection-based serializer handles any struct at **~120 ns/op**. A code-generated serializer for one specific struct runs at **~8 ns/op** but only works for that one type and must be regenerated when the struct changes.

1. State both sides of the tradeoff.
2. This struct is serialized in a hot path **2 million times/sec**; everything else in the app serializes rarely. Where do you apply the specialized version, and where do you keep the generic one? Name the principle.
3. Estimate the CPU saved on the hot path by specializing it. (Hint: compute ns/sec saved, convert to fraction of one core.)

---

## Task 11 — Make a tradeoff explicit and reversible

You decide to cache user profiles with a 10-minute TTL.

1. Write the one-sentence explicit-tradeoff note you'd put in the PR (gain, price, why acceptable).
2. Is this tradeoff reversible? How cheaply, and what does that imply about how much deliberation it deserves?
3. Contrast it with one *irreversible* tradeoff in the same system that deserves far more care, and say why.

---

## Task 12 — Defend the unpopular tradeoff (single-axis stakeholder)

Sales wants a feature shipped in 2 weeks (fast-to-build) instead of the 6 weeks engineering estimates for a maintainable build.

1. Name the axis Sales sees and the axis they're blind to.
2. Write the two-column sentence you'd use to make the hidden axis visible *without* saying "no."
3. State the condition under which shipping the fast-but-costly version is genuinely the right call — and who should own that decision once both columns are visible.
